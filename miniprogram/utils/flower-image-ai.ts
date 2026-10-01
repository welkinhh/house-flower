import { CLOUDBASE_ENV_ID } from './cloud-env'
import { completeBackendUpload, composeCloudSceneReference, createBackendTask, getCloudAssetDetails, prepareBackendUpload, waitForBackendTask, type AiTaskType } from './backend'

const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024

export type FlowerImageGenerationStage = 'preparing' | 'uploading' | 'generating'

export type FlowerImageProgress = {
  mode: 'determinate' | 'indeterminate'
  percent: number
  label: string
  note: string
}

export interface GenerateFlowerImageOptions {
  filePath: string
  prompt?: string
  taskType?: AiTaskType
  onStage?: (stage: FlowerImageGenerationStage) => void
  onProgress?: (progress: FlowerImageProgress) => void
  onTaskCreated?: (task: { taskId: string; referenceAssetId: string; referenceFileID: string }) => void
}

export interface GenerateFlowerSceneOptions {
  scenePath: string
  bouquetPath: string
  sceneAssetId?: string
  bouquetAssetId?: string
  x: number
  y: number
  scale: number
  aspectRatio: number
  prompt?: string
  onStage?: (stage: FlowerImageGenerationStage) => void
  onProgress?: (progress: FlowerImageProgress) => void
  onTaskCreated?: (task: { taskId: string; referenceAssetId: string; referenceFileID: string }) => void
}

export interface GeneratedFlowerImage {
  taskId: string
  referenceFileID: string
  referenceAssetId: string
  referenceTempURL: string
  fileID: string
  resultAssetId: string
  tempFileURL: string
  revisedPrompt: string
  sceneSourceAssetId?: string
  sceneSourceFileID?: string
  sceneBouquetAssetId?: string
  sceneBouquetFileID?: string
  sceneCompositeAssetId?: string
}

export interface ResumeFlowerImageTaskOptions {
  taskId: string
  referenceAssetId: string
  referenceFileID?: string
  progressStartPercent?: number
  progressTitle?: string
  onStage?: (stage: FlowerImageGenerationStage) => void
  onProgress?: (progress: FlowerImageProgress) => void
  timeoutMs?: number
}

function getImageType(filePath: string): Promise<'jpg' | 'png'> {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: filePath,
      success: (info) => {
        const type = String(info.type || '').toLowerCase()
        if (type === 'png') resolve('png')
        else if (type === 'jpg' || type === 'jpeg') resolve('jpg')
        else reject(new Error('图生图目前只支持 JPG 或 PNG 图片。'))
      },
      fail: reject,
    })
  })
}

function getFileSize(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      success: (info) => resolve(info.size),
      fail: reject,
    })
  })
}

