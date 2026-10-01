import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = path.join(root, 'miniprogram', 'data', 'flower-catalog.ts')
const sourceRoot = path.join(root, 'flower-assets', 'materials', 'source')
const outputRoot = path.join(root, 'miniprogram', 'assets', 'materials-ui')
const original = await fs.readFile(catalogPath, 'utf8')
const source = original.replace(/\/assets\/materials\/([a-zA-Z0-9_-]+)\.(?:webp|jpg)/g, '/assets/materials-ui/$1.jpg')
const names = [...source.matchAll(/"assetPath"\s*:\s*"\/assets\/materials-ui\/([a-zA-Z0-9_-]+)\.jpg"/g)]
  .map((match) => match[1])
if (!names.length) throw new Error('No material image paths found in flower-catalog.ts.')

await fs.mkdir(outputRoot, { recursive: true })
let totalBytes = 0
for (const name of names) {
  const input = path.join(sourceRoot, name + '.png')
  const output = path.join(outputRoot, name + '.jpg')
  const image = await sharp(input).rotate()
    .resize({ width: 192, height: 288, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#fffdf9' })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer()
  await fs.writeFile(output, image)
  totalBytes += image.length
}

process.stdout.write('Optimized ' + names.length + ' material JPEG images (' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB).\n')
