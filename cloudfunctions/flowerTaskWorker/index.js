const crypto = require('node:crypto')
const https = require('node:https')
const cloud = require('wx-server-sdk')
const cloudbase = require('@cloudbase/node-sdk')
const { normalizeRecognitionResult } = require('./recognition-validation')
const { buildImagePrompt, RECOGNITION_GUIDANCE } = require('./prompts')

const AI_REQUEST_TIMEOUT_MS = 600000

function dayKey(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

// wx-server-sdk timeout is milliseconds; the deployed function runtime limit
// is configured separately in cloudbaserc.json (seconds).
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: AI_REQUEST_TIMEOUT_MS })
const db = cloud.database()
const _ = db.command

async function readDocument(collectionName, documentId, source = db) {
  const result = await source.collection(collectionName).where({ _id: documentId }).limit(1).get()
  return result && Array.isArray(result.data) ? result.data[0] || null : null
}

const IMAGE_MODEL = String(process.env.AI_IMAGE_MODEL || 'HY-Image-v3.0-I2I-ToB-v1.0.1')
const IMAGE_PROVIDER = String(process.env.AI_IMAGE_PROVIDER || 'hunyuan-image')
const VISION_MODEL = String(process.env.AI_VISION_MODEL || '')
const VISION_PROVIDER = String(process.env.AI_VISION_PROVIDER || '')
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024
const OUTPUT_IMAGE_SIZE = '1024x1024'

function createAIApp() {
  const env = process.env.TCB_ENV || process.env.ENV_ID
  if (!env) throw new Error('CloudBase 环境未配置。')
  return cloudbase.init({ env, timeout: AI_REQUEST_TIMEOUT_MS })
}

function logError(task, error) {
  console.error('houseflower task worker failed', {
    taskId: task && task.taskId,
    type: task && task.type,
    errorName: error && error.name,
    errorCode: error && (error.code || error.Code),
  })
}

function parseJsonObject(value) {
  const text = String(value || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try { return JSON.parse(text) } catch {}
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < text.length; index += 1) {
      const char = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, index + 1)) } catch { break }
        }
      }
    }
  }
  throw new Error('识花结果格式无效。')
}

async function tempUrl(fileID, maxAge = 600) {
  const result = await cloud.getTempFileURL({ fileList: [{ fileID, maxAge }] })
  const item = result && result.fileList && result.fileList[0]
  if (!item || !item.tempFileURL) throw new Error('无法读取输入图片。')
  return item.tempFileURL
}

function download(url) {
  return new Promise((resolve, reject) => {
    let parsed
    try { parsed = new URL(url) } catch { reject(new Error('模型返回了无效图片地址。')); return }
    if (parsed.protocol !== 'https:') { reject(new Error('模型返回了不安全的图片地址。')); return }
    const request = https.get(parsed, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('生成图片下载失败。')); return }
      let total = 0
      const chunks = []
      response.on('data', (chunk) => {
        total += chunk.length
        if (total > MAX_OUTPUT_BYTES) request.destroy(new Error('生成图片过大。'))
        else chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })
    request.setTimeout(90000, () => request.destroy(new Error('生成图片下载超时。')))
    request.on('error', reject)
  })
}

async function saveOutput(task, buffer) {
  const extension = buffer[0] === 0x89 && buffer[1] === 0x50 ? 'png' : 'jpg'
  const cloudPath = `houseflower/private/${task.ownerId}/ai-output/${task.taskId}.${extension}`
  const uploaded = await cloud.uploadFile({ cloudPath, fileContent: buffer })
  if (!uploaded || !uploaded.fileID) throw new Error('生成结果保存失败。')
  const assetId = `asset_${task.taskId}_result`
  await db.collection('assets').doc(assetId).set({ data: {
    assetId, ownerId: task.ownerId, purpose: 'work-output', fileID: uploaded.fileID,
    cloudPath, status: 'ready', extension, bytes: buffer.length, taskId: task.taskId,
    createdAt: new Date(), updatedAt: new Date(),
  } })
  return assetId
}

