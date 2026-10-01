function safeField(value: unknown): string {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/cloud:\/\/\S+/gi, '[file]')
    .replace(/wxfile:\/\/\S+/gi, '[local-file]')
    .slice(0, 240)
}

/** Log enough detail to diagnose preview failures without logging images or file paths. */
export function logAiFailure(flow: string, error: any, stage = ''): void {
  console.error('[HouseFlower AI] request failed', {
    flow: safeField(flow),
    stage: safeField(stage),
    name: safeField(error && error.name),
    code: safeField(error && (error.code || error.errCode)),
    message: safeField(error && (error.errMsg || error.message)),
    requestId: safeField(error && error.requestId),
  })
}

export function aiFailureMessage(error: any, fallback: string): string {
  const code = safeField(error && (error.code || error.errCode))
  const message = safeField(error && (error.errMsg || error.message) || error)
  const diagnostic = `${code} ${message}`
  if (/-503002|STORAGE_EXCEED_AUTHORITY|storage permission denied|no access right to the storage/i.test(diagnostic)) {
    return '图片上传权限校验失败，请稍后重试。'
  }
  if (/图生图目前只支持|不能超过 10 MB|参考图片不能超过/i.test(message)) return message
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|network/i.test(diagnostic)) {
    return '网络或服务响应超时，请稍后重试。'
  }
  return message || fallback
}
