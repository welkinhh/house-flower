import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(root, 'flower-assets', 'editorial', 'source')
const outputRoot = path.join(root, 'flower-assets', 'editorial', 'cloud-ready')
const assets = [
  'bouquet-home', 'bouquet-ivory-sample', 'bouquet-peach-sample', 'inspiration-garden',
  'scene-living', 'scene-dining', 'scene-bedroom', 'scene-entryway',
  'case-truman-reference', 'case-truman-result', 'case-jay-reference', 'case-jay-result',
  'case-starry-night-pd-reference', 'case-starry-night-result',
  'case-great-wave-reference', 'case-great-wave-result',
  'case-monet-bridge-reference', 'case-japanese-bridge-result',
]
const pairedCases = [
  'titanic', 'green-book', 'grand-budapest', 'pursuit-happyness', 'blindspotting',
  'les-choristes', 'cinema-paradiso', 'legend-1900', 'thriller', 'folklore',
  'black-tangerine', 'u87', 'floating', 'dandan-youqing', 'golden-mountain',
  'po-pin-chau', 'meadow', 'spring-buds', 'summer-pond', 'autumn-leaves', 'winter-snow',
]
const maxEdge = 1600
const quality = 86

await fs.mkdir(outputRoot, { recursive: true })

async function findSourcePath(id) {
  for (const extension of ['png', 'jpg', 'jpeg', 'webp']) {
    const candidate = path.join(sourceRoot, id + '.' + extension)
    try {
      await fs.access(candidate)
      return candidate
    } catch {}
  }
  throw new Error('Missing editorial source image for ' + id)
}

async function saveAsset(key, sourcePath, pipeline, sourceWidth, sourceHeight, variant = '') {
  const fileName = key + '.jpg'
  const targetPath = path.join(outputRoot, fileName)
  const imageQuality = key === 'bouquet-home' ? 88 : quality
  await pipeline.rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: variant === 'flower' ? '#090909' : '#f6f1ea' })
    .jpeg({ quality: imageQuality, mozjpeg: true })
    .toFile(targetPath)
  const metadata = await sharp(targetPath).metadata()
  const stat = await fs.stat(targetPath)
  return {
    key,
    fileName,
    sourcePath: path.relative(root, sourcePath).split(path.sep).join('/'),
    sourceWidth,
    sourceHeight,
    width: metadata.width,
    height: metadata.height,
    bytes: stat.size,
  }
}

const manifest = []
const generatedFiles = new Set()
for (const id of assets) {
  const sourcePath = await findSourcePath(id)
  const source = sharp(sourcePath)
  const metadata = await source.metadata()
  const entry = await saveAsset(id, sourcePath, source, metadata.width || 0, metadata.height || 0)
  generatedFiles.add(entry.fileName)
  manifest.push(entry)
}

for (const id of pairedCases) {
  const sourcePath = path.join(sourceRoot, 'inspiration-' + id + '-diptych.png')
  const metadata = await sharp(sourcePath).metadata()
  const leftWidth = Math.floor((metadata.width || 0) / 2)
  for (const [variant, left] of [['reference', 0], ['flower', leftWidth]]) {
    const width = variant === 'reference' ? leftWidth : (metadata.width || 0) - leftWidth
    const key = 'inspiration-' + id + '-' + variant
    const entry = await saveAsset(
      key,
      sourcePath,
      sharp(sourcePath).extract({ left, top: 0, width, height: metadata.height || 0 }),
      width,
      metadata.height || 0,
      variant,
    )
    generatedFiles.add(entry.fileName)
    manifest.push(entry)
  }
}

for (const name of await fs.readdir(outputRoot)) {
  if (name.endsWith('.jpg') && !generatedFiles.has(name)) {
    await fs.rm(path.join(outputRoot, name), { force: true })
  }
}

