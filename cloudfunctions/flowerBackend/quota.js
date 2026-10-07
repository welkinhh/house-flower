const crypto = require('node:crypto')

// Free AI generations are granted once per account and never reset daily.
// The daily pool therefore stays empty and every consumption flows through the
// permanent `users.bonusQuotaBalance` bucket, which the task worker already
// reserves, commits and releases transactionally.
const DAILY_QUOTA_LIMIT = 0
const WELCOME_QUOTA_PERSONAL = 5
const WELCOME_QUOTA_SHOP = 30
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'

function welcomeQuotaFor(isShop) {
  return isShop ? WELCOME_QUOTA_SHOP : WELCOME_QUOTA_PERSONAL
}

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

// The daily document is kept only because the task worker reserves, commits and
// releases against it. Its limit is always 0 so records written before the
// switch stop granting daily allowances the moment this deploy lands.
function docLimit() {
  return DAILY_QUOTA_LIMIT
}

function quotaAvailability(doc, user = {}) {
  const used = Math.max(0, Number(doc && doc.used) || 0)
  const reserved = Math.max(0, Number(doc && doc.reserved) || 0)
  const bonusBalance = Math.max(0, Number(user && user.bonusQuotaBalance) || 0)
  const bonusReserved = Math.max(0, Number(user && user.bonusQuotaReserved) || 0)
  return {
    dailyRemaining: Math.max(0, docLimit() - used - reserved),
    bonusRemaining: Math.max(0, bonusBalance - bonusReserved),
  }
}

function quotaSource(doc, user = {}) {
  const available = quotaAvailability(doc, user)
  if (available.dailyRemaining > 0) return 'daily'
  if (available.bonusRemaining > 0) return 'bonus'
  return ''
}

function normalizeQuota(doc, date = new Date(), user = {}) {
  const used = Math.max(0, Number(doc && doc.used) || 0)
  const reserved = Math.max(0, Number(doc && doc.reserved) || 0)
  const available = quotaAvailability(doc, user)
  return {
    dateKey: dayKey(date),
    limit: docLimit(),
    used,
    reserved,
    dailyRemaining: available.dailyRemaining,
    bonusRemaining: available.bonusRemaining,
    remaining: available.dailyRemaining + available.bonusRemaining,
    resetsAt: nextResetAt(date),
  }
}

module.exports = {
  DAILY_QUOTA_LIMIT,
  WELCOME_QUOTA_PERSONAL,
  WELCOME_QUOTA_SHOP,
  welcomeQuotaFor,
  dayKey,
  nextResetAt,
  userIdFor,
  quotaId,
  quotaAvailability,
  quotaSource,
  reservationId,
  normalizeQuota,
}