async function checkpoint(task, patch) {
  let updated = false
  await db.runTransaction(async (transaction) => {
    updated = false
    const current = await transaction.collection('ai_tasks').doc(task._id).get()
    if (!current.data || current.data.status !== 'running' || current.data.claimToken !== task.claimToken) return
    await transaction.collection('ai_tasks').doc(task._id).update({ data: { ...patch, updatedAt: new Date() } })
    updated = true
  })
  if (!updated) throw new Error('TASK_LEASE_LOST')
  Object.assign(task, patch)
}

async function runBouquet(task, inputAsset) {
  if (task.stage === 'saving' && task.providerResultUrl) {
    const buffer = await download(task.providerResultUrl)
    return { resultAssetIds: [await saveOutput(task, buffer)], providerRequestId: task.providerRequestId || '' }
  }
  const url = await tempUrl(inputAsset.fileID)
  const app = createAIApp()
  const model = app.ai().createImageModel(IMAGE_PROVIDER)
  await checkpoint(task, { stage: 'generating', providerStartedAt: new Date() })
  const result = await model.generateImage({
    model: IMAGE_MODEL,
    prompt: buildImagePrompt(task.type, task.options && task.options.prompt),
    image_urls: [url],
    size: OUTPUT_IMAGE_SIZE,
    revise: { value: false },
  })
  const resultUrl = result && result.data && result.data[0] && result.data[0].url
  if (!resultUrl) throw new Error('模型未返回生成图片。')
  await checkpoint(task, { stage: 'saving', providerResultUrl: resultUrl, providerRequestId: result.id || '', leaseUntil: new Date(Date.now() + 12 * 60 * 1000) })
  const buffer = await download(task.providerResultUrl)
  return { resultAssetIds: [await saveOutput(task, buffer)], providerRequestId: result.id || '' }
}

async function runRecognition(task, inputAsset) {
  if (task.stage === 'saving' && task.resultDraft) return { result: task.resultDraft, providerRequestId: task.providerRequestId || '' }
  if (!VISION_PROVIDER || !VISION_MODEL) throw new Error('AI_VISION_MODEL_NOT_CONFIGURED')
  const downloaded = await cloud.downloadFile({ fileID: inputAsset.fileID })
  const buffer = downloaded && downloaded.fileContent
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error('识花图片无效或过大。')
  const imageUrl = await tempUrl(inputAsset.fileID)
  const app = createAIApp()
  const model = app.ai().createModel(VISION_PROVIDER)
  await checkpoint(task, { stage: 'generating', providerStartedAt: new Date() })
  const result = await model.generateText({
    model: VISION_MODEL,
    messages: [{ role: 'user', content: [
      { type: 'text', text: RECOGNITION_GUIDANCE },
      { type: 'image_url', image_url: { url: imageUrl } },
    ] }],
  })
  const normalized = normalizeRecognitionResult(parseJsonObject(result && result.text))
  if (normalized.error) throw new Error(normalized.error)
  const providerRequestId = result && result.rawResponses && result.rawResponses[0] && result.rawResponses[0].id || ''
  await checkpoint(task, { stage: 'saving', resultDraft: normalized.result, providerRequestId })
  return { result: normalized.result, providerRequestId }
}

