import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const quota = require('../cloudfunctions/flowerBackend/quota.js')
const { normalizeMaterialRows } = require('../cloudfunctions/flowerBackend/record-validation.js')
const { normalizeRecognitionResult } = require('../cloudfunctions/flowerTaskWorker/recognition-validation.js')
const { buildImagePrompt, RECOGNITION_GUIDANCE } = require('../cloudfunctions/flowerTaskWorker/prompts.js')
const retention = require('../cloudfunctions/houseflowerMaintenance/retention.js')

const beforeMidnight = new Date('2026-09-30T15:59:59.000Z')
const afterMidnight = new Date('2026-09-30T16:00:00.000Z')
assert.equal(quota.dayKey(beforeMidnight), '2026-09-30')
assert.equal(quota.dayKey(afterMidnight), '2026-10-01')
assert.equal(quota.normalizeQuota({ used: 3, reserved: 2 }, afterMidnight).remaining, 5)
assert.equal(quota.normalizeQuota({ used: 10, reserved: 0 }, afterMidnight).remaining, 0)
assert.equal(quota.normalizeQuota({ used: 10, reserved: 0 }, afterMidnight, { bonusQuotaBalance: 4, bonusQuotaReserved: 1 }).remaining, 3)
assert.equal(quota.normalizeQuota({ used: 10, reserved: 0 }, afterMidnight, { bonusQuotaBalance: 4, bonusQuotaReserved: 1 }).bonusRemaining, 3)
assert.equal(quota.quotaSource({ used: 9, reserved: 1 }, { bonusQuotaBalance: 2 }), 'bonus')
assert.equal(quota.quotaSource({ used: 9, reserved: 0 }, { bonusQuotaBalance: 2 }), 'daily')
assert.equal(quota.quotaSource({ used: 10, reserved: 0 }, { bonusQuotaBalance: 0 }), '')
assert.match(quota.nextResetAt(afterMidnight), /^2026-10-01T16:00:00\.000Z$/)

const retentionNow = Date.parse('2026-10-01T12:00:00.000Z')
assert.equal(retention.isExpiredTerminalTask({ status: 'succeeded', completedAt: new Date(retentionNow - retention.DAY_MS) }, retentionNow), true)
assert.equal(retention.isExpiredTerminalTask({ status: 'succeeded', completedAt: new Date(retentionNow - retention.DAY_MS + 1) }, retentionNow), false)
assert.equal(retention.isExpiredTerminalTask({ status: 'queued', createdAt: new Date(retentionNow - retention.DAY_MS * 3) }, retentionNow), false)
assert.deepEqual(retention.taskAssetIds({
  inputAssetIds: ['input-1', 'shared'], resultAssetIds: ['output-1'],
  options: { sceneSourceAssetId: 'room-1', sceneBouquetAssetId: 'shared' },
}), ['input-1', 'shared', 'output-1', 'room-1'])

const materialCheck = normalizeMaterialRows([{
  id: 'rose-1', name: '粉色玫瑰', colorLabel: '粉色',
  quantityMin: 7, quantityMax: 4, unit: '支', confirmed: false,
  assetPath: '/private/other-user/image.png', swatch: 'url(https://example.test)',
}])
assert.equal(materialCheck.error, '')
assert.equal(materialCheck.rows[0].quantityMin, 4)
assert.equal(materialCheck.rows[0].quantityMax, 7)
assert.equal(materialCheck.rows[0].quantityLabel, '约4–7支')
assert.equal(materialCheck.rows[0].assetPath, '')
assert.equal(materialCheck.rows[0].swatch, '#d7c2b8')
const bundledMaterial = normalizeMaterialRows([{ name: '玫瑰', assetPath: '/assets/materials-ui/rose_001.jpg' }])
assert.equal(bundledMaterial.rows[0].assetPath, '/assets/materials-ui/rose_001.jpg')
assert.equal(normalizeMaterialRows([{ name: '' }]).error, '花材名称不能为空。')
assert.match(normalizeMaterialRows(Array.from({ length: 61 }, (_, index) => ({ name: String(index) }))).error, /60/)