async function downloadRemoteImage(filePath: string, label: string): Promise<{ filePath: string; cleanup?: () => Promise<void> }> {
  if (!/^https?:\/\//i.test(filePath)) return { filePath }
  const downloaded = await new Promise<any>((resolve, reject) => wx.downloadFile({
    url: filePath,
    success: (result) => result.statusCode === 200 && result.tempFilePath ? resolve(result) : reject(new Error(`${label}下载失败，请检查网络后重试。`)),
    fail: reject,
  }))
  return {
    filePath: downloaded.tempFilePath,
    cleanup: () => new Promise<void>((resolve) => wx.getFileSystemManager().unlink({ filePath: downloaded.tempFilePath, complete: () => resolve() })),
  }
}

async function prepareSceneUploadSource(
  filePath: string,
  extension: 'jpg' | 'png',
): Promise<{ filePath: string; cleanup?: () => Promise<void> }> {
  const packagePath = String(filePath || '').replace(/^\/+/, '')
  if (!packagePath.startsWith('assets/')) return { filePath }

  const fileSystem = wx.getFileSystemManager()
  // Package files are readable but cannot be uploaded as local temp files on device.
  const data = await new Promise<ArrayBuffer>((resolve, reject) => {
    fileSystem.readFile({
      filePath: packagePath,
      success: (result) => {
        if (result.data && typeof (result.data as ArrayBuffer).byteLength === 'number') resolve(result.data as ArrayBuffer)
        else reject(new Error('读取内置场景图片失败。'))
      },
      fail: reject,
    })
  })
  if (data.byteLength > MAX_REFERENCE_IMAGE_BYTES) throw new Error('内置场景图片超过 10 MB。')

  const uploadPath = `${wx.env.USER_DATA_PATH}/houseflower-scene-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}.${extension}`
  await new Promise<void>((resolve, reject) => {
    fileSystem.writeFile({ filePath: uploadPath, data, success: () => resolve(), fail: reject })
  })
  return {
    filePath: uploadPath,
    cleanup: () => new Promise<void>((resolve) => fileSystem.unlink({ filePath: uploadPath, complete: () => resolve() })),
  }
}

function sceneAssetError(error: any, label: string, stage: string): Error {
  const detail = String(error && (error.errMsg || error.message) || error || '未知错误')
  const wrapped: any = new Error(`${label}${stage}失败：${detail}`)
  wrapped.name = error && error.name || 'SceneAssetError'
  wrapped.code = error && (error.code || error.errCode) || ''
  wrapped.errCode = error && error.errCode || ''
  wrapped.requestId = error && error.requestId || ''
  wrapped.retryable = error && error.retryable
  wrapped.stage = `${label}${stage}`
  return wrapped
}

function reportTaskStage(
  stage: string,
  options: Pick<ResumeFlowerImageTaskOptions, 'onStage' | 'onProgress' | 'progressTitle'>,
  startedAt: number,
  startPercent: number,
): void {
  const elapsed = Math.max(0, Date.now() - startedAt)
  const progress = Math.min(95, Math.round(startPercent + (95 - startPercent) * (1 - Math.exp(-elapsed / 20000))))
  if (stage === 'queued' || stage === 'checking') {
    options.onStage?.('preparing')
    options.onProgress?.({ mode: 'determinate', percent: Math.max(startPercent, Math.min(progress, startPercent + 3)), label: '图片已准备，正在排队', note: '进度为预估值，AI 服务不提供实时百分比' })
  } else if (stage === 'running' || stage === 'saving') {
    options.onStage?.('generating')
    options.onProgress?.({ mode: 'determinate', percent: progress, label: options.progressTitle || 'AI 正在生成花束', note: '预计进度，实际耗时会随图片和服务负载变化' })
  } else if (stage === 'reconnecting') {
    options.onProgress?.({ mode: 'determinate', percent: progress, label: '连接暂时中断', note: '正在重试读取任务状态，不会重新提交生成' })
  }
}

/** Resumes polling for an existing task without re-uploading or consuming another generation. */
export async function resumeFlowerImageTask(options: ResumeFlowerImageTaskOptions): Promise<GeneratedFlowerImage> {
  const taskId = String(options.taskId || '').trim()
  const referenceAssetId = String(options.referenceAssetId || '').trim()
  if (!taskId || !referenceAssetId) throw new Error('生成任务缺少恢复信息。')
  const startPercent = Math.max(1, Math.min(90, Number(options.progressStartPercent) || 60))
  const startedAt = Date.now()
  let currentStage = 'checking'
  const report = (stage: string) => {
    currentStage = stage
    reportTaskStage(stage, options, startedAt, startPercent)
  }
  options.onStage?.('generating')
  options.onProgress?.({ mode: 'determinate', percent: startPercent, label: '正在恢复生成进度', note: '显示预计进度；正在连接后台任务，不会重复上传或扣次' })
  const progressTimer = setInterval(() => reportTaskStage(currentStage, options, startedAt, startPercent), 1000)
  let completed: any
  try {
    completed = await waitForBackendTask(taskId, report, options.timeoutMs)
  } finally {
    clearInterval(progressTimer)
  }
  const resultAssetId = String(completed.resultAssetIds && completed.resultAssetIds[0] || '')
  if (!resultAssetId) throw new Error('AI 任务没有返回结果图片。')
  const sceneSourceAssetId = String(completed.sceneSourceAssetId || '')
  const sceneBouquetAssetId = String(completed.sceneBouquetAssetId || '')
  const details = await getCloudAssetDetails([referenceAssetId, resultAssetId, sceneSourceAssetId, sceneBouquetAssetId].filter(Boolean))
  const resultFileID = details.fileIDs[resultAssetId]
  const resultURL = details.urls[resultAssetId]
  if (!resultFileID || !resultURL) throw new Error('生成结果读取失败，请稍后重试。')
  options.onProgress?.({ mode: 'determinate', percent: 100, label: '生成完成', note: '图片已保存到云端' })
  return {
    taskId,
    referenceFileID: details.fileIDs[referenceAssetId] || String(options.referenceFileID || ''),
    referenceAssetId,
    referenceTempURL: details.urls[referenceAssetId] || '',
    fileID: resultFileID,
    resultAssetId,
    tempFileURL: resultURL,
    revisedPrompt: '',
    sceneSourceAssetId,
    sceneSourceFileID: details.fileIDs[sceneSourceAssetId] || '',
    sceneBouquetAssetId,
    sceneBouquetFileID: details.fileIDs[sceneBouquetAssetId] || '',
    sceneCompositeAssetId: completed.type === 'scene' ? referenceAssetId : '',
  }
}

/** Uploads an original-size input image, persists the task, then waits for its result. */
export async function generateFlowerImageFromReference(
  options: GenerateFlowerImageOptions,
): Promise<GeneratedFlowerImage> {
  const sourcePath = String(options.filePath || '').trim()
  if (!sourcePath) throw new Error('请先选择一张参考图片。')
  if (!CLOUDBASE_ENV_ID) throw new Error('尚未配置 CloudBase 环境。')

  const prompt = String(options.prompt || '').trim()
    || '以原图为花艺灵感，生成一束完整手绑花束。成品是1:1正方形画布，背景必须为纯黑#000000，花束以外所有区域纯黑；完整呈现花头、包花纸、丝带和花茎，花束与原图的配色和情绪明显关联，主体清晰锐利。'
  if (prompt.length > 400) throw new Error('图片描述不能超过 400 个字符。')

  options.onStage?.('preparing')
  options.onProgress?.({ mode: 'determinate', percent: 5, label: '正在读取原图', note: '检查格式，不裁切、不拉伸图片' })
  const uploadSource = await downloadRemoteImage(sourcePath, '参考图片')
  let uploaded: any
  let prepared: { assetId: string; cloudPath: string }
  try {
    const filePath = uploadSource.filePath
    const extension = await getImageType(filePath)
    options.onProgress?.({ mode: 'determinate', percent: 14, label: '正在检查原图', note: '确认图片格式' })
    const fileSize = await getFileSize(filePath)
    if (fileSize > MAX_REFERENCE_IMAGE_BYTES) throw new Error('原图超过 10 MB，请选择一张更小的原图；图片不会被拉伸或强行压缩。')
    options.onProgress?.({ mode: 'determinate', percent: 20, label: '原图检查完成', note: '准备安全上传' })

    options.onProgress?.({ mode: 'determinate', percent: 23, label: '正在准备上传', note: '正在登记本次图片素材' })
    prepared = await prepareBackendUpload('inspiration', extension)
    options.onStage?.('uploading')
    options.onProgress?.({ mode: 'determinate', percent: 0, label: '正在上传原图', note: '上传进度' })
    const uploadTask: any = wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath })
    if (uploadTask && typeof uploadTask.onProgressUpdate === 'function') {
      uploadTask.onProgressUpdate((event: any) => {
        const percent = Math.max(0, Math.min(100, Math.round(Number(event && event.progress) || 0)))
        options.onProgress?.({ mode: 'determinate', percent: 25 + Math.round(percent * 0.3), label: '正在上传原图', note: '真实上传进度' })
      })
    } else {
      options.onProgress?.({ mode: 'indeterminate', percent: 0, label: '正在上传原图', note: '原图正在安全上传' })
    }
    uploaded = await uploadTask
    if (!uploaded.fileID) throw new Error('参考图片上传失败，请重试。')
    options.onProgress?.({ mode: 'determinate', percent: 57, label: '正在校验原图', note: '确认原图已安全上传' })
    await completeBackendUpload(prepared.assetId, uploaded.fileID)
  } finally {
    if (uploadSource.cleanup) await uploadSource.cleanup().catch(() => {})
  }
  options.onProgress?.({ mode: 'determinate', percent: 61, label: '原图准备完成', note: '正在创建 AI 任务' })

  options.onStage?.('generating')
  const task = await createBackendTask(options.taskType || 'bouquet', [prepared.assetId], { prompt })
  options.onTaskCreated?.({ taskId: task.taskId, referenceAssetId: prepared.assetId, referenceFileID: uploaded.fileID })
  return resumeFlowerImageTask({
    taskId: task.taskId,
    referenceAssetId: prepared.assetId,
    referenceFileID: uploaded.fileID,
    progressStartPercent: 65,
    onStage: options.onStage,
    onProgress: options.onProgress,
  })
}