async function claimTask() {
  const now = new Date()
  let query = await db.collection('ai_tasks').where({ status: 'queued', nextRunAt: _.lte(now) }).orderBy('createdAt', 'asc').limit(1).get()
  if (!query.data || !query.data.length) {
    query = await db.collection('ai_tasks').where({ status: 'queued', nextRunAt: _.exists(false) }).orderBy('createdAt', 'asc').limit(1).get()
  }
  if (!query.data || !query.data.length) query = await db.collection('ai_tasks').where({ status: 'running', leaseUntil: _.lte(now) }).orderBy('updatedAt', 'asc').limit(1).get()
  if (!query.data || !query.data.length) return null
  const task = query.data[0]
  const leaseUntil = new Date(Date.now() + 12 * 60 * 1000)
  let claimed = false
  let claimToken = ''
  await db.runTransaction(async (transaction) => {
    claimed = false
    claimToken = ''
    const current = await transaction.collection('ai_tasks').doc(task._id).get()
    const claimable = current.data && (current.data.status === 'queued' || (current.data.status === 'running' && current.data.leaseUntil && new Date(current.data.leaseUntil).getTime() <= now.getTime()))
    if (!claimable) return
    if (current.data.status === 'running' && current.data.stage !== 'saving') {
      await transaction.collection('ai_tasks').doc(task._id).update({ data: {
        status: 'reconciling', stage: 'reconciling', claimToken: '', leaseUntil: null,
        error: { code: 'PROVIDER_RESULT_UNKNOWN', message: '服务中断时正在核对生成结果，请勿重新提交。', retryable: false },
        reconcilingAt: now, updatedAt: now,
      } })
      return
    }
    claimToken = crypto.randomUUID()
    const stage = current.data.status === 'running' ? 'saving' : 'preparing'
    await transaction.collection('ai_tasks').doc(task._id).update({ data: { status: 'running', stage, claimToken, leaseUntil, attempt: _.inc(1), updatedAt: new Date() } })
    claimed = true
  })
  if (!claimed) return null
  const refreshed = await db.collection('ai_tasks').doc(task._id).get()
  return { ...refreshed.data, claimToken }
}

async function settle(task, patch, success) {
  const quotaId = `${task.ownerId}_${task.quotaDateKey}`
  const quotaSource = task.quotaSource === 'bonus' ? 'bonus' : 'daily'
  const now = new Date()
  let settled = false
  await db.runTransaction(async (transaction) => {
    settled = false
    const currentTask = await transaction.collection('ai_tasks').doc(task._id).get()
    if (!currentTask.data || currentTask.data.status !== 'running' || currentTask.data.claimToken !== task.claimToken) return
    if (quotaSource === 'bonus') {
      const userRef = transaction.collection('users').doc(task.ownerId)
      const userResult = await userRef.get()
      const user = userResult && userResult.data
      if (!user || Number(user.bonusQuotaReserved || 0) <= 0) throw new Error('赠送次数预占不存在。')
      const bonusBalance = Math.max(0, Number(user.bonusQuotaBalance) || 0)
      if (success && bonusBalance <= 0) throw new Error('赠送次数余额不存在。')
      await userRef.update({ data: {
        bonusQuotaReserved: Math.max(0, Number(user.bonusQuotaReserved) - 1),
        bonusQuotaBalance: success ? bonusBalance - 1 : bonusBalance,
        ...(user.activeTaskId === task.taskId ? { activeTaskId: '' } : {}),
        updatedAt: now,
      } })
    } else {
      const quota = await transaction.collection('daily_quotas').doc(quotaId).get()
      const value = quota.data || {}
      if ((Number(value.reserved) || 0) <= 0) throw new Error('额度预占不存在。')
      await transaction.collection('daily_quotas').doc(quotaId).update({ data: success ? { reserved: _.inc(-1), used: _.inc(1), updatedAt: now } : { reserved: _.inc(-1), updatedAt: now } })
    }
    await transaction.collection('ai_tasks').doc(task._id).update({ data: { ...patch, status: success ? 'succeeded' : 'failed', stage: success ? 'completed' : 'failed', claimToken: '', leaseUntil: null, completedAt: now, updatedAt: now } })
    if (quotaSource !== 'bonus') {
      const user = await transaction.collection('users').doc(task.ownerId).get()
      if (user.data && user.data.activeTaskId === task.taskId) await transaction.collection('users').doc(task.ownerId).update({ data: { activeTaskId: '' } })
    }
    if (success && Array.isArray(patch.resultAssetIds)) {
      for (const assetId of patch.resultAssetIds) {
        const refId = `task_${task.taskId}_${assetId}`
        await transaction.collection('asset_refs').doc(refId).set({ data: { assetId, resourceType: 'task', resourceId: task.taskId, ownerId: task.ownerId, createdAt: now } })
      }
    }
    await transaction.collection('quota_ledger').doc(`${task.reservationId}_${success ? 'commit' : 'release'}`).set({ data: { reservationId: task.reservationId, taskId: task.taskId, ownerId: task.ownerId, dateKey: task.quotaDateKey, entryType: success ? 'commit' : 'release', quotaSource, amount: success ? 1 : -1, createdAt: now } })
    settled = true
  })
  return settled
}

