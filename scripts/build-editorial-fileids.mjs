import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const storageConfig = JSON.parse(await fs.readFile(path.join(root, 'flower-assets', 'editorial', 'storage-prefix.json'), 'utf8'))
const prefix = String(process.argv[2] || storageConfig.fileIdPrefix || '').trim()
if (!/^cloud:\/\/[a-zA-Z0-9._-]+\/editorial\/$/.test(prefix)) {
  throw new Error('Pass the exact CloudBase fileID prefix ending with /editorial/.')
}

const manifestPath = path.join(root, 'flower-assets', 'editorial', 'cloud-ready', 'asset-manifest.json')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
if (!Array.isArray(manifest.assets) || !manifest.assets.length) throw new Error('Cloud asset manifest is empty.')

const fileIds = Object.fromEntries(manifest.assets.map((asset) => [asset.key, prefix + asset.fileName]))
await fs.writeFile(
  path.join(root, 'cloudfunctions', 'flowerBackend', 'editorial-assets.json'),
  `${JSON.stringify(fileIds, null, 2)}\n`,
  'utf8',
)
process.stdout.write('Mapped ' + Object.keys(fileIds).length + ' editorial keys to CloudBase fileIDs.\n')
