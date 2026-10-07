import { BACKEND_FUNCTION_NAME, CLOUDBASE_ENV_ID, DAILY_AI_QUOTA_LIMIT } from './cloud-env'
import { DEFAULT_SHOP_ID, normalizeBrand, type ShopBrand } from './brand'

export type AiTaskType = 'bouquet' | 'recognition' | 'scene'

export type DailyQuota = {
  dateKey: string
  limit: number
  used: number
  reserved: number
  dailyRemaining: number
  bonusRemaining: number
  remaining: number
  resetsAt: string
}

export type BackendUser = {
  userId: string
  nickname: string
  avatarAssetId: string
  status: string
}

type BackendSuccess<T> = { ok: true; data: T; requestId: string }
type BackendFailure = { ok: false; error?: { code?: string; message?: string; retryable?: boolean }; requestId?: string }
type BackendResponse<T> = BackendSuccess<T> | BackendFailure

export class BackendRequestError extends Error {
  code: string
  retryable: boolean
  requestId: string

  constructor(code: string, message: string, retryable: boolean, requestId = '') {
    super(message)
    this.name = 'BackendRequestError'
    this.code = code
    this.retryable = retryable
    this.requestId = requestId
  }
}

export type BackendSession = { user: BackendUser; quota: DailyQuota; isAdmin: boolean; subscriptionTemplates: { date: string; task: string } }
export type CloudWork = { id?: string; workId?: string; kind: 'bouquet' | 'scene' | 'materials'; title: string; previewAssetId?: string; sourceAssetId?: string; assetIds?: string[]; sourceKey?: string; rows?: any[]; metadata?: Record<string, unknown>; expectedRevision?: number }

let initialized = false

function ensureCloudBase(): void {
  if (!wx.cloud) throw new Error('当前微信基础库不支持云开发，请升级后重试。')
  if (!CLOUDBASE_ENV_ID) throw new Error('尚未配置 CloudBase 环境。')
  if (initialized) return
  wx.cloud.init({ env: CLOUDBASE_ENV_ID })
  initialized = true
}