async function expireUnknownResults() {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const query = await db.collection('ai_tasks')
    .where({ status: 'reconciling', reconcilingAt: _.lte(cutoff) })
    .orderBy('reconcilingAt', 'asc').limit(1).get()
  const task = query.data && query.data[0]
  if (!task) return false
  const quotaId = `${task.ownerId}_${task.quotaDateKey}`
  const quotaSource = task.quotaSource === 'bonus' ? 'bonus' : 'daily'
  await db.runTransaction(async (transaction) => {
    const currentResult = await transaction.collection('ai_tasks').doc(task._id).get()
    const current = currentResult && currentResult.data
    if (!current || current.status !== 'reconciling' || new Date(current.reconcilingAt || now).getTime() > cutoff.getTime()) return
    const releaseId = `${current.reservationId}_unknown_release`
    const prior = await readDocument('quota_ledger', releaseId, transaction)
    if (!prior) {
      if (quotaSource === 'bonus') {
        const userRef = transaction.collection('users').doc(current.ownerId)
        const userResult = await userRef.get()
        const user = userResult && userResult.data
        if (!user || Number(user.bonusQuotaReserved || 0) < 1) throw new Error('无法安全释放未核对的赠送次数。')
        await userRef.update({ data: {
          bonusQuotaReserved: Math.max(0, Number(user.bonusQuotaReserved) - 1),
          ...(user.activeTaskId === current.taskId ? { activeTaskId: '' } : {}),
          updatedAt: now,
        } })
      } else {
        const quotaResult = await transaction.collection('daily_quotas').doc(quotaId).get()
        const quota = quotaResult && quotaResult.data
        if (!quota || Number(quota.reserved || 0) < 1) throw new Error('无法安全释放未核对任务的额度。')
        await transaction.collection('daily_quotas').doc(quotaId).update({ data: { reserved: _.inc(-1), updatedAt: now } })
      }
      await transaction.collection('quota_ledger').doc(releaseId).set({ data: {
        reservationId: current.reservationId, taskId: current.taskId, ownerId: current.ownerId,
        dateKey: current.quotaDateKey, entryType: 'release', quotaSource, amount: -1, reason: 'provider_result_unavailable', createdAt: now,
      } })
    }
    await transaction.collection('ai_tasks').doc(task._id).update({ data: {
      status: 'failed', stage: 'failed', leaseUntil: null,
      completedAt: now,
      error: { code: 'PROVIDER_RESULT_UNAVAILABLE', message: '超过核对时限，次数已返还；如仍需要，请重新提交。', retryable: true }, updatedAt: now,
    } })
    if (quotaSource !== 'bonus') {
      const userResult = await transaction.collection('users').doc(current.ownerId).get()
      if (userResult.data && userResult.data.activeTaskId === current.taskId) await transaction.collection('users').doc(current.ownerId).update({ data: { activeTaskId: '' } })
    }
  })
  return true
}

