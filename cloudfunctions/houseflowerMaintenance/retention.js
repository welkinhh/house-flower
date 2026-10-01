const DAY_MS = 24 * 60 * 60 * 1000
const TERMINAL_TASK_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'blocked'])

function terminalAt(task) {
  const value = task && (task.completedAt || task.updatedAt || task.createdAt)
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0
}

function isExpiredTerminalTask(task, now = Date.now()) {
  if (!task || !TERMINAL_TASK_STATUSES.has(String(task.status || ''))) return false
  const timestamp = terminalAt(task)
  return Boolean(timestamp && now - timestamp >= DAY_MS)
}

function taskAssetIds(task) {
  const options = task && task.options || {}
  return [...new Set([
    ...(Array.isArray(task && task.inputAssetIds) ? task.inputAssetIds : []),
    ...(Array.isArray(task && task.resultAssetIds) ? task.resultAssetIds : []),
    options.sceneSourceAssetId,
    options.sceneBouquetAssetId,
    task && task.sceneSourceAssetId,
    task && task.sceneBouquetAssetId,
  ].map((value) => String(value || '').trim()).filter(Boolean))]
}

module.exports = { DAY_MS, TERMINAL_TASK_STATUSES, isExpiredTerminalTask, taskAssetIds }
