const cloud = require('wx-server-sdk')
const { DAY_MS, TERMINAL_TASK_STATUSES, isExpiredTerminalTask, taskAssetIds } = require('./retention')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 15000 })
const db = cloud.database()
const _ = db.command

const COLLECTIONS_BY_OWNER = ['works', 'recognitions', 'important_dates', 'ai_tasks', 'quota_ledger', 'daily_quotas', 'asset_refs', 'analytics_events', 'subscription_records', 'notification_jobs']
const COLLECTIONS_BY_ASSET = ['assets']
const PENDING_ASSET_AGE = DAY_MS
const ORPHAN_ASSET_AGE = 7 * 24 * 60 * 60 * 1000
const TASK_SCAN_LIMIT = 50

async function removeInChunks(collection, ids) {
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100)
    if (chunk.length) await db.collection(collection).where({ _id: _.in(chunk) }).remove()
  }
}

async function deleteFiles(fileIDs) {
  const deleted = []
  const failed = []
  for (let index = 0; index < fileIDs.length; index += 50) {
    const chunk = fileIDs.slice(index, index + 50)
    if (!chunk.length) continue
    const result = await cloud.deleteFile({ fileList: chunk })
    if (result && result.code && result.code !== 'SUCCESS') throw new Error(`云文件删除请求失败：${result.code}`)
    const results = result && Array.isArray(result.fileList) ? result.fileList : []
    const byFileId = new Map(results.map((item) => [item.fileID, item]))
    for (const fileID of chunk) {
      const item = byFileId.get(fileID)
      if (item && (!item.code || item.code === 'SUCCESS')) deleted.push(fileID)
      else failed.push(fileID)
    }
  }
  return { deleted, failed }
}

async function queryUserAssets(user) {
  async function queryAll(makeQuery) {
    const rows = []
    let offset = 0
    while (true) {
      const result = await makeQuery().skip(offset).limit(500).get()
      const page = result.data || []
      rows.push(...page)
      if (page.length < 500) return rows
      offset += page.length
    }
  }
  const map = new Map()
  const byOwner = await queryAll(() => db.collection('assets').where({ ownerId: user.userId }).orderBy('createdAt', 'asc'))
  byOwner.forEach((asset) => map.set(asset._id, asset))
  if (user.openId) {
    const byOpenId = await queryAll(() => db.collection('assets').where({ ownerOpenId: user.openId }).orderBy('createdAt', 'asc'))
    byOpenId.forEach((asset) => map.set(asset._id, asset))
  }
  return [...map.values()]
}

async function queryAllByIds(collectionName, field, ids) {
  const rows = []
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100)
    let offset = 0
    while (true) {
      const result = await db.collection(collectionName).where({ [field]: _.in(batch) }).orderBy('_id', 'asc').skip(offset).limit(500).get()
      const page = result.data || []
      rows.push(...page)
      if (page.length < 500) break
      offset += page.length
    }
  }
  return rows
}

async function purgeDeletedUser(user) {
  const identity = await db.collection('identities').doc(user.userId).get()
  user.openId = identity && identity.data && identity.data.openId || ''
  const assets = await queryUserAssets(user)
  const completedDeletes = await deleteFiles(assets.filter((asset) => asset.fileID && asset.cleanupStatus !== 'file_deleted').map((asset) => asset.fileID))
  for (const fileID of completedDeletes.deleted) {
    const asset = assets.find((item) => item.fileID === fileID)
    if (asset) await db.collection('assets').doc(asset._id).update({ data: { cleanupStatus: 'file_deleted', updatedAt: new Date() } })
  }
  if (completedDeletes.failed.length || assets.some((asset) => !asset.fileID && asset.cleanupStatus !== 'file_deleted')) {
    throw new Error('账号图片尚未全部删除，保留账号记录并等待重试。')
  }
  await removeInChunks('assets', assets.map((asset) => asset._id))
  for (const collection of COLLECTIONS_BY_OWNER) {
    await db.collection(collection).where({ ownerId: user.userId }).remove()
  }
  if (identity && identity.data) await db.collection('identities').doc(user.userId).remove()
  await db.collection('users').doc(user.userId).remove()
  return { userId: user.userId, assets: assets.length }
}

