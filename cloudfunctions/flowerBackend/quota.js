const crypto = require('node:crypto')

const DAILY_QUOTA_LIMIT = 10
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'

function shanghaiParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return parts
}

function dayKey(date = new Date()) {
  const parts = shanghaiParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function nextResetAt(date = new Date()) {
  const parts = shanghaiParts(date)
  const nextDay = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1, 0, 0, 0))
  return new Date(nextDay.getTime() - (8 * 60 * 60 * 1000)).toISOString()
}

function userIdFor(openid, appid = '') {
  return crypto.createHash('sha256').update(`${appid}:${openid}`).digest('hex').slice(0, 32)
}

function quotaId(userId, date = new Date()) {
  return `${userId}_${dayKey(date)}`
}

function reservationId() {
  return `quota_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`
}

function normalizeQuota(doc, date = new Date()) {
  const used = Math.max(0, Number(doc && doc.used) || 0)
  const reserved = Math.max(0, Number(doc && doc.reserved) || 0)
  const limit = DAILY_QUOTA_LIMIT
  return {
    dateKey: dayKey(date),
    limit,
    used,
    reserved,
    remaining: Math.max(0, limit - used - reserved),
    resetsAt: nextResetAt(date),
  }
}

module.exports = {
  DAILY_QUOTA_LIMIT,
  dayKey,
  nextResetAt,
  userIdFor,
  quotaId,
  reservationId,
  normalizeQuota,
}
