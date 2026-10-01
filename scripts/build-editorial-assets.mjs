import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(root, 'flower-assets', 'editorial', 'source')
const outputRoot = path.join(root, 'miniprogram', 'assets', 'editorial')
const assets = [
  'bouquet-home', 'bouquet-ivory-sample', 'bouquet-peach-sample',
  'inspiration-garden',
  'scene-living', 'scene-dining', 'scene-bedroom', 'scene-entryway',
  'case-truman-reference', 'case-truman-result',
  'case-jay-reference', 'case-jay-result',
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
const maxEdge = 400
const quality = 68
const homeHeroMaxEdge = 640
const homeHeroQuality = 70

await fs.mkdir(outputRoot, { recursive: true })
const catalogPath = path.join(root, 'flower-assets', 'editorial', 'catalog.json')
const manifest = new Map()
const generatedFiles = new Set()
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

for (const id of assets) {
  const sourcePath = await findSourcePath(id)
  const targetPath = path.join(outputRoot, id + '.jpg')
  const imageMaxEdge = id === 'bouquet-home' ? homeHeroMaxEdge : maxEdge
  const imageQuality = id === 'bouquet-home' ? homeHeroQuality : quality
  const metadata = await sharp(sourcePath).metadata()
  await sharp(sourcePath).rotate().resize({ width: imageMaxEdge, height: imageMaxEdge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#f6f1ea' }).jpeg({ quality: imageQuality, mozjpeg: true }).toFile(targetPath)
  generatedFiles.add(id + '.jpg')
  const stat = await fs.stat(targetPath)
  manifest.set(id, {
    id,
    sourcePath: path.relative(root, sourcePath).split(path.sep).join('/'),
    assetPath: '/assets/editorial/' + id + '.jpg',
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    size: stat.size,
  })
}

for (const id of pairedCases) {
  const sourcePath = path.join(sourceRoot, 'inspiration-' + id + '-diptych.png')
  const metadata = await sharp(sourcePath).metadata()
  const leftWidth = Math.floor(metadata.width / 2)
  for (const [variant, left] of [['reference', 0], ['flower', leftWidth]]) {
    const width = variant === 'reference' ? leftWidth : metadata.width - leftWidth
    const imageId = 'inspiration-' + id + '-' + variant
    const targetPath = path.join(outputRoot, imageId + '.jpg')
    await sharp(sourcePath).extract({ left, top: 0, width, height: metadata.height })
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: variant === 'flower' ? '#000000' : '#f6f1ea' })
      .jpeg({ quality, mozjpeg: true }).toFile(targetPath)
    generatedFiles.add(imageId + '.jpg')
    const imageMetadata = await sharp(targetPath).metadata()
    const stat = await fs.stat(targetPath)
    manifest.set(imageId, {
      id: imageId,
      sourcePath: path.relative(root, sourcePath).split(path.sep).join('/'),
      variant,
      assetPath: '/assets/editorial/' + imageId + '.jpg',
      sourceWidth: width,
      sourceHeight: metadata.height,
      outputWidth: imageMetadata.width,
      outputHeight: imageMetadata.height,
      size: stat.size,
    })
  }
}

for (const name of await fs.readdir(outputRoot)) {
  if ((name.endsWith('.webp') || name.endsWith('.jpg')) && !generatedFiles.has(name)) {
    await fs.rm(path.join(outputRoot, name), { force: true })
  }
}

await fs.writeFile(catalogPath, `${JSON.stringify([...manifest.values()], null, 2)}\n`, 'utf8')
const inspirationCaseMap = [
  ...pairedCases.map((id) => `    '${id}': { reference: '/assets/editorial/inspiration-${id}-reference.jpg', flower: '/assets/editorial/inspiration-${id}-flower.jpg' },`),
  "    'truman': { reference: '/assets/editorial/case-truman-reference.jpg', flower: '/assets/editorial/case-truman-result.jpg' },",
  "    'jay': { reference: '/assets/editorial/case-jay-reference.jpg', flower: '/assets/editorial/case-jay-result.jpg' },",
  "    'starry-night': { reference: '/assets/editorial/case-starry-night-pd-reference.jpg', flower: '/assets/editorial/case-starry-night-result.jpg' },",
  "    'great-wave': { reference: '/assets/editorial/case-great-wave-reference.jpg', flower: '/assets/editorial/case-great-wave-result.jpg' },",
  "    'japanese-bridge': { reference: '/assets/editorial/case-monet-bridge-reference.jpg', flower: '/assets/editorial/case-japanese-bridge-result.jpg' },",
].join('\n')
await fs.writeFile(path.join(root, 'miniprogram', 'data', 'editorial-assets.ts'), `// Generated by scripts/build-editorial-assets.mjs.\nexport const EDITORIAL_ASSETS = {
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

const totalBytes = [...manifest.values()].reduce((sum, item) => sum + item.size, 0)
process.stdout.write('Optimized ' + assets.length + ' editorial JPEG images; catalog contains ' + manifest.size + ' assets (' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB).\n')