function randomKey(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`
}

async function callBackend<T>(data: Record<string, unknown>): Promise<T> {
  ensureCloudBase()
  let response: ICloud.CallFunctionResult
  try {
    response = await wx.cloud.callFunction({ name: BACKEND_FUNCTION_NAME, data })
  } catch (error: any) {
    const detail = String(error && (error.errMsg || error.message) || '')
    throw new BackendRequestError('NETWORK_ERROR', detail || '网络暂时不可用，请检查连接后重试。', true)
  }
  const result = response.result as BackendResponse<T>
  if (!result || !result.ok) {
    const error = result && 'error' in result ? result.error : undefined
    throw new BackendRequestError(error?.code || 'BACKEND_ERROR', error?.message || '后端服务暂时不可用，请稍后重试。', error?.retryable !== false, result && result.requestId || '')
  }
  return result.data
}

export function defaultQuota(): DailyQuota {
  return { dateKey: '', limit: DAILY_AI_QUOTA_LIMIT, used: 0, reserved: 0, dailyRemaining: DAILY_AI_QUOTA_LIMIT, bonusRemaining: 0, remaining: DAILY_AI_QUOTA_LIMIT, resetsAt: '' }
}

export async function bootstrapBackend(): Promise<BackendSession> {
  return callBackend<BackendSession>({ action: 'bootstrap' })
}

export async function getDailyQuota(): Promise<DailyQuota> {
  const data = await callBackend<{ quota: DailyQuota }>({ action: 'get-quota' })
  return data.quota
}

export async function getBackendTask(taskId: string): Promise<any> {
  const data = await callBackend<{ task: any }>({ action: 'get-task', taskId })
  return data.task
}

export async function listBackendTasks(limit = 10): Promise<any[]> {
  const data = await callBackend<{ tasks: any[] }>({ action: 'list-tasks', limit })
  return Array.isArray(data.tasks) ? data.tasks : []
}

function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)) }

export async function waitForBackendTask(taskId: string, onStage?: (stage: string) => void, timeoutMs = 12 * 60 * 1000): Promise<any> {
  const started = Date.now()
  let delay = 2500
  while (Date.now() - started < timeoutMs) {
    let task: any
    try {
      task = await getBackendTask(taskId)
    } catch (error: any) {
      if (error && error.retryable === false) throw error
      onStage?.('reconnecting')
      await wait(Math.min(delay, Math.max(250, timeoutMs - (Date.now() - started))))
      delay = Math.min(15000, Math.round(delay * 1.5))
      continue
    }
    onStage?.(String(task.stage || task.status || 'queued'))
    if (task.status === 'succeeded') return task
    if (task.status === 'expired') {
      throw new Error('这次生成已超过 24 小时，临时图片已清理。重新生成即可继续创作。')
    }
    if (task.status === 'failed' || task.status === 'blocked' || task.status === 'cancelled') {
      throw new Error(task.error?.message || 'AI 任务未能完成。')
    }
    await wait(delay)
    delay = Math.min(10000, Math.round(delay * 1.35))
  }
  throw new Error('AI 任务等待超时，请稍后在作品中查看。')
}

export async function createBackendTask(
  type: AiTaskType,
  inputAssetIds: string[],
  options: Record<string, unknown> = {},
  idempotencyKey = randomKey(`task_${type}`),
): Promise<{ taskId: string; reservationId: string; status: string; quota: DailyQuota }> {
  return callBackend({ action: 'create-task', type, inputAssetIds, options, idempotencyKey })
}

export async function cancelBackendTask(taskId: string): Promise<DailyQuota> {
  const data = await callBackend<{ quota: DailyQuota }>({ action: 'cancel-task', taskId })
  return data.quota
}

export async function updateRemoteProfile(nickname: string, avatarAssetId = ''): Promise<{ nickname: string; avatarAssetId: string }> {
  const data = await callBackend<{ nickname: string; avatarAssetId: string }>({ action: 'update-profile', nickname, avatarAssetId })
  return data
}

export async function requestAccountDeletion(): Promise<string> {
  const data = await callBackend<{ status: string }>({ action: 'request-account-deletion' })
  return data.status
}

export async function saveCloudWork(work: CloudWork): Promise<any> {
  const data = await callBackend<{ work: any }>({ action: 'save-work', work })
  return data.work
}

export async function listCloudWorks(limit = 30, offset = 0): Promise<{ works: any[]; nextOffset: number | null; hasMore: boolean }> {
  const data = await callBackend<{ works: any[]; nextOffset: number | null; hasMore: boolean }>({ action: 'list-works', limit, offset })
  return {
    works: Array.isArray(data.works) ? data.works : [],
    nextOffset: Number.isInteger(data.nextOffset) ? data.nextOffset : null,
    hasMore: Boolean(data.hasMore),
  }
}

export async function deleteCloudWork(workId: string, sourceKey = ''): Promise<void> {
  await callBackend({ action: 'delete-work', workId, sourceKey })
}

export async function listCloudDates(): Promise<any[]> {
  const data = await callBackend<{ dates: any[] }>({ action: 'list-dates' })
  return Array.isArray(data.dates) ? data.dates : []
}

export async function saveCloudDate(date: Record<string, unknown>): Promise<any> {
  const data = await callBackend<{ date: any }>({ action: 'save-date', date })
  return data.date
}

export async function deleteCloudDate(id: string): Promise<void> {
  await callBackend({ action: 'delete-date', id })
}

export async function getCloudAssetUrls(assetIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(assetIds.map((assetId) => String(assetId || '').trim()).filter(Boolean))]
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += 8) batches.push(ids.slice(index, index + 8))
  const urls: Record<string, string> = {}
  const responses = await Promise.all(batches.map((batch) => callBackend<{ urls: Record<string, string> }>({ action: 'get-asset-urls', assetIds: batch })))
  responses.forEach((data) => Object.assign(urls, data.urls || {}))
  return urls
}

export async function prepareBackendUpload(purpose: string, extension: string): Promise<{ assetId: string; cloudPath: string }> {
  return callBackend({ action: 'prepare-upload', purpose, extension })
}

export async function completeBackendUpload(assetId: string, fileID: string): Promise<void> {
  await callBackend({ action: 'complete-upload', assetId, fileID })
}

export async function composeCloudSceneReference(input: {
  sceneAssetId: string
  bouquetAssetId: string
  x: number
  y: number
  scale: number
  aspectRatio: number
}): Promise<{ assetId: string; fileID: string }> {
  return callBackend({ action: 'compose-scene-reference', ...input })
}

export async function getCloudAssetDetails(assetIds: string[]): Promise<{ urls: Record<string, string>; fileIDs: Record<string, string> }> {
  const ids = [...new Set(assetIds.map((assetId) => String(assetId || '').trim()).filter(Boolean))]
  const urls: Record<string, string> = {}
  const fileIDs: Record<string, string> = {}
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += 8) batches.push(ids.slice(index, index + 8))
  const responses = await Promise.all(batches.map((batch) => callBackend<{ urls: Record<string, string>; fileIDs: Record<string, string> }>({ action: 'get-asset-urls', assetIds: batch })))
  responses.forEach((data) => {
    Object.assign(urls, data.urls || {})
    Object.assign(fileIDs, data.fileIDs || {})
  })
  return { urls, fileIDs }
}

export async function getEditorialAssetUrls(assetKeys: string[]): Promise<Record<string, string>> {
  const keys = [...new Set(assetKeys.map((key) => String(key || '').trim()).filter((key) => /^[a-zA-Z0-9_-]{1,100}$/.test(key)))]
  if (!keys.length || keys.length > 500) throw new Error('案例图片清单格式不正确。')
  const data = await callBackend<{ urls: Record<string, string> }>({ action: 'get-editorial-asset-urls', assetKeys: keys })
  return data.urls || {}
}

export async function saveSubscription(results: Record<string, string>): Promise<void> {
  await callBackend({ action: 'save-subscription', results })
}

export async function trackClientEvent(eventName: string, properties: Record<string, unknown> = {}): Promise<void> {
  await callBackend({ action: 'track-event', eventName, properties })
}

export async function getAdminSummary(range = 30): Promise<any> {
  const data = await callBackend<any>({ action: 'admin-summary', range })
  return data
}

export async function grantBonusQuota(userId: string, count: number, reason = '', grantId = randomKey('gift')): Promise<{ userId: string; count: number; alreadyGranted: boolean; quota: DailyQuota }> {
  return callBackend({ action: 'grant-bonus-quota', userId, count, reason, grantId })
}

export async function getShopBrand(shopId: string = DEFAULT_SHOP_ID): Promise<ShopBrand> {
  const data = await callBackend<{ brand: Partial<ShopBrand> }>({ action: 'get-shop', shopId })
  return normalizeBrand(data.brand)
}

export async function saveShopBrand(brand: Partial<ShopBrand> & { shopId?: string }): Promise<ShopBrand> {
  const data = await callBackend<{ brand: Partial<ShopBrand> }>({ action: 'save-shop', brand })
  return normalizeBrand(data.brand)
}
