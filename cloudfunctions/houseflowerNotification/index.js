const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 15000 })
const db = cloud.database()
const _ = db.command

function parseFieldMap() {
  try { return JSON.parse(process.env.SUBSCRIBE_FIELD_MAP_JSON || '{}') } catch { return {} }
}

function buildData(job) {
  const map = parseFieldMap()[job.type] || { thing1: 'title', time2: 'date', phrase3: 'note' }
  const payload = job.payload || {}
  const data = {}
  Object.entries(map).forEach(([templateField, payloadField]) => {
    const value = String(payload[payloadField] || '').slice(0, 80)
    if (value) data[templateField] = { value }
  })
  return data
}

async function claimJob() {
  const now = new Date()
  const query = await db.collection('notification_jobs').where({ status: _.in(['queued', 'waiting_subscription']), dueAt: _.lte(now) }).orderBy('dueAt', 'asc').limit(1).get().catch(() => ({ data: [] }))
  if (!query.data || !query.data.length) return null
  const job = query.data[0]
  let claimed = false
  await db.runTransaction(async (transaction) => {
    const current = await transaction.collection('notification_jobs').doc(job._id).get()
    if (!current.data || !['queued', 'waiting_subscription'].includes(current.data.status)) return
    await transaction.collection('notification_jobs').doc(job._id).update({ data: { status: 'sending', attempts: _.inc(1), updatedAt: now } })
    claimed = true
  }).catch(() => {})
  if (!claimed) return null
  const current = await db.collection('notification_jobs').doc(job._id).get()
  return current.data
}

async function sendJob(job) {
  const subscription = await db.collection('subscription_records').where({ ownerId: job.ownerId, templateId: job.templateId, status: 'accept' }).limit(1).get().catch(() => ({ data: [] }))
  if (!subscription.data || !subscription.data.length) {
    const attempts = Number(job.attempts || 0)
    const expiresAt = new Date(new Date(job.createdAt || Date.now()).getTime() + 48 * 60 * 60 * 1000)
    if (Date.now() > expiresAt.getTime() || attempts >= 12) {
      await db.collection('notification_jobs').doc(job._id).update({ data: { status: 'blocked', error: 'USER_NOT_SUBSCRIBED', updatedAt: new Date() } })
    } else {
      await db.collection('notification_jobs').doc(job._id).update({ data: { status: 'waiting_subscription', dueAt: new Date(Date.now() + 60 * 60 * 1000), updatedAt: new Date() } })
    }
    return
  }
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: job.openId,
      templateId: job.templateId,
      page: 'pages/flower/index',
      data: buildData(job),
      miniprogramState: process.env.NODE_ENV === 'production' ? 'formal' : 'trial',
    })
    await db.collection('notification_jobs').doc(job._id).update({ data: { status: 'sent', sentAt: new Date(), updatedAt: new Date() } })
    await db.collection('subscription_records').doc(`subscription_${job.ownerId}_${job.templateId}`).update({ data: { status: 'consumed', consumedAt: new Date(), updatedAt: new Date() } }).catch(() => {})
  } catch (error) {
    const attempts = Number(job.attempts || 0)
    const terminal = attempts >= 3
    await db.collection('notification_jobs').doc(job._id).update({ data: { status: terminal ? 'failed' : 'queued', dueAt: new Date(Date.now() + 15 * 60 * 1000), error: String(error && (error.errMsg || error.message) || 'SEND_FAILED').slice(0, 200), updatedAt: new Date() } })
  }
}

exports.main = async () => {
  if (!process.env.SUBSCRIBE_TEMPLATE_DATE && !process.env.SUBSCRIBE_TEMPLATE_TASK) return { ok: true, processed: 0, disabled: true }
  let processed = 0
  while (processed < 10) {
    const job = await claimJob()
    if (!job) break
    await sendJob(job)
    processed += 1
  }
  return { ok: true, processed }
}