async function purgePendingAssets() {
  const cutoff = new Date(Date.now() - PENDING_ASSET_AGE)
  const query = await db.collection('assets').where({ status: 'pending', createdAt: _.lt(cutoff) }).limit(500).get()
  const assets = query.data || []
  if (!assets.length) return 0
  const pendingDeletion = assets.filter((asset) => asset.fileID && asset.cleanupStatus !== 'file_deleted')
  const deleted = await deleteFiles(pendingDeletion.map((asset) => asset.fileID))
  for (const fileID of deleted.deleted) {
    const asset = pendingDeletion.find((item) => item.fileID === fileID)
    if (asset) await db.collection('assets').doc(asset._id).update({ data: { cleanupStatus: 'file_deleted', updatedAt: new Date() } })
  }
  if (deleted.failed.length) throw new Error('部分未完成上传的文件删除失败，保留登记记录等待重试。')
  await removeInChunks('assets', pendingDeletion.map((asset) => asset._id))
  return pendingDeletion.length
}

async function purgeOrphanAssets() {
  const cutoff = new Date(Date.now() - ORPHAN_ASSET_AGE)
  const query = await db.collection('assets').where({ status: 'ready', createdAt: _.lt(cutoff) }).limit(500).get()
  const assets = query.data || []
  if (!assets.length) return 0
  const ids = assets.map((asset) => asset.assetId)
  const refs = await queryAllByIds('asset_refs', 'assetId', ids)
  const referenced = new Set(refs.map((ref) => ref.assetId))
  const users = await queryAllByIds('users', 'avatarAssetId', ids)
  users.forEach((user) => referenced.add(user.avatarAssetId))
  const removable = assets.filter((asset) => !referenced.has(asset.assetId))
  const deleted = await deleteFiles(removable.filter((asset) => asset.fileID && asset.cleanupStatus !== 'file_deleted').map((asset) => asset.fileID))
  for (const fileID of deleted.deleted) {
    const asset = removable.find((item) => item.fileID === fileID)
    if (asset) await db.collection('assets').doc(asset._id).update({ data: { cleanupStatus: 'file_deleted', updatedAt: new Date() } })
  }
  if (deleted.failed.length) throw new Error('孤儿文件删除失败，保留登记记录等待重试。')
  for (const asset of removable.filter((item) => !item.fileID && item.cleanupStatus !== 'file_deleted')) {
    await db.collection('assets').doc(asset._id).update({ data: { cleanupStatus: 'missing_file_id', updatedAt: new Date() } })
  }
  const safeToRemove = removable.filter((asset) => asset.cleanupStatus === 'file_deleted' || Boolean(asset.fileID && deleted.deleted.includes(asset.fileID)))
  await removeInChunks('assets', safeToRemove.map((asset) => asset._id))
  return safeToRemove.length
}

async function queryExpiredTasks(now) {
  const createdCutoff = new Date(now.getTime() - DAY_MS)
  const tasks = []
  for (const status of TERMINAL_TASK_STATUSES) {
    const result = await db.collection('ai_tasks')
      .where({ status, createdAt: _.lt(createdCutoff) })
      .orderBy('createdAt', 'asc').limit(TASK_SCAN_LIMIT).get()
    tasks.push(...(result.data || []).filter((task) => isExpiredTerminalTask(task, now.getTime())))
  }
  return tasks
}