const assetManifest = { version: 1, assets: manifest }
await fs.writeFile(path.join(outputRoot, 'asset-manifest.json'), `${JSON.stringify(assetManifest, null, 2)}\n`, 'utf8')
const catalog = manifest.map((item) => ({
  id: item.key,
  sourcePath: item.sourcePath,
  cloudPath: 'editorial/' + item.fileName,
  assetPath: '/assets/editorial/' + item.fileName,
  variant: item.variant || '',
  sourceWidth: item.sourceWidth,
  sourceHeight: item.sourceHeight,
  outputWidth: item.width,
  outputHeight: item.height,
  size: item.bytes,
}))
await fs.writeFile(path.join(root, 'flower-assets', 'editorial', 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
const inspirationCaseMap = [
  ...pairedCases.map((id) => `    '${id}': { reference: '/assets/editorial/inspiration-${id}-reference.jpg', flower: '/assets/editorial/inspiration-${id}-flower.jpg' },`),
  "    'truman': { reference: '/assets/editorial/case-truman-reference.jpg', flower: '/assets/editorial/case-truman-result.jpg' },",
  "    'jay': { reference: '/assets/editorial/case-jay-reference.jpg', flower: '/assets/editorial/case-jay-result.jpg' },",
  "    'starry-night': { reference: '/assets/editorial/case-starry-night-pd-reference.jpg', flower: '/assets/editorial/case-starry-night-result.jpg' },",
  "    'great-wave': { reference: '/assets/editorial/case-great-wave-reference.jpg', flower: '/assets/editorial/case-great-wave-result.jpg' },",
  "    'japanese-bridge': { reference: '/assets/editorial/case-monet-bridge-reference.jpg', flower: '/assets/editorial/case-japanese-bridge-result.jpg' },",
].join('\n')
await fs.writeFile(path.join(root, 'miniprogram', 'data', 'editorial-assets.ts'), `// Generated by scripts/build-editorial-cloud-assets.mjs. Values are CloudBase asset keys.
export const EDITORIAL_ASSETS = {
  homeHero: '/assets/editorial/bouquet-home.jpg',
  recognitionSamples: [
    '/assets/editorial/bouquet-home.jpg',
    '/assets/editorial/bouquet-ivory-sample.jpg',
    '/assets/editorial/bouquet-peach-sample.jpg',
  ],
  inspirationGarden: '/assets/editorial/inspiration-garden.jpg',
  travelPhotoInput: '/assets/editorial/inspiration-garden.jpg',
  showcases: {
    truman: { input: '/assets/editorial/case-truman-reference.jpg', result: '/assets/editorial/case-truman-result.jpg' },
    jay: { input: '/assets/editorial/case-jay-reference.jpg', result: '/assets/editorial/case-jay-result.jpg' },
    starryNight: { input: '/assets/editorial/case-starry-night-pd-reference.jpg', result: '/assets/editorial/case-starry-night-result.jpg' },
  },
  inspirationCases: {
${inspirationCaseMap}
  },
  inspirationBouquets: [
    '/assets/editorial/bouquet-ivory-sample.jpg',
    '/assets/editorial/bouquet-peach-sample.jpg',
    '/assets/editorial/bouquet-home.jpg',
  ],
  scenes: [
    { id: 'living', name: '客厅', path: '/assets/editorial/scene-living.jpg' },
    { id: 'dining', name: '餐桌', path: '/assets/editorial/scene-dining.jpg' },
    { id: 'bedroom', name: '卧室', path: '/assets/editorial/scene-bedroom.jpg' },
    { id: 'entryway', name: '玄关', path: '/assets/editorial/scene-entryway.jpg' },
  ],
} as const\n`, 'utf8')

const appConfigPath = path.join(root, 'miniprogram', 'app.json')
const appConfig = JSON.parse(await fs.readFile(appConfigPath, 'utf8'))
delete appConfig.subPackages
delete appConfig.subpackages
await fs.writeFile(appConfigPath, `${JSON.stringify(appConfig, null, 2)}\n`, 'utf8')
const totalBytes = manifest.reduce((sum, item) => sum + item.bytes, 0)
process.stdout.write('Prepared ' + manifest.length + ' CloudBase editorial images (' + (totalBytes / 1024 / 1024).toFixed(2) + ' MiB).\n')