async function uploadSceneAsset(
  filePath: string,
  label: string,
  onProgress?: (progress: FlowerImageProgress) => void,
): Promise<{ assetId: string; fileID: string }> {
  let stage = '格式检查'
  let uploadSource: { filePath: string; cleanup?: () => Promise<void> } | null = null
  let remoteSource: { filePath: string; cleanup?: () => Promise<void> } | null = null
  try {
    onProgress?.({ mode: 'determinate', percent: 0, label: `正在检查${label}`, note: '确认图片格式' })
    stage = '下载云端场景图片'
    remoteSource = await downloadRemoteImage(filePath, label)
    const extension = await getImageType(remoteSource.filePath)
    stage = '转换内置图片'
    uploadSource = await prepareSceneUploadSource(remoteSource.filePath, extension)
    stage = '大小检查'
    const fileSize = await getFileSize(uploadSource.filePath)
    if (fileSize > MAX_REFERENCE_IMAGE_BYTES) throw new Error(`${label}超过 10 MB，请选择更小的图片。`)

    stage = '云端登记'
    const prepared = await prepareBackendUpload('scene', extension)
    stage = '图片上传'
    const uploadTask: any = wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath: uploadSource.filePath })
    if (uploadTask && typeof uploadTask.onProgressUpdate === 'function') {
      uploadTask.onProgressUpdate((event: any) => {
        const percent = Math.max(0, Math.min(100, Math.round(Number(event && event.progress) || 0)))
        onProgress?.({ mode: 'determinate', percent, label: `正在上传${label}`, note: '安全上传图片' })
      })
    } else onProgress?.({ mode: 'indeterminate', percent: 0, label: `正在上传${label}`, note: '安全上传图片' })
    const uploaded = await uploadTask
    if (!uploaded || !uploaded.fileID) throw new Error(`${label}上传未返回文件凭证，请重试。`)

    stage = '云端校验'
    onProgress?.({ mode: 'indeterminate', percent: 0, label: `正在校验${label}`, note: '确认云端图片可读取' })
    await completeBackendUpload(prepared.assetId, uploaded.fileID)
    return { assetId: prepared.assetId, fileID: uploaded.fileID }
  } catch (error: any) {
    throw sceneAssetError(error, label, stage)
  } finally {
    if (uploadSource && uploadSource.cleanup) await uploadSource.cleanup().catch(() => {})
    if (remoteSource && remoteSource.cleanup) await remoteSource.cleanup().catch(() => {})
  }
}