const recognition = normalizeRecognitionResult({ items: [
  { name: '玫瑰', minimum: 8, maximum: 5, unit: 'invalid', confirmed: true },
  { name: '', minimum: 2, maximum: 3 },
], notes: ['请确认数量'] })
assert.equal(recognition.error, '')
assert.equal(recognition.result.items.length, 1)
assert.equal(recognition.result.items[0].minimum, 5)
assert.equal(recognition.result.items[0].maximum, 8)
assert.equal(recognition.result.items[0].unit, '支')
assert.equal(recognition.result.items[0].confirmed, false)
assert.equal(normalizeRecognitionResult({ items: [{ name: '' }] }).error, '没有识别到可确认的花材。')
assert.match(buildImagePrompt('bouquet'), /不生成花材清单/)
assert.match(buildImagePrompt('bouquet'), /明显承接原图的气质/)
assert.match(buildImagePrompt('bouquet'), /包花纸/)
assert.match(buildImagePrompt('bouquet'), /丝带/)
assert.match(buildImagePrompt('bouquet'), /锐利/)
assert.match(buildImagePrompt('bouquet'), /纯黑/)
assert.match(buildImagePrompt('bouquet'), /一类主花明确成为视觉中心/)
assert.match(buildImagePrompt('bouquet'), /上传图只用于提取灵感/)
assert.match(buildImagePrompt('bouquet'), /包装色和包装结构也要承接原图/)
assert.match(buildImagePrompt('bouquet'), /不对称留白/)
assert.match(buildImagePrompt('bouquet'), /纯黑色 #000000（RGB 0,0,0）/)
assert.match(buildImagePrompt('bouquet'), /1:1 正方形画布/)
assert.match(buildImagePrompt('bouquet'), /彻底移除并替换原图背景/)
assert.match(buildImagePrompt('bouquet', '换成暖色'), /不得覆盖完整花束、纯黑背景/)
assert.match(buildImagePrompt('scene'), /保留房间布局/)
assert.match(buildImagePrompt('scene'), /1:1 正方形画布/)
const workerSource = fs.readFileSync(path.resolve('cloudfunctions/flowerTaskWorker/index.js'), 'utf8')
assert.match(workerSource, /OUTPUT_IMAGE_SIZE = '1024x1024'/)
assert.match(workerSource, /size: OUTPUT_IMAGE_SIZE/)
assert.equal(buildImagePrompt('bouquet', 'x'.repeat(1000)), buildImagePrompt('bouquet', 'x'.repeat(400)))
assert.match(RECOGNITION_GUIDANCE, /minimum.*maximum/)
const backendSource = fs.readFileSync(path.resolve('cloudfunctions/flowerBackend/index.js'), 'utf8')
assert.match(backendSource, /原图超过 10 MB，请选择一张更小的原图/)

const projectConfig = JSON.parse(fs.readFileSync(path.resolve('project.config.json'), 'utf8'))
assert.equal(projectConfig.cloudfunctionRoot, 'cloudfunctions/')
const cloudbaseConfig = JSON.parse(fs.readFileSync(path.resolve('cloudbaserc.json'), 'utf8'))
assert.equal(cloudbaseConfig.envId, 'huasheng-d1gevhc4b9cc370ca')
assert.equal(cloudbaseConfig.functions.find((item) => item.name === 'flowerTaskWorker').triggers[0].type, 'timer')
assert.equal(cloudbaseConfig.functions.find((item) => item.name === 'flowerTaskWorker').envVariables.AI_RESOURCES_ENABLED, 'true')
assert.equal(cloudbaseConfig.functions.find((item) => item.name === 'flowerTaskWorker').envVariables.AI_VISION_ENABLED, 'false')

console.log('backend core: OK')
