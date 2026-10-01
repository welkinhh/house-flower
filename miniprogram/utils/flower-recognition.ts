import { createBackendTask, prepareBackendUpload, completeBackendUpload, waitForBackendTask } from './backend'
import { AI_VISION_ENABLED } from './cloud-env'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface FlowerRecognitionRow {
  id: string
  name: string
  colorLabel: string
  quantityMin: number | null
  quantityMax: number | null
  quantityLabel: string
  unit: string
  confirmed: boolean
  assetPath: string
  swatch: string
}

export interface FlowerRecognitionResult {
  rows: FlowerRecognitionRow[]
  notes: string[]
  fileID: string
  assetId: string
}

function imageType(filePath: string): Promise<'jpg' | 'png'> {
  return new Promise((resolve, reject) => wx.getImageInfo({
    src: filePath,
    success: (info) => {
      const type = String(info.type || '').toLowerCase()
      if (type === 'png') resolve('png')
      else if (type === 'jpg' || type === 'jpeg') resolve('jpg')
      else reject(new Error('请使用 JPG 或 PNG 花束照片。'))
    },
    fail: reject,
  }))
}

function imageSize(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => wx.getFileSystemManager().getFileInfo({
    filePath,
    success: (info) => resolve(info.size),
    fail: reject,
  }))
}

export async function identifyBouquet(
  filePath: string,
  onStage?: (stage: 'preparing' | 'uploading' | 'identifying') => void,
): Promise<FlowerRecognitionResult> {
  if (!AI_VISION_ENABLED) throw new Error('识花视觉模型当前未启用，生花与场景融合服务可继续使用。')
  if (!filePath) throw new Error('请先选择一张花束照片。')
  onStage?.('preparing')
  const extension = await imageType(filePath)
  if (await imageSize(filePath) > MAX_IMAGE_BYTES) throw new Error('原图超过 5 MB，请选择一张更小的原图；图片不会被拉伸或强行压缩。')

  const prepared = await prepareBackendUpload('recognition', extension)
  onStage?.('uploading')
  const uploaded = await wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath })
  if (!uploaded.fileID) throw new Error('照片上传失败，请重试。')
  await completeBackendUpload(prepared.assetId, uploaded.fileID)

  onStage?.('identifying')
  const task = await createBackendTask('recognition', [prepared.assetId])
  const completed = await waitForBackendTask(task.taskId, (stage) => {
    if (stage === 'queued' || stage === 'checking') onStage?.('preparing')
    else if (stage === 'running' || stage === 'saving') onStage?.('identifying')
  })
  const result = completed.result || {}
  if (!Array.isArray(result.items) || !result.items.length) throw new Error('没有识别到清晰的花材，请换一张照片试试。')
  const rows = result.items.map((item: any, index: number) => {
    const minimum = Number.isInteger(item.minimum) ? item.minimum : null
    const maximum = Number.isInteger(item.maximum) ? item.maximum : null
    const unit = String(item.unit || '支')
    return {
      id: String(item.id || 'recognized-' + (index + 1)),
      name: String(item.name || '待确认花材'),
      colorLabel: String(item.colorLabel || item.color || '自然色'),
      quantityMin: minimum,
      quantityMax: maximum,
      quantityLabel: minimum !== null && maximum !== null ? `约${minimum}–${maximum}${unit}` : '数量待确认',
      unit,
      confirmed: Boolean(item.confirmed),
      assetPath: String(item.assetPath || ''),
      swatch: String(item.swatch || '#d7c2b8'),
      note: String(item.reason || ''),
    }
  })
  return {
    rows,
    notes: Array.isArray(result.notes) ? result.notes : [],
    fileID: uploaded.fileID,
    assetId: prepared.assetId,
  }
}