/** Uploads the two source assets and asks CloudBase to compose the single AI reference image. */
export async function generateFlowerImageFromScene(options: GenerateFlowerSceneOptions): Promise<GeneratedFlowerImage> {
  if (!CLOUDBASE_ENV_ID) throw new Error('尚未配置 CloudBase 环境。')
  if (!options.sceneAssetId && !String(options.scenePath || '').trim()) throw new Error('请先选择场景图片。')
  if (!options.bouquetAssetId && !String(options.bouquetPath || '').trim()) throw new Error('请先选择花束图片。')
  const prompt = String(options.prompt || '把花束自然融入空间，保留原有室内布局和光线。').trim()
  if (prompt.length > 400) throw new Error('图片描述不能超过 400 个字符。')

  options.onStage?.('preparing')
  options.onProgress?.({ mode: 'determinate', percent: 4, label: '正在准备场景素材', note: '分别检查场景图与花束图' })
  if (!options.sceneAssetId) options.onStage?.('uploading')
  const scene = options.sceneAssetId
    ? { assetId: options.sceneAssetId, fileID: '' }
    : await uploadSceneAsset(String(options.scenePath), '场景图', (progress) => options.onProgress?.({ ...progress, percent: 10 + Math.round(progress.percent * 0.16), note: '场景图 · ' + progress.note }))
  if (!options.bouquetAssetId) options.onStage?.('uploading')
  const bouquet = options.bouquetAssetId
    ? { assetId: options.bouquetAssetId, fileID: '' }
    : await uploadSceneAsset(String(options.bouquetPath), '花束图', (progress) => options.onProgress?.({ ...progress, percent: 28 + Math.round(progress.percent * 0.16), note: '花束图 · ' + progress.note }))

  options.onStage?.('preparing')
  options.onProgress?.({ mode: 'determinate', percent: 48, label: '正在云端合成场景', note: '保留你调整的花束位置与大小' })
  const composite = await composeCloudSceneReference({
    sceneAssetId: scene.assetId,
    bouquetAssetId: bouquet.assetId,
    x: options.x, y: options.y, scale: options.scale, aspectRatio: options.aspectRatio,
  })
  options.onProgress?.({ mode: 'determinate', percent: 60, label: '场景参考图已完成', note: '正在创建 AI 融合任务' })

  const task = await createBackendTask('scene', [composite.assetId], {
    prompt,
    sceneSourceAssetId: scene.assetId,
    sceneBouquetAssetId: bouquet.assetId,
  })
  options.onTaskCreated?.({ taskId: task.taskId, referenceAssetId: composite.assetId, referenceFileID: composite.fileID })
  const completed = await resumeFlowerImageTask({
    taskId: task.taskId,
    referenceAssetId: composite.assetId,
    referenceFileID: composite.fileID,
    progressStartPercent: 64,
    progressTitle: 'AI 正在融合场景',
    onStage: options.onStage,
    onProgress: options.onProgress,
  })
  return {
    ...completed,
    sceneSourceAssetId: scene.assetId,
    sceneBouquetAssetId: bouquet.assetId,
    sceneCompositeAssetId: composite.assetId,
  }
}
