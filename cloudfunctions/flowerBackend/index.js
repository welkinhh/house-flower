const crypto = require('node:crypto')
const cloud = require('wx-server-sdk')
const sharp = require('sharp')
const { normalizeMaterialRows } = require('./record-validation')
const EDITORIAL_ASSET_FILE_IDS = require('./editorial-assets.json')
const {
  DAILY_QUOTA_LIMIT,
  dayKey,
  userIdFor,
  quotaId,
  quotaSource,
  normalizeQuota,
} = require('./quota')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 120000,
})

const db = cloud.database()
const _ = db.command

const AI_TYPES = new Set(['bouquet', 'recognition', 'scene'])
const ASSET_PURPOSES = new Set(['inspiration', 'recognition', 'scene', 'avatar', 'work-output', 'work-cover', 'materials-export'])
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_SCENE_PIXELS = 24 * 1000 * 1000

function adminOpenIds() {
  return String(process.env.ADMIN_OPENIDS || '').split(',').map((value) => value.trim()).filter(Boolean)
}

function isAdmin(identity) {
  return adminOpenIds().includes(identity.openid)
}

function requestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`
}

function ok(data, id) {
  return { ok: true, data, requestId: id }
}

function fail(code, message, retryable = false, id) {
  return { ok: false, error: { code, message, retryable }, requestId: id }
}

function getContext(context) {
  const wxContext = cloud.getWXContext ? cloud.getWXContext() : {}
  const openid = String((wxContext && (wxContext.OPENID || wxContext.openid)) || (context && (context.OPENID || context.openid)) || '')
  const appid = String((wxContext && (wxContext.APPID || wxContext.appid)) || (context && (context.APPID || context.appid)) || '')
  return { openid, appid, userId: openid ? userIdFor(openid, appid) : '' }
}

function requireIdentity(identity, id) {
  if (!identity.openid || !identity.userId) throw new BackendError('AUTH_REQUIRED', '无法读取当前微信用户，请重新打开小程序后重试。', false, id)
}

class BackendError extends Error {
  constructor(code, message, retryable = false, request) {
    super(message)
    this.code = code
    this.retryable = retryable
    this.request = request
  }
}

function ensureString(value, field, max = 200) {
  const text = String(value || '').trim()
  if (!text || text.length > max) throw new BackendError('INVALID_INPUT', `${field} 格式不正确。`)
  return text
}

function ensureDocumentId(value, field, max = 120) {
  const id = ensureString(value, field, max)
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new BackendError('INVALID_INPUT', `${field} 格式不正确。`)
  return id
}

async function readDocument(collectionName, documentId, source = db) {
  const result = await source.collection(collectionName).where({ _id: documentId }).limit(1).get()
  return result && Array.isArray(result.data) ? result.data[0] || null : null
}

function ensureIdempotencyKey(value) {
  const key = ensureString(value, '幂等键', 160)
  if (!/^[a-zA-Z0-9._:-]+$/.test(key)) throw new BackendError('INVALID_INPUT', '幂等键包含不支持的字符。')
  return key
}

async function getOrCreateUser(identity) {
  const users = db.collection('users')
  const identities = db.collection('identities')
  const identityQuery = await identities.doc(identity.userId).get().catch(() => null)
  if (identityQuery && identityQuery.data) {
    const userQuery = await users.doc(identity.userId).get()
    return userQuery.data
  }

  const now = new Date()
  const user = {
    userId: identity.userId,
    status: 'active',
    nickname: '',
    avatarAssetId: '',
    activeTaskId: '',
    bonusQuotaBalance: 0,
    bonusQuotaReserved: 0,
    createdAt: now,
    lastSeenAt: now,
  }
  try {
    await users.doc(identity.userId).set({ data: user })
    await identities.doc(identity.userId).set({ data: { userId: identity.userId, appId: identity.appid, openId: identity.openid, createdAt: now } })
    return user
  } catch (error) {
    const retry = await users.doc(identity.userId).get().catch(() => null)
    if (retry && retry.data) return retry.data
    throw error
  }
}

async function ensureQuota(userId, date = new Date()) {
  const dateKey = dayKey(date)
  const id = quotaId(userId, date)
  let current = await readDocument('daily_quotas', id)
  if (!current) {
    const now = new Date()
    try {
      await db.runTransaction(async (transaction) => {
        const currentInTransaction = await readDocument('daily_quotas', id, transaction)
        if (currentInTransaction) return
        await transaction.collection('daily_quotas').doc(id).set({ data: { userId, dateKey, limit: DAILY_QUOTA_LIMIT, used: 0, reserved: 0, createdAt: now, updatedAt: now } })
      })
    } catch (error) {
      // Accept only a successful reread after a concurrent initializer. A
      // failed read or transaction must never be interpreted as a new quota.
      current = await readDocument('daily_quotas', id)
      if (!current) throw error
    }
  }
  current = current || await readDocument('daily_quotas', id)
  if (!current) throw new BackendError('QUOTA_UNAVAILABLE', '今日次数暂时无法读取，请稍后重试。', true)
  return { id, data: current }
}

async function getQuota(userId, date = new Date()) {
  const current = await ensureQuota(userId, date)
  const user = await readDocument('users', userId)
  return normalizeQuota(current.data, date, user || {})
}

async function bootstrap(identity, id) {
  requireIdentity(identity, id)
  const user = await getOrCreateUser(identity)
  if (user && user.status && user.status !== 'active') throw new BackendError('ACCOUNT_UNAVAILABLE', '账号删除流程已开始，当前不可继续操作。')
  await db.collection('users').doc(identity.userId).update({ data: { lastSeenAt: new Date() } }).catch(() => {})
  const quota = await getQuota(identity.userId)
  return ok({
    user: { userId: identity.userId, nickname: user.nickname || '', avatarAssetId: user.avatarAssetId || '', status: user.status || 'active' },
    quota,
    isAdmin: isAdmin(identity),
    subscriptionTemplates: { date: String(process.env.SUBSCRIBE_TEMPLATE_DATE || ''), task: String(process.env.SUBSCRIBE_TEMPLATE_TASK || '') },
  }, id)
}

async function recordEvent(identity, eventName, properties = {}) {
  const safeName = String(eventName || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80)
  if (!safeName) return
  const now = new Date()
  const eventId = `event_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`
  await db.collection('analytics_events').doc(eventId).set({ data: {
    eventId, eventName: safeName, ownerId: identity.userId, openId: identity.openid,
    dateKey: dayKey(now), properties: properties && typeof properties === 'object' ? properties : {}, createdAt: now,
  } }).catch(() => {})
}

function dateAtShanghai(dateKey, hour = 9) {
  return new Date(`${dateKey}T${String(hour).padStart(2, '0')}:00:00+08:00`)
}

async function createDateNotification(identity, dateRecord) {
  const templateId = String(process.env.SUBSCRIBE_TEMPLATE_DATE || '')
  if (!templateId || !dateRecord || !dateRecord.date) return
  const dueAt = dateAtShanghai(dateRecord.date, 9)
  if (dateRecord.repeatYearly && dueAt.getTime() < Date.now()) dueAt.setFullYear(dueAt.getFullYear() + 1)
  const jobId = `date_${dateRecord.id}_${dueAt.getFullYear()}`
  await db.collection('notification_jobs').doc(jobId).set({ data: {
    jobId, ownerId: identity.userId, openId: identity.openid, type: 'important_date',
    templateId, dateId: dateRecord.id, dueAt, status: 'queued', attempts: 0,
    payload: { title: dateRecord.title, date: dateRecord.date, note: dateRecord.note || '' }, createdAt: new Date(), updatedAt: new Date(),
  } }).catch(() => {})
}

async function saveSubscription(event, identity, id) {
  requireIdentity(identity, id)
  const results = event.results && typeof event.results === 'object' ? event.results : {}
  const saved = []
  for (const [templateId, status] of Object.entries(results)) {
    if (!templateId || !['accept', 'reject', 'ban'].includes(String(status))) continue
    const recordId = `subscription_${identity.userId}_${templateId}`
    await db.collection('subscription_records').doc(recordId).set({ data: {
      recordId, ownerId: identity.userId, openId: identity.openid,
      templateId, status: String(status), authorizedAt: new Date(), updatedAt: new Date(),
    } })
    saved.push({ templateId, status: String(status) })
  }
  await recordEvent(identity, 'subscription_result', { results: saved })
  return ok({ subscriptions: saved }, id)
}

async function trackEvent(event, identity, id) {
  requireIdentity(identity, id)
  await recordEvent(identity, ensureString(event.eventName, '事件名称', 80), event.properties)
  return ok({ tracked: true }, id)
}

async function adminSummary(event, identity, id) {
  requireIdentity(identity, id)
  if (!isAdmin(identity)) throw new BackendError('FORBIDDEN', '当前账号没有运营数据权限。')
  const range = Math.max(1, Math.min(90, Number(event.range) || 30))
  const start = new Date(Date.now() - range * 24 * 60 * 60 * 1000)
  const events = await db.collection('analytics_events').where({ createdAt: _.gte(start) }).orderBy('createdAt', 'desc').limit(5000).get().catch(() => ({ data: [] }))
  const tasks = await db.collection('ai_tasks').where({ createdAt: _.gte(start) }).limit(5000).get().catch(() => ({ data: [] }))
  const works = await db.collection('works').where({ createdAt: _.gte(start) }).limit(5000).get().catch(() => ({ data: [] }))
  const users = await db.collection('users').where({ createdAt: _.gte(start) }).limit(5000).get().catch(() => ({ data: [] }))
  const notificationJobs = await db.collection('notification_jobs').where({ createdAt: _.gte(start) }).limit(5000).get().catch(() => ({ data: [] }))
  const eventRows = events.data || []
  const taskRows = tasks.data || []
  const workRows = works.data || []
  const preferences = {}
  eventRows.forEach((row) => {
    const property = row.properties || {}
    const key = property.category || property.caseId || property.title
    if (key) preferences[String(key)] = (preferences[String(key)] || 0) + 1
  })
  const taskByType = {}
  taskRows.forEach((task) => {
    const type = task.type || 'unknown'
    taskByType[type] = taskByType[type] || { total: 0, succeeded: 0, failed: 0 }
    taskByType[type].total += 1
    if (task.status === 'succeeded') taskByType[type].succeeded += 1
    if (task.status === 'failed') taskByType[type].failed += 1
  })
  const eventCounts = {}
  eventRows.forEach((row) => { eventCounts[row.eventName] = (eventCounts[row.eventName] || 0) + 1 })
  const subscriptionAccepts = eventRows.reduce((total, row) => total + (row.eventName === 'subscription_result' && Array.isArray(row.properties && row.properties.results) ? row.properties.results.filter((item) => item.status === 'accept').length : 0), 0)
  return ok({
    range, generatedAt: new Date().toISOString(), truncated: eventRows.length >= 5000 || taskRows.length >= 5000,
    overview: {
      newUsers: users.data ? users.data.length : 0,
      activeUsers: new Set(eventRows.map((row) => row.ownerId)).size,
      aiTasks: taskRows.length,
      aiSucceeded: taskRows.filter((task) => task.status === 'succeeded').length,
      aiFailed: taskRows.filter((task) => task.status === 'failed').length,
      savedWorks: workRows.filter((work) => work.kind !== 'materials').length,
      savedLists: workRows.filter((work) => Array.isArray(work.rows) && work.rows.length > 0).length,
      subscriptionAccepts,
      notificationsSent: (notificationJobs.data || []).filter((job) => job.status === 'sent').length,
    },
    taskByType: Object.entries(taskByType).map(([type, stats]) => ({ type, ...stats })),
    eventCounts,
    preferences: Object.entries(preferences).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 20),
  }, id)
}

async function grantBonusQuota(event, identity, id) {
  requireIdentity(identity, id)
  if (!isAdmin(identity)) throw new BackendError('FORBIDDEN', '当前账号没有赠送次数权限。')
  const targetUserId = ensureString(event.userId, '用户 ID', 64)
  if (!/^[a-f0-9]{32}$/i.test(targetUserId)) throw new BackendError('INVALID_INPUT', '请输入作品页设置中显示的完整用户 ID。')
  const count = Number(event.count)
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new BackendError('INVALID_INPUT', '赠送次数需为 1–1000 的整数。')
  const grantKey = ensureIdempotencyKey(event.grantId)
  const grantDocId = `gift_${crypto.createHash('sha256').update(`${identity.userId}:${grantKey}`).digest('hex').slice(0, 40)}`
  const reason = String(event.reason || '').trim().slice(0, 120)
  const now = new Date()
  let alreadyGranted = false
  await db.runTransaction(async (transaction) => {
    alreadyGranted = false
    const prior = await readDocument('quota_ledger', grantDocId, transaction)
    if (prior) {
      if (prior.ownerId !== targetUserId || Number(prior.amount) !== count || String(prior.reason || '') !== reason) {
        throw new BackendError('IDEMPOTENCY_CONFLICT', '这笔赠送编号已用于其他内容，请重新提交。')
      }
      alreadyGranted = true
      return
    }
    const userRef = transaction.collection('users').doc(targetUserId)
    const userResult = await userRef.get()
    const target = userResult && userResult.data
    if (!target || target.status !== 'active') throw new BackendError('NOT_FOUND', '用户不存在或账号当前不可用。')
    const currentBalance = Math.max(0, Number(target.bonusQuotaBalance) || 0)
    await userRef.update({ data: { bonusQuotaBalance: currentBalance + count, updatedAt: now } })
    await transaction.collection('quota_ledger').doc(grantDocId).set({ data: {
      ownerId: targetUserId,
      actorId: identity.userId,
      entryType: 'gift',
      amount: count,
      reason,
      createdAt: now,
    } })
  })
  const quota = await getQuota(targetUserId)
  return ok({ userId: targetUserId, count, alreadyGranted, quota }, id)
}

async function prepareUpload(event, identity, id) {
  requireIdentity(identity, id)
  const purpose = ensureString(event.purpose, '文件用途', 40)
  if (!ASSET_PURPOSES.has(purpose)) throw new BackendError('INVALID_INPUT', '不支持的文件用途。')
  const extension = String(event.extension || '').toLowerCase()
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(extension)) throw new BackendError('INVALID_INPUT', '暂不支持此图片格式。')
  const assetId = `asset_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`
  // The upload prefix intentionally uses the trusted WeChat openid so a
  // storage rule can restrict direct client uploads to that user's folder.
  // CloudBase's storage rule resolves resource.openid from the `users/{openid}/...` path.
  const cloudPath = `users/${identity.openid}/houseflower/private/${purpose}/${assetId}.${extension === 'jpeg' ? 'jpg' : extension}`
  await db.collection('assets').doc(assetId).set({ data: {
    assetId, ownerId: identity.userId, ownerOpenId: identity.openid, purpose, cloudPath, status: 'pending',
    extension: extension === 'jpeg' ? 'jpg' : extension, createdAt: new Date(), updatedAt: new Date(),
  } })
  return ok({ assetId, cloudPath }, id)
}

async function completeUpload(event, identity, id) {
  requireIdentity(identity, id)
  const assetId = ensureString(event.assetId, '素材 ID', 100)
  const fileId = ensureString(event.fileID, '文件 ID', 500)
  const record = await db.collection('assets').doc(assetId).get().catch(() => null)
  if (!record || !record.data || record.data.ownerId !== identity.userId) throw new BackendError('FORBIDDEN', '无权确认此文件。')
  const marker = fileId.indexOf('/', 'cloud://'.length)
  const uploadedPath = marker >= 0 ? fileId.slice(marker + 1).replace(/^\/+/, '') : ''
  if (!fileId.startsWith('cloud://') || uploadedPath !== record.data.cloudPath) {
    throw new BackendError('INVALID_INPUT', '上传文件与本次登记的路径不匹配。')
  }
  if (record.data.status === 'ready') {
    if (record.data.fileID === fileId) return ok({ assetId, status: 'ready' }, id)
    throw new BackendError('UPLOAD_ALREADY_COMPLETED', '这张图片已完成上传登记。')
  }
  if (record.data.status !== 'pending') throw new BackendError('INVALID_INPUT', '这张图片当前不能完成上传。')
  let fileContent
  try {
    const downloaded = await cloud.downloadFile({ fileID: fileId })
    fileContent = downloaded && downloaded.fileContent
  } catch {
    throw new BackendError('UPLOAD_VERIFY_FAILED', '图片上传校验失败，请重试。', true, id)
  }
  if (!Buffer.isBuffer(fileContent) || !fileContent.length) {
    throw new BackendError('UPLOAD_VERIFY_FAILED', '无法读取上传图片，请重新选择后重试。', true, id)
  }
  if (fileContent.length > MAX_UPLOAD_BYTES) {
    await cloud.deleteFile({ fileList: [fileId] }).catch(() => {})
    throw new BackendError('INVALID_INPUT', '原图超过 10 MB，请选择一张更小的原图；系统不会压缩或拉伸原图。')
  }
  await db.collection('assets').doc(assetId).update({ data: { fileID: fileId, status: 'ready', updatedAt: new Date() } })
  return ok({ assetId, status: 'ready' }, id)
}

async function getAssetUrls(event, identity, id) {
  requireIdentity(identity, id)
  const records = await ownedAssets(event.assetIds, identity)
  if (!records.length) return ok({ urls: {} }, id)
  const result = await cloud.getTempFileURL({ fileList: records.map((asset) => ({ fileID: asset.fileID, maxAge: 3600 })) })
  const urls = {}
  const fileIDs = {}
  ;(result.fileList || []).forEach((item, index) => {
    if (item && item.tempFileURL && records[index]) {
      urls[records[index].assetId] = item.tempFileURL
      fileIDs[records[index].assetId] = records[index].fileID
    }
  })
  return ok({ urls, fileIDs }, id)
}

async function getEditorialAssetUrls(event, identity, id) {
  requireIdentity(identity, id)
  const requested = Array.isArray(event.assetKeys) ? [...new Set(event.assetKeys.map((value) => String(value || '').trim()).filter(Boolean))] : []
  if (!requested.length || requested.length > 500 || requested.some((key) => !/^[a-zA-Z0-9_-]{1,100}$/.test(key))) {
    throw new BackendError('INVALID_INPUT', '案例图片列表格式不正确。')
  }
  const records = requested.map((assetKey) => ({ assetKey, fileID: EDITORIAL_ASSET_FILE_IDS[assetKey] })).filter((item) => typeof item.fileID === 'string' && item.fileID.startsWith('cloud://'))
  if (records.length !== requested.length) throw new BackendError('EDITORIAL_ASSET_NOT_FOUND', '部分案例图片暂未发布，请稍后重试。', true, id)

  const urls = {}
  for (let index = 0; index < records.length; index += 50) {
    const batch = records.slice(index, index + 50)
    const result = await cloud.getTempFileURL({ fileList: batch.map((asset) => ({ fileID: asset.fileID, maxAge: 3600 })) })
    ;(result.fileList || []).forEach((item, offset) => {
      if (item && item.tempFileURL && batch[offset]) urls[batch[offset].assetKey] = item.tempFileURL
    })
  }
  if (Object.keys(urls).length !== records.length) throw new BackendError('EDITORIAL_ASSET_URL_FAILED', '案例高清图片暂时无法读取，请重试。', true, id)
  return ok({ urls }, id)
}

async function createTask(event, identity, id) {
  requireIdentity(identity, id)
  const type = ensureString(event.type, 'AI 类型', 30)
  if (!AI_TYPES.has(type)) throw new BackendError('INVALID_INPUT', '不支持的 AI 类型。')
  if (process.env.AI_RESOURCES_ENABLED !== 'true') throw new BackendError('AI_DISABLED', 'AI 生成服务尚未开启。', true, id)
  if (type === 'recognition' && process.env.AI_VISION_ENABLED !== 'true') throw new BackendError('AI_VISION_DISABLED', '识花视觉模型尚未开启。', true, id)
  const key = ensureIdempotencyKey(event.idempotencyKey)
  const inputAssetIds = Array.isArray(event.inputAssetIds) ? [...new Set(event.inputAssetIds.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 3) : []
  if (inputAssetIds.length !== 1) throw new BackendError('INVALID_INPUT', '每个 AI 任务必须提供一张已合成的参考图。')
  const assetQuery = await db.collection('assets').where({ ownerId: identity.userId, assetId: _.in(inputAssetIds), status: 'ready' }).limit(inputAssetIds.length).get()
  if (!assetQuery.data || assetQuery.data.length !== inputAssetIds.length) throw new BackendError('INVALID_INPUT', '输入素材不存在或尚未准备好。')
  const referenceAsset = assetQuery.data[0]
  const rawOptions = event.options && typeof event.options === 'object' && !Array.isArray(event.options) ? event.options : {}
  const options = {}
  if (type !== 'recognition' && rawOptions.prompt !== undefined) {
    if (typeof rawOptions.prompt !== 'string' || rawOptions.prompt.length > 400) throw new BackendError('INVALID_INPUT', '创作补充描述不能超过 400 个字符。')
    const prompt = rawOptions.prompt.trim()
    if (prompt) options.prompt = prompt
  }
  if (type === 'scene') {
    options.sceneSourceAssetId = ensureString(rawOptions.sceneSourceAssetId, '场景图片', 100)
    options.sceneBouquetAssetId = ensureString(rawOptions.sceneBouquetAssetId, '花束图片', 100)
    if (options.sceneSourceAssetId === options.sceneBouquetAssetId || inputAssetIds[0] === options.sceneSourceAssetId || inputAssetIds[0] === options.sceneBouquetAssetId) {
      throw new BackendError('INVALID_INPUT', '场景图、花束图和合成参考图必须是不同素材。')
    }
    const sourceAssetIds = Array.isArray(referenceAsset.sourceAssetIds) ? referenceAsset.sourceAssetIds : []
    if (referenceAsset.purpose !== 'scene' || referenceAsset.compositionVersion !== 1
      || !sourceAssetIds.includes(options.sceneSourceAssetId) || !sourceAssetIds.includes(options.sceneBouquetAssetId)) {
      throw new BackendError('INVALID_INPUT', '场景任务必须使用对应的云端合成参考图。')
    }
    await ownedAssets([options.sceneSourceAssetId, options.sceneBouquetAssetId], identity)
  }
  const taskAssetIds = [...new Set([
    ...inputAssetIds, options.sceneSourceAssetId, options.sceneBouquetAssetId,
  ].filter(Boolean))]
  const requestFingerprint = crypto.createHash('sha256').update(JSON.stringify({ type, inputAssetIds, options })).digest('hex')
  const idempotencyHash = crypto.createHash('sha256').update(`${identity.userId}:${key}`).digest('hex').slice(0, 40)
  const taskId = `task_${idempotencyHash}`
  const reservation = `quota_${idempotencyHash}`
  const existing = await readDocument('ai_tasks', taskId)
  if (existing) {
    if (existing.ownerId !== identity.userId || existing.requestFingerprint !== requestFingerprint) {
      throw new BackendError('IDEMPOTENCY_CONFLICT', '这个请求编号已用于不同内容，请重新提交。')
    }
    return ok({ taskId: existing.taskId, reservationId: existing.reservationId, status: existing.status, quota: await getQuota(identity.userId) }, id)
  }
  const now = new Date()
  const quota = await ensureQuota(identity.userId, now)
  if (typeof db.runTransaction !== 'function') throw new BackendError('BACKEND_NOT_READY', '额度事务能力尚未配置，请稍后重试。', true)
  let alreadyCreated = null
  await db.runTransaction(async (transaction) => {
    alreadyCreated = null
    const prior = await readDocument('ai_tasks', taskId, transaction)
    if (prior) {
      if (prior.ownerId !== identity.userId || prior.requestFingerprint !== requestFingerprint) {
        throw new BackendError('IDEMPOTENCY_CONFLICT', '这个请求编号已用于不同内容，请重新提交。')
      }
      alreadyCreated = prior
      return
    }
    const userRef = transaction.collection('users').doc(identity.userId)
    const userResult = await userRef.get()
    const user = userResult && userResult.data
    if (!user || user.status !== 'active') throw new BackendError('ACCOUNT_UNAVAILABLE', '账号当前不可使用，请稍后重试。')
    if (user.activeTaskId) {
      const activeTask = await readDocument('ai_tasks', user.activeTaskId, transaction)
      if (activeTask && ['reserved', 'queued', 'running', 'saving', 'checking', 'reconciling'].includes(activeTask.status)) {
        throw new BackendError('TASK_IN_PROGRESS', '已有 AI 任务正在处理，请先查看该任务。', true)
      }
      await userRef.update({ data: { activeTaskId: '' } })
    }
    const current = await readDocument('daily_quotas', quota.id, transaction)
    if (!current) throw new BackendError('QUOTA_STATE_INVALID', '次数状态正在核对，请稍后刷新。', true)
    const value = current
    const source = quotaSource(value, user)
    if (!source) throw new BackendError('QUOTA_EXCEEDED', '今日 AI 次数已用完，明天 00:00 后恢复。')
    const taskAssetsResult = await transaction.collection('assets').where({ assetId: _.in(taskAssetIds), status: 'ready' }).limit(taskAssetIds.length).get()
    const taskAssets = (taskAssetsResult.data || []).filter((asset) => asset.ownerId === identity.userId || asset.ownerOpenId === identity.openid)
    if (taskAssets.length !== taskAssetIds.length) throw new BackendError('INVALID_INPUT', '任务图片已失效，请重新选择后再试。')
    if (source === 'daily') {
      await transaction.collection('daily_quotas').doc(quota.id).update({ data: { reserved: _.inc(1), updatedAt: now } })
    } else {
      await userRef.update({ data: { bonusQuotaReserved: (Number(user.bonusQuotaReserved) || 0) + 1, updatedAt: now } })
    }
    await transaction.collection('ai_tasks').doc(taskId).set({ data: {
      taskId, reservationId: reservation, ownerOpenId: identity.openid, ownerId: identity.userId, type,
      inputAssetIds, options, requestFingerprint,
      idempotencyKey: key, mode: 'queue', status: 'queued', stage: 'queued', quotaDateKey: dayKey(now), quotaSource: source,
      attempt: 0, nextRunAt: now, createdAt: now, updatedAt: now,
    } })
    for (const asset of taskAssets) {
      await transaction.collection('assets').doc(asset._id).update({ data: { lastReferencedAt: now } })
      const refId = `task_${taskId}_${asset.assetId}`
      await transaction.collection('asset_refs').doc(refId).set({ data: {
        assetId: asset.assetId, resourceType: 'task', resourceId: taskId,
        ownerId: identity.userId, createdAt: now,
      } })
    }
    await userRef.update({ data: { activeTaskId: taskId, updatedAt: now } })
    await transaction.collection('quota_ledger').doc(reservation).set({ data: {
      reservationId: reservation, taskId, ownerId: identity.userId,
      dateKey: dayKey(now), entryType: 'reserve', quotaSource: source, amount: 1, createdAt: now,
    } })
  })
  if (alreadyCreated) return ok({ taskId, reservationId: alreadyCreated.reservationId, status: alreadyCreated.status, quota: await getQuota(identity.userId) }, id)
  await recordEvent(identity, 'ai_task_created', { type, taskId }).catch(() => {})
  return ok({ taskId, reservationId: reservation, status: 'queued', quota: await getQuota(identity.userId) }, id)
}

async function cancelTask(event, identity, id) {
  requireIdentity(identity, id)
  const taskId = ensureString(event.taskId, '任务 ID', 120)
  const query = await db.collection('ai_tasks').where({ taskId, ownerId: identity.userId }).limit(1).get()
  if (!query.data || !query.data.length) throw new BackendError('NOT_FOUND', '任务不存在。')
  const task = query.data[0]
  const quotaDoc = await ensureQuota(identity.userId, new Date(task.createdAt || Date.now()))
  const now = new Date()
  let cancelled = false
  let alreadyCancelled = false
  await db.runTransaction(async (transaction) => {
    cancelled = false
    alreadyCancelled = false
    const currentResult = await transaction.collection('ai_tasks').doc(task._id).get()
    const current = currentResult && currentResult.data
    if (!current) throw new BackendError('NOT_FOUND', '任务不存在。')
    if (current.status === 'cancelled') {
      const userResult = await transaction.collection('users').doc(identity.userId).get()
      if (userResult.data && userResult.data.activeTaskId === taskId) await transaction.collection('users').doc(identity.userId).update({ data: { activeTaskId: '' } })
      alreadyCancelled = true
      return
    }
    if (current.status !== 'queued' && current.status !== 'reserved') throw new BackendError('STATE_CONFLICT', '任务已开始处理，当前不能取消。')
    const source = current.quotaSource === 'bonus' ? 'bonus' : 'daily'
    let currentQuota
    let currentUser
    if (source === 'bonus') {
      const currentUserResult = await transaction.collection('users').doc(identity.userId).get()
      currentUser = currentUserResult && currentUserResult.data
      if (!currentUser) throw new BackendError('QUOTA_STATE_INVALID', '赠送次数状态正在核对，请稍后刷新。', true)
    } else {
      const currentQuotaResult = await transaction.collection('daily_quotas').doc(quotaDoc.id).get()
      currentQuota = currentQuotaResult && currentQuotaResult.data
      if (!currentQuota) throw new BackendError('QUOTA_STATE_INVALID', '次数状态正在核对，请稍后刷新。', true)
    }
    const releaseId = `${current.reservationId}_cancel`
    const previousRelease = await readDocument('quota_ledger', releaseId, transaction)
    if (previousRelease) {
      await transaction.collection('ai_tasks').doc(task._id).update({ data: { status: 'cancelled', stage: 'cancelled', completedAt: now, updatedAt: now } })
      const userResult = await transaction.collection('users').doc(identity.userId).get()
      if (userResult.data && userResult.data.activeTaskId === taskId) await transaction.collection('users').doc(identity.userId).update({ data: { activeTaskId: '' } })
      alreadyCancelled = true
      return
    }
    if (source === 'bonus' && Number(currentUser.bonusQuotaReserved || 0) < 1) throw new BackendError('QUOTA_STATE_INVALID', '赠送次数状态正在核对，请稍后刷新。', true)
    if (source === 'daily' && Number(currentQuota.reserved || 0) < 1) throw new BackendError('QUOTA_STATE_INVALID', '次数状态正在核对，请稍后刷新。', true)
    if (source === 'bonus') {
      await transaction.collection('users').doc(identity.userId).update({ data: {
        bonusQuotaReserved: Math.max(0, Number(currentUser.bonusQuotaReserved) - 1),
        ...(currentUser.activeTaskId === taskId ? { activeTaskId: '' } : {}),
        updatedAt: now,
      } })
    } else {
      await transaction.collection('daily_quotas').doc(quotaDoc.id).update({ data: { reserved: _.inc(-1), updatedAt: now } })
    }
    await transaction.collection('ai_tasks').doc(task._id).update({ data: { status: 'cancelled', stage: 'cancelled', completedAt: now, updatedAt: now } })
    await transaction.collection('quota_ledger').doc(releaseId).set({ data: { reservationId: current.reservationId, taskId, ownerId: identity.userId, dateKey: current.quotaDateKey, entryType: 'release', quotaSource: source, amount: -1, createdAt: now } })
    if (source !== 'bonus') {
      const userResult = await transaction.collection('users').doc(identity.userId).get()
      if (userResult.data && userResult.data.activeTaskId === taskId) await transaction.collection('users').doc(identity.userId).update({ data: { activeTaskId: '' } })
    }
    cancelled = true
  })
  return ok({ taskId, status: 'cancelled', alreadyCancelled, quota: await getQuota(identity.userId) }, id)
}

async function getTask(event, identity, id) {
  requireIdentity(identity, id)
  const taskId = ensureString(event.taskId, '任务 ID', 120)
  const query = await db.collection('ai_tasks').where({ taskId, ownerId: identity.userId }).limit(1).get()
  if (!query.data || !query.data.length) throw new BackendError('NOT_FOUND', '任务不存在。')
  const task = query.data[0]
  if (task.status === 'expired' || task.retentionExpiredAt) {
    return ok({ task: { taskId: task.taskId, type: task.type, status: 'expired', stage: 'expired', createdAt: task.createdAt, updatedAt: task.updatedAt } }, id)
  }
  return ok({ task: {
    taskId: task.taskId, type: task.type, status: task.status, stage: task.stage,
    inputAssetIds: task.inputAssetIds || [],
    sceneSourceAssetId: task.options && task.options.sceneSourceAssetId || '',
    sceneBouquetAssetId: task.options && task.options.sceneBouquetAssetId || '',
    resultAssetIds: task.resultAssetIds || [], result: task.result || null,
    error: task.error || null, createdAt: task.createdAt, updatedAt: task.updatedAt,
  } }, id)
}

async function listTasks(event, identity, id) {
  requireIdentity(identity, id)
  const limit = Math.max(1, Math.min(20, Number(event.limit) || 10))
  const query = await db.collection('ai_tasks').where({ ownerId: identity.userId }).orderBy('createdAt', 'desc').limit(limit).get()
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled', 'blocked'])
  const tasks = (query.data || []).filter((task) => {
    if (task.status === 'expired' || task.retentionExpiredAt) return false
    const referenceTime = terminalStatuses.has(task.status)
      ? task.completedAt || task.updatedAt || task.createdAt
      : task.createdAt
    const timestamp = referenceTime instanceof Date ? referenceTime.getTime() : new Date(referenceTime).getTime()
    return !Number.isFinite(timestamp) || timestamp >= cutoff
  }).map((task) => ({
    taskId: task.taskId, type: task.type, status: task.status, stage: task.stage,
    inputAssetIds: task.inputAssetIds || [],
    sceneSourceAssetId: task.options && task.options.sceneSourceAssetId || '',
    sceneBouquetAssetId: task.options && task.options.sceneBouquetAssetId || '',
    resultAssetIds: task.resultAssetIds || [], result: task.result || null,
    error: task.error || null, createdAt: task.createdAt, updatedAt: task.updatedAt,
  }))
  return ok({ tasks }, id)
}

async function listWorks(event, identity, id) {
  requireIdentity(identity, id)
  const limit = Math.max(1, Math.min(30, Number(event.limit) || 20))
  const offset = Math.max(0, Math.min(10000, Number(event.offset) || 0))
  const query = await db.collection('works').where({ ownerId: identity.userId }).orderBy('updatedAt', 'desc').skip(offset).limit(limit).get()
  const works = query.data || []
  return ok({ works, nextOffset: works.length === limit ? offset + works.length : null, hasMore: works.length === limit }, id)
}

async function ownedAssets(assetIds, identity) {
  const ids = Array.isArray(assetIds) ? [...new Set(assetIds.map((value) => String(value || '').trim()).filter(Boolean))] : []
  if (ids.length > 100) throw new BackendError('INVALID_INPUT', '一次最多读取 100 张图片。')
  if (!ids.length) return []
  const query = await db.collection('assets').where({ assetId: _.in(ids), status: 'ready' }).limit(ids.length).get()
  const records = (query.data || []).filter((asset) => asset.ownerId === identity.userId || asset.ownerOpenId === identity.openid)
  if (records.length !== ids.length) throw new BackendError('FORBIDDEN', '作品引用了无权访问的图片。')
  return records
}

function orientedDimensions(metadata) {
  const width = Number(metadata && metadata.width || 0)
  const height = Number(metadata && metadata.height || 0)
  const orientation = Number(metadata && metadata.orientation || 0)
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height }
}

async function downloadSceneInput(asset) {
  const downloaded = await cloud.downloadFile({ fileID: asset.fileID })
  const buffer = downloaded && downloaded.fileContent
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    throw new BackendError('INVALID_INPUT', '场景图片或花束图片无效，或超过 10 MB。')
  }
  const metadata = await sharp(buffer, { limitInputPixels: MAX_SCENE_PIXELS }).metadata()
  const dimensions = orientedDimensions(metadata)
  if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > MAX_SCENE_PIXELS) {
    throw new BackendError('INVALID_INPUT', '图片尺寸过大，请选择分辨率较低的图片。')
  }
  return { buffer, ...dimensions }
}

async function renderSceneComposite(scene, bouquet, placement, aspectRatio) {
  const ratio = Math.max(0.5, Math.min(2, Number(aspectRatio) || 1))
  const maxSide = 1600
  const width = ratio >= 1 ? maxSide : Math.round(maxSide * ratio)
  const height = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide
  const cream = { r: 239, g: 232, b: 223, alpha: 1 }
  const background = await sharp(scene.buffer, { limitInputPixels: MAX_SCENE_PIXELS })
    .rotate()
    .resize(width, height, { fit: 'contain', background: cream })
    .flatten({ background: cream })
    .png()
    .toBuffer()

  const boxWidth = Math.max(1, Math.round(width * 0.48 * placement.scale / 80))
  const boxHeight = Math.max(1, Math.round(height * 0.62 * placement.scale / 80))
  const overlay = await sharp(bouquet.buffer, { limitInputPixels: MAX_SCENE_PIXELS })
    .rotate()
    .resize(boxWidth, boxHeight, { fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true })
  const drawWidth = overlay.info.width
  const drawHeight = overlay.info.height
  const rawLeft = Math.round(width * placement.x / 100 - drawWidth / 2)
  const rawTop = Math.round(height * placement.y / 100 - drawHeight / 2)
  const cropLeft = Math.max(0, -rawLeft)
  const cropTop = Math.max(0, -rawTop)
  const left = Math.max(0, rawLeft)
  const top = Math.max(0, rawTop)
  const visibleWidth = Math.min(drawWidth - cropLeft, width - left)
  const visibleHeight = Math.min(drawHeight - cropTop, height - top)
  if (visibleWidth < 1 || visibleHeight < 1) throw new BackendError('INVALID_INPUT', '花束位置超出场景范围，请重新调整。')
  const clippedOverlay = cropLeft || cropTop || visibleWidth !== drawWidth || visibleHeight !== drawHeight
    ? await sharp(overlay.data).extract({ left: cropLeft, top: cropTop, width: visibleWidth, height: visibleHeight }).png().toBuffer()
    : overlay.data
  const output = await sharp({ create: { width, height, channels: 3, background: cream } })
    .composite([{ input: background, left: 0, top: 0 }, { input: clippedOverlay, left, top }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
  if (!output.length || output.length > MAX_UPLOAD_BYTES) throw new BackendError('IMAGE_TOO_LARGE', '场景合成结果过大，请缩小原图后重试。')
  return { buffer: output, width, height }
}

async function composeSceneReference(event, identity, id) {
  requireIdentity(identity, id)
  const sceneAssetId = ensureString(event.sceneAssetId, '场景图片', 100)
  const bouquetAssetId = ensureString(event.bouquetAssetId, '花束图片', 100)
  if (sceneAssetId === bouquetAssetId) throw new BackendError('INVALID_INPUT', '请分别选择场景图和花束图。')
  const assets = await ownedAssets([sceneAssetId, bouquetAssetId], identity)
  const byId = new Map(assets.map((asset) => [asset.assetId, asset]))
  const sceneAsset = byId.get(sceneAssetId)
  const bouquetAsset = byId.get(bouquetAssetId)
  if (!sceneAsset || !bouquetAsset || !sceneAsset.fileID || !bouquetAsset.fileID) {
    throw new BackendError('INVALID_INPUT', '场景图片或花束图片尚未准备好。')
  }

  const boundedNumber = (value, minimum, maximum) => {
    const number = Number(value)
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : undefined
  }
  const placement = {
    x: boundedNumber(event.x, 8, 92),
    y: boundedNumber(event.y, 8, 92),
    scale: boundedNumber(event.scale, 32, 145),
  }
  if (Object.values(placement).some((value) => value === undefined)) throw new BackendError('INVALID_INPUT', '花束位置参数不正确。')
  const aspectRatio = Number(event.aspectRatio)
  if (!Number.isFinite(aspectRatio) || aspectRatio < 0.5 || aspectRatio > 2) throw new BackendError('INVALID_INPUT', '场景画布比例不正确。')
  const quota = await getQuota(identity.userId)
  if (quota.remaining <= 0) throw new BackendError('QUOTA_EXCEEDED', '今日 AI 次数已用完，明天 00:00 后恢复。')

  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    version: 1, ownerId: identity.userId, sceneAssetId, bouquetAssetId, placement, aspectRatio,
  })).digest('hex')
  const assetId = `asset_scene_${fingerprint.slice(0, 36)}`
  const existing = await readDocument('assets', assetId)
  if (existing && existing.status === 'ready' && existing.fileID) return ok({ assetId, fileID: existing.fileID }, id)

  const [scene, bouquet] = await Promise.all([downloadSceneInput(sceneAsset), downloadSceneInput(bouquetAsset)])
  const composite = await renderSceneComposite(scene, bouquet, placement, aspectRatio)
  const cloudPath = `users/${identity.openid}/houseflower/private/scene-composites/${assetId}.jpg`
  const uploaded = await cloud.uploadFile({ cloudPath, fileContent: composite.buffer })
  if (!uploaded || !uploaded.fileID) throw new BackendError('SCENE_COMPOSITE_FAILED', '场景图片合成后保存失败，请重试。', true)
  const now = new Date()
  await db.collection('assets').doc(assetId).set({ data: {
    assetId, ownerId: identity.userId, ownerOpenId: identity.openid, purpose: 'scene',
    fileID: uploaded.fileID, cloudPath, status: 'ready', extension: 'jpg', bytes: composite.buffer.length,
    width: composite.width, height: composite.height, sourceAssetIds: [sceneAssetId, bouquetAssetId],
    compositionVersion: 1, createdAt: existing && existing.createdAt || now, updatedAt: now,
  } })
  return ok({ assetId, fileID: uploaded.fileID }, id)
}

function normalizeWorkMetadata(value, previous = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key)
  const staticAssetPath = (path) => {
    const text = String(path || '')
    return /^\/assets\/(?:editorial|materials|materials-ui)\/[a-zA-Z0-9_-]+\.jpg$/.test(text) ? text : ''
  }
  const numberInRange = (candidate, minimum, maximum) => {
    const number = Number(candidate)
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : undefined
  }
  const normalized = { ...(previous && typeof previous === 'object' ? previous : {}) }
  if (has('createdAt')) normalized.createdAt = Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : undefined
  if (has('previewPath')) normalized.previewPath = staticAssetPath(input.previewPath)
  if (has('sourcePath')) normalized.sourcePath = staticAssetPath(input.sourcePath)
  if (has('sceneId')) normalized.sceneId = ['living', 'dining', 'bedroom', 'entryway', 'custom'].includes(String(input.sceneId || '')) ? String(input.sceneId) : ''
  if (has('sceneBouquetX')) normalized.sceneBouquetX = numberInRange(input.sceneBouquetX, 0, 100)
  if (has('sceneBouquetY')) normalized.sceneBouquetY = numberInRange(input.sceneBouquetY, 0, 100)
  if (has('sceneBouquetScale')) normalized.sceneBouquetScale = numberInRange(input.sceneBouquetScale, 32, 145)
  if (has('sceneBouquetAssetId')) normalized.sceneBouquetAssetId = String(input.sceneBouquetAssetId || '').trim().slice(0, 120)
  if (has('sceneCompositeAssetId')) normalized.sceneCompositeAssetId = String(input.sceneCompositeAssetId || '').trim().slice(0, 120)
  if (has('status')) normalized.status = ['draft', 'confirmed'].includes(String(input.status || '')) ? String(input.status) : ''
  if (has('note')) normalized.note = String(input.note || '').trim().slice(0, 100)
  if (has('notes')) normalized.notes = Array.isArray(input.notes) ? input.notes.slice(0, 20).map((note) => String(note || '').slice(0, 160)) : []
  return Object.fromEntries(Object.entries(normalized).filter(([, item]) => item !== undefined))
}

async function saveWorkRecord(event, identity, id) {
  requireIdentity(identity, id)
  const input = event.work && typeof event.work === 'object' ? event.work : event
  const kind = ensureString(input.kind, '作品类型', 30)
  if (!['bouquet', 'scene', 'materials'].includes(kind)) throw new BackendError('INVALID_INPUT', '不支持的作品类型。')
  const title = String(input.title || '一束花').trim().slice(0, 80) || '一束花'
  const sourceKey = String(input.sourceKey || '').trim().slice(0, 240)
  const has = (field) => Object.prototype.hasOwnProperty.call(input, field)
  const requestedAssetIds = [input.previewAssetId, input.sourceAssetId, ...(Array.isArray(input.assetIds) ? input.assetIds : [])]
    .map((value) => String(value || '').trim()).filter(Boolean)
  await ownedAssets([...new Set(requestedAssetIds)], identity)

  const normalizedRows = has('rows') ? normalizeMaterialRows(input.rows) : null
  if (normalizedRows && normalizedRows.error) throw new BackendError('INVALID_INPUT', normalizedRows.error)

  let current = null
  if (sourceKey) {
    const match = await db.collection('works').where({ ownerId: identity.userId, sourceKey, deletedAt: _.exists(false) }).limit(1).get()
    current = match.data && match.data[0]
  }
  const requestedId = input.id ? ensureDocumentId(input.id, '作品 ID') : ''
  if (!current && requestedId) {
    const match = await db.collection('works').doc(requestedId).get().catch(() => null)
    if (match && match.data) current = match.data
  }
  const workId = current ? current.workId : requestedId || (sourceKey
    ? 'work_' + crypto.createHash('sha256').update(`${identity.userId}:${sourceKey}`).digest('hex').slice(0, 40)
    : `work_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`)

  let savedWork
  await db.runTransaction(async (transaction) => {
    const previous = await readDocument('works', workId, transaction)
    if (previous && previous.ownerId !== identity.userId) throw new BackendError('FORBIDDEN', '无权修改这件作品。')
    if (previous && previous.deletedAt) throw new BackendError('STATE_CONFLICT', '这件作品已删除，请刷新作品列表。')
    const expectedRevision = input.expectedRevision === undefined ? undefined : Number(input.expectedRevision)
    if (expectedRevision !== undefined && Number(previous && previous.revision || 0) !== expectedRevision) {
      throw new BackendError('VERSION_CONFLICT', '作品已在另一台设备更新，请刷新后再保存。')
    }

    const previewAssetId = has('previewAssetId') ? String(input.previewAssetId || '') : String(previous && previous.previewAssetId || '')
    const sourceAssetId = has('sourceAssetId') ? String(input.sourceAssetId || '') : String(previous && previous.sourceAssetId || '')
    const assetIds = has('assetIds') && Array.isArray(input.assetIds)
      ? [...new Set(input.assetIds.map((value) => String(value || '').trim()).filter(Boolean))]
      : (previous && Array.isArray(previous.assetIds) ? previous.assetIds : [])
    const attachedAssetIds = [...new Set([previewAssetId, sourceAssetId, ...assetIds].filter(Boolean))]
    const metadata = normalizeWorkMetadata(input.metadata, previous && previous.metadata)
    let ownedRecords = []
    if (attachedAssetIds.length) {
      const owned = await transaction.collection('assets').where({ assetId: _.in(attachedAssetIds), status: 'ready' }).limit(attachedAssetIds.length).get()
      ownedRecords = (owned.data || []).filter((asset) => asset.ownerId === identity.userId || asset.ownerOpenId === identity.openid)
      if (ownedRecords.length !== attachedAssetIds.length) throw new BackendError('FORBIDDEN', '作品引用了无权访问或已失效的图片。')
    }
    for (const metadataAssetId of [metadata.sceneBouquetAssetId, metadata.sceneCompositeAssetId].filter(Boolean)) {
      if (!attachedAssetIds.includes(metadataAssetId)) throw new BackendError('INVALID_INPUT', '场景作品缺少关联素材引用。')
    }

    const rows = normalizedRows ? normalizedRows.rows : (previous && previous.rows || [])
    if (kind === 'materials' && !rows.length) throw new BackendError('INVALID_INPUT', '花材清单不能为空。')
    const requestedCreatedAt = Number(metadata.createdAt)
    const existingCreatedAt = previous ? new Date(previous.createdAt).getTime() : NaN
    const createdAt = new Date(Number.isFinite(existingCreatedAt) && existingCreatedAt > 0
      ? existingCreatedAt
      : Number.isFinite(requestedCreatedAt) && requestedCreatedAt > 0 ? requestedCreatedAt : Date.now())
    metadata.createdAt = createdAt.getTime()
    const work = {
      workId, ownerId: identity.userId, ownerOpenId: identity.openid,
      kind: has('kind') ? kind : previous.kind,
      title: has('title') ? title : previous.title,
      previewAssetId, sourceAssetId, assetIds,
      sourceKey: has('sourceKey') ? sourceKey : String(previous && previous.sourceKey || ''),
      rows, metadata,
      revision: Number(previous && previous.revision || 0) + 1,
      createdAt, updatedAt: new Date(),
    }

    const previousAssetIds = previous
      ? [...new Set([previous.previewAssetId, previous.sourceAssetId, ...(previous.assetIds || [])].filter(Boolean))]
      : []
    for (const oldAssetId of previousAssetIds) {
      if (attachedAssetIds.includes(oldAssetId)) continue
      const refId = `work_${workId}_${oldAssetId}`
      const oldRef = await readDocument('asset_refs', refId, transaction)
      if (oldRef) await transaction.collection('asset_refs').doc(refId).remove()
    }
    for (const assetId of attachedAssetIds) {
      const asset = ownedRecords.find((item) => item.assetId === assetId)
      if (asset) await transaction.collection('assets').doc(asset._id).update({ data: { lastReferencedAt: new Date() } })
      const refId = `work_${workId}_${assetId}`
      await transaction.collection('asset_refs').doc(refId).set({ data: { assetId, resourceType: 'work', resourceId: workId, ownerId: identity.userId, createdAt: new Date() } })
    }
    await transaction.collection('works').doc(workId).set({ data: work })
    savedWork = work
  })

  await recordEvent(identity, 'work_saved', { kind, workId }).catch(() => {})
  return ok({ work: savedWork }, id)
}

async function deleteWork(event, identity, id) {
  requireIdentity(identity, id)
  let workId = event.workId ? ensureDocumentId(event.workId, '作品 ID') : ''
  let record = workId ? await db.collection('works').doc(workId).get().catch(() => null) : null
  if (!record && event.sourceKey) {
    const sourceKey = ensureString(event.sourceKey, '作品来源', 240)
    const match = await db.collection('works').where({ ownerId: identity.userId, sourceKey, deletedAt: _.exists(false) }).limit(1).get()
    record = match.data && match.data[0] ? { data: match.data[0] } : null
    workId = record && record.data ? record.data.workId : ''
  }
  if (!record || !record.data) return ok({ workId, deleted: true, alreadyMissing: true }, id)
  if (!record || !record.data || record.data.ownerId !== identity.userId) throw new BackendError('FORBIDDEN', '无权删除此作品。')
  await db.collection('works').doc(workId).update({ data: { deletedAt: new Date(), updatedAt: new Date() } })
  await db.collection('asset_refs').where({ resourceType: 'work', resourceId: workId }).remove()
  return ok({ workId, deleted: true }, id)
}

async function listDates(identity, id) {
  requireIdentity(identity, id)
  const query = await db.collection('important_dates').where({ ownerId: identity.userId }).orderBy('date', 'asc').limit(200).get()
  return ok({ dates: query.data || [] }, id)
}

async function saveDate(event, identity, id) {
  requireIdentity(identity, id)
  const input = event.date && typeof event.date === 'object' ? event.date : event
  const title = ensureString(input.title, '日期标题', 80)
  const date = ensureString(input.date, '日期', 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BackendError('INVALID_INPUT', '日期格式必须为 YYYY-MM-DD。')
  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new BackendError('INVALID_INPUT', '日期不是有效的日历日期。')
  const workId = String(input.workId || '')
  if (workId) {
    const work = await db.collection('works').doc(workId).get().catch(() => null)
    if (!work || !work.data || work.data.ownerId !== identity.userId || work.data.deletedAt) throw new BackendError('FORBIDDEN', '关联作品不存在或无权访问。')
  }
  const dateId = input.id ? ensureDocumentId(input.id, '日期 ID') : `date_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`
  const current = await db.collection('important_dates').doc(dateId).get().catch(() => null)
  if (current && current.data && current.data.ownerId !== identity.userId) throw new BackendError('FORBIDDEN', '无权修改此日期。')
  const record = { id: dateId, ownerId: identity.userId, title, date, note: String(input.note || '').slice(0, 240), repeatYearly: Boolean(input.repeatYearly), workId, updatedAt: new Date(), createdAt: current && current.data && current.data.createdAt || new Date() }
  await db.collection('important_dates').doc(dateId).set({ data: record })
  await createDateNotification(identity, record)
  await recordEvent(identity, 'important_date_saved', { repeatYearly: record.repeatYearly }).catch(() => {})
  return ok({ date: record }, id)
}

async function deleteDate(event, identity, id) {
  requireIdentity(identity, id)
  const dateId = ensureDocumentId(event.id, '日期 ID')
  const current = await db.collection('important_dates').doc(dateId).get().catch(() => null)
  if (!current || !current.data) return ok({ id: dateId, deleted: true, alreadyMissing: true }, id)
  if (current.data.ownerId !== identity.userId) throw new BackendError('FORBIDDEN', '无权删除此日期。')
  await db.collection('important_dates').doc(dateId).update({ data: { deletedAt: new Date(), updatedAt: new Date() } })
  return ok({ id: dateId, deleted: true }, id)
}

async function updateProfile(event, identity, id) {
  requireIdentity(identity, id)
  const nickname = String(event.nickname || '').trim().slice(0, 40)
  if (!nickname) throw new BackendError('INVALID_INPUT', '昵称不能为空。')
  const avatarAssetId = String(event.avatarAssetId || '').trim()
  if (avatarAssetId) await ownedAssets([avatarAssetId], identity)
  await db.collection('users').doc(identity.userId).update({ data: { nickname, avatarAssetId, lastSeenAt: new Date() } })
  return ok({ nickname, avatarAssetId }, id)
}

async function requestAccountDeletion(identity, id) {
  requireIdentity(identity, id)
  await db.collection('users').doc(identity.userId).update({ data: { status: 'deletion_requested', deletionRequestedAt: new Date(), updatedAt: new Date() } })
  return ok({ status: 'deletion_requested' }, id)
}

// ---- 店铺品牌（B 端白标） ----
function defaultShopDoc(shopId) {
  const now = new Date()
  return {
    shopId,
    shopName: '花店名称',
    logoAssetId: '',
    intro: '用心挑选每一束花，把美好送到你手上',
    contactWechat: '',
    contactPhone: '',
    slogan: '把生活的点滴，一路生花',
    createdAt: now,
    updatedAt: now,
  }
}

async function getShop(event, identity, id) {
  requireIdentity(identity, id)
  const shopId = String(event.shopId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default'
  let doc = await db.collection('shops').doc(shopId).get().catch(() => null)
  if (!doc || !doc.data) {
    const seeded = defaultShopDoc(shopId)
    try { await db.collection('shops').doc(shopId).set({ data: seeded }) } catch (error) { /* concurrent seed is fine */ }
    doc = await db.collection('shops').doc(shopId).get().catch(() => null)
    if (!doc || !doc.data) return ok({ brand: seeded }, id)
  }
  const data = doc.data
  return ok({
    brand: {
      shopId: data.shopId || shopId,
      shopName: String(data.shopName || ''),
      logoAssetId: String(data.logoAssetId || ''),
      intro: String(data.intro || ''),
      contactWechat: String(data.contactWechat || ''),
      contactPhone: String(data.contactPhone || ''),
      slogan: String(data.slogan || ''),
    },
  }, id)
}

async function saveShop(event, identity, id) {
  requireIdentity(identity, id)
  if (!isAdmin(identity)) throw new BackendError('FORBIDDEN', '只有店铺管理员可以修改品牌信息。', false, id)
  const shopId = String(event.shopId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default'
  const input = event.brand || {}
  const patch = {
    shopName: String(input.shopName || '').trim().slice(0, 40),
    logoAssetId: String(input.logoAssetId || '').trim().slice(0, 64),
    intro: String(input.intro || '').trim().slice(0, 200),
    contactWechat: String(input.contactWechat || '').trim().slice(0, 60),
    contactPhone: String(input.contactPhone || '').trim().slice(0, 30),
    slogan: String(input.slogan || '').trim().slice(0, 60),
    updatedAt: new Date(),
  }
  if (!patch.shopName) throw new BackendError('INVALID_INPUT', '店铺名称不能为空。', false, id)
  if (patch.logoAssetId) await ownedAssets([patch.logoAssetId], identity).catch(() => {})
  const existing = await db.collection('shops').doc(shopId).get().catch(() => null)
  if (existing && existing.data) {
    await db.collection('shops').doc(shopId).update({ data: patch })
  } else {
    await db.collection('shops').doc(shopId).set({ data: { ...defaultShopDoc(shopId), ...patch } })
  }
  return ok({ brand: { shopId, ...patch } }, id)
}

async function requireActiveAccount(identity) {
  requireIdentity(identity)
  const result = await db.collection('users').doc(identity.userId).get()
  if (!result || !result.data || result.data.status !== 'active') throw new BackendError('ACCOUNT_UNAVAILABLE', '账号删除流程已开始，当前不可继续操作。')
}

exports.main = async (event, context) => {
  const id = requestId()
  const identity = getContext(context)
  try {
    const action = String(event && event.action || '')
    if (action === 'bootstrap') return await bootstrap(identity, id)
    if (action !== 'request-account-deletion') await requireActiveAccount(identity)
    if (action === 'get-quota') { requireIdentity(identity, id); return ok({ quota: await getQuota(identity.userId) }, id) }
    if (action === 'prepare-upload') return await prepareUpload(event, identity, id)
    if (action === 'complete-upload') return await completeUpload(event, identity, id)
    if (action === 'get-asset-urls') return await getAssetUrls(event, identity, id)
    if (action === 'get-editorial-asset-urls') return await getEditorialAssetUrls(event, identity, id)
    if (action === 'compose-scene-reference') return await composeSceneReference(event, identity, id)
    if (action === 'create-task') return await createTask(event, identity, id)
    if (action === 'get-task') return await getTask(event, identity, id)
    if (action === 'list-tasks') return await listTasks(event, identity, id)
    if (action === 'cancel-task') return await cancelTask(event, identity, id)
    if (action === 'update-profile') return await updateProfile(event, identity, id)
    if (action === 'request-account-deletion') return await requestAccountDeletion(identity, id)
    if (action === 'save-subscription') return await saveSubscription(event, identity, id)
    if (action === 'track-event') return await trackEvent(event, identity, id)
    if (action === 'grant-bonus-quota') return await grantBonusQuota(event, identity, id)
    if (action === 'admin-summary') return await adminSummary(event, identity, id)
    if (action === 'list-works') return await listWorks(event, identity, id)
    if (action === 'save-work') return await saveWorkRecord(event, identity, id)
    if (action === 'delete-work') return await deleteWork(event, identity, id)
    if (action === 'list-dates') return await listDates(identity, id)
    if (action === 'save-date') return await saveDate(event, identity, id)
    if (action === 'delete-date') return await deleteDate(event, identity, id)
    if (action === 'get-shop') return await getShop(event, identity, id)
    if (action === 'save-shop') return await saveShop(event, identity, id)
    return fail('INVALID_ACTION', '不支持的后端操作。', false, id)
  } catch (error) {
    if (error instanceof BackendError) return fail(error.code, error.message, error.retryable, id)
    console.error('houseflower backend failed', { requestId: id, errorName: error && error.name, errorCode: error && (error.code || error.Code) })
    return fail('INTERNAL_ERROR', '服务暂时不可用，请稍后重试。', true, id)
  }
}