async function stageExpiredTaskAsset(task, assetId, now) {
  return db.runTransaction(async (transaction) => {
    const taskResult = await transaction.collection('ai_tasks').doc(task._id).get()
    const currentTask = taskResult && taskResult.data
    if (!currentTask || !isExpiredTerminalTask(currentTask, now.getTime())) return { staged: false }

    const assetResult = await transaction.collection('assets')
      .where({ assetId, ownerId: currentTask.ownerId }).limit(1).get()
    const asset = assetResult.data && assetResult.data[0]
    const refsResult = await transaction.collection('asset_refs').where({ assetId }).get()
    const refs = refsResult.data || []
    const taskRefs = refs.filter((ref) => ref.resourceType === 'task' && ref.resourceId === currentTask.taskId)
    const userResult = await transaction.collection('users').doc(currentTask.ownerId).get()
    const user = userResult && userResult.data
    const activeTaskId = user && user.activeTaskId
    let activeTaskUsesAsset = false
    if (activeTaskId && activeTaskId !== currentTask.taskId) {
      const activeResult = await transaction.collection('ai_tasks').doc(activeTaskId).get()
      const activeTask = activeResult && activeResult.data
      activeTaskUsesAsset = taskAssetIds(activeTask).includes(assetId)
    }

    const currentTaskRefIds = new Set(taskRefs.map((ref) => ref._id))
    const sharedRefs = refs.some((ref) => !currentTaskRefIds.has(ref._id))
    const isAvatar = Boolean(user && user.avatarAssetId === assetId)
    for (const ref of taskRefs) await transaction.collection('asset_refs').doc(ref._id).remove()
    if (!asset) return { staged: false, missing: true }
    if (sharedRefs || isAvatar || activeTaskUsesAsset) return { staged: false, preserved: true }
    if (asset.status !== 'ready' && asset.status !== 'expiring') return { staged: false, preserved: true }

    await transaction.collection('assets').doc(asset._id).update({ data: {
      status: 'expiring', cleanupStatus: 'retention_pending', retentionExpiredAt: now, updatedAt: now,
    } })
    return { staged: true }
  })
}

async function purgeExpiringAssets() {
  const query = await db.collection('assets').where({ status: 'expiring' }).limit(500).get()
  const assets = query.data || []
  if (!assets.length) return 0
  const missingFileIds = assets.filter((asset) => !asset.fileID && asset.cleanupStatus !== 'file_deleted')
  for (const asset of missingFileIds) {
    await db.collection('assets').doc(asset._id).update({ data: { cleanupStatus: 'missing_file_id', updatedAt: new Date() } })
  }
  if (missingFileIds.length) throw new Error('过期素材缺少云文件 ID，保留登记记录等待人工核对。')
  const pending = assets.filter((asset) => asset.fileID && asset.cleanupStatus !== 'file_deleted')
  const deleted = await deleteFiles(pending.map((asset) => asset.fileID))
  for (const fileID of deleted.deleted) {
    const asset = pending.find((item) => item.fileID === fileID)
    if (asset) await db.collection('assets').doc(asset._id).update({ data: { cleanupStatus: 'file_deleted', updatedAt: new Date() } })
  }
  if (deleted.failed.length) throw new Error('过期素材删除失败，保留登记记录等待重试。')
  const removable = assets.filter((asset) => asset.cleanupStatus === 'file_deleted' || deleted.deleted.includes(asset.fileID))
  await removeInChunks('assets', removable.map((asset) => asset._id))
  return removable.length
}

async function purgeExpiredTasks(now = new Date()) {
  const tasks = await queryExpiredTasks(now)
  for (const task of tasks) {
    const refResult = await db.collection('asset_refs').where({ resourceType: 'task', resourceId: task.taskId }).get()
    const assetIds = [...new Set([
      ...taskAssetIds(task),
      ...((refResult.data || []).map((ref) => String(ref.assetId || '').trim()).filter(Boolean)),
    ])]
    for (const assetId of assetIds) await stageExpiredTaskAsset(task, assetId, now)
  }

  const deletedAssets = await purgeExpiringAssets()
  for (const task of tasks) {
    await db.collection('ai_tasks').doc(task._id).update({ data: {
      status: 'expired', stage: 'expired', retentionExpiredAt: now,
      inputAssetIds: [], resultAssetIds: [], options: {}, result: null, error: null,
      claimToken: '', leaseUntil: null,
    } })
  }
  return { tasks: tasks.length, assets: deletedAssets }
}

exports.main = async () => {
  const deleted = await db.collection('users').where({ status: 'deletion_requested' }).limit(10).get()
  const users = []
  for (const user of deleted.data || []) users.push(await purgeDeletedUser(user))
  const pendingAssets = await purgePendingAssets()
  const orphanAssets = await purgeOrphanAssets()
  const expiredTasks = await purgeExpiredTasks()
  return { ok: true, deletedUsers: users.length, users, pendingAssets, orphanAssets, expiredTasks }
}