async function markUncertain(task, error) {
  await db.runTransaction(async (transaction) => {
    const current = await transaction.collection('ai_tasks').doc(task._id).get()
    if (!current.data || current.data.status !== 'running' || current.data.claimToken !== task.claimToken) return
    await transaction.collection('ai_tasks').doc(task._id).update({ data: {
      status: 'reconciling', stage: 'reconciling', claimToken: '', leaseUntil: null,
      error: { code: 'PROVIDER_RESULT_UNKNOWN', message: '生成服务暂时中断，正在核对结果；请勿重复提交。', retryable: false },
      providerErrorCode: String(error && (error.code || error.errCode) || '').slice(0, 80),
      reconcilingAt: new Date(), updatedAt: new Date(),
    } })
  })
}

async function createTaskNotification(task) {
  const templateId = String(process.env.SUBSCRIBE_TEMPLATE_TASK || '')
  if (!templateId) return
  const jobId = `task_${task.taskId}`
  await db.collection('notification_jobs').doc(jobId).set({ data: {
    jobId, ownerId: task.ownerId, openId: task.ownerOpenId, type: 'ai_task',
    templateId, taskId: task.taskId, dueAt: new Date(), status: 'queued', attempts: 0,
    payload: { title: task.type === 'recognition' ? '识花清单已完成' : task.type === 'scene' ? '场景效果已完成' : '花束效果已完成', note: '打开 House花生 查看结果' },
    createdAt: new Date(), updatedAt: new Date(),
  } }).catch(() => {})
}

async function processOne() {
  const task = await claimTask()
  if (!task) return false
  try {
    if (task.stage !== 'saving' && process.env.AI_RESOURCES_ENABLED !== 'true') throw new Error('AI_RESOURCES_DISABLED')
    if (task.stage !== 'saving' && task.type === 'recognition' && process.env.AI_VISION_ENABLED !== 'true') throw new Error('AI_VISION_DISABLED')
    let result
    if (task.stage === 'saving') {
      result = task.type === 'recognition'
        ? { result: task.resultDraft, providerRequestId: task.providerRequestId || '' }
        : await runBouquet(task, null)
    } else {
      const input = await db.collection('assets').where({ ownerId: task.ownerId, assetId: _.in(task.inputAssetIds || []), status: 'ready' }).limit(3).get()
      if (!input.data || !input.data.length) throw new Error('输入素材不存在。')
      if (task.type === 'recognition') result = await runRecognition(task, input.data[0])
      else result = await runBouquet(task, input.data[0])
    }
    const settled = await settle(task, { resultAssetIds: result.resultAssetIds || [], result: result.result || null, providerRequestId: result.providerRequestId || '' }, true)
    if (settled) await createTaskNotification(task)
  } catch (error) {
    logError(task, error)
    if (task.stage === 'saving') {
      await checkpoint(task, { leaseUntil: new Date(Date.now() + 60 * 1000) }).catch((checkpointError) => logError(task, checkpointError))
      return true
    }
    if (task.stage === 'generating') {
      await markUncertain(task, error).catch((reconcileError) => logError(task, reconcileError))
      return true
    }
    const code = error && error.message === 'AI_RESOURCES_DISABLED' ? 'AI_DISABLED'
      : error && ['AI_VISION_DISABLED', 'AI_VISION_MODEL_NOT_CONFIGURED'].includes(error.message) ? 'AI_VISION_DISABLED'
        : 'TASK_FAILED'
    const message = code === 'AI_DISABLED' ? 'AI 生成服务尚未开启。'
      : code === 'AI_VISION_DISABLED' ? '识花视觉模型尚未开启。'
        : 'AI 任务暂时未能完成，请稍后重试或更换图片。'
    await settle(task, { error: { code, message, retryable: code === 'TASK_FAILED' } }, false).catch((settleError) => logError(task, settleError))
  }
  return true
}

exports.main = async () => {
  await expireUnknownResults()
  let processed = 0
  while (processed < 1 && await processOne()) processed += 1
  return { ok: true, processed }
}
