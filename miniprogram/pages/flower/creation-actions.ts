import { generateFlowerImageFromReference, resumeFlowerImageTask, type GeneratedFlowerImage } from '../../utils/flower-image-ai'
import { identifyBouquet } from '../../utils/flower-recognition'
import { saveImageToAlbum } from '../../utils/image-album'
import { aiFailureMessage, logAiFailure } from '../../utils/ai-diagnostics'
import { dayKey, formatDateLabel, readWorks, saveWork, type WorkRecord } from '../../utils/houseflower-data'
import { flowerAssetForName } from '../../utils/flower-materials'
import { getBackendTask, getCloudAssetDetails, getDailyQuota, saveCloudWork } from '../../utils/backend'

const PENDING_FLOWER_GENERATION_KEY = 'houseflower.pendingFlowerGeneration'

type PendingFlowerGeneration = {
  status: 'waiting' | 'completed'
  taskId: string
  referenceAssetId: string
  referenceFileID: string
  sourcePath: string
  title: string
  createdAt: number
  resultAssetId?: string
  resultFileID?: string
  resultPath?: string
  completedAt?: number
}

function readPendingFlowerGeneration(): PendingFlowerGeneration | null {
  try {
    const value = wx.getStorageSync(PENDING_FLOWER_GENERATION_KEY)
    return value && value.taskId && value.referenceAssetId ? value as PendingFlowerGeneration : null
  } catch { return null }
}

function writePendingFlowerGeneration(value: PendingFlowerGeneration): void {
  try { wx.setStorageSync(PENDING_FLOWER_GENERATION_KEY, value) } catch {}
}

function clearPendingFlowerGeneration(): void {
  try { wx.removeStorageSync(PENDING_FLOWER_GENERATION_KEY) } catch {}
}

async function refreshPendingFlowerAssets(pending: PendingFlowerGeneration): Promise<PendingFlowerGeneration> {
  const assetIds = [pending.referenceAssetId, pending.resultAssetId].filter(Boolean) as string[]
  if (!assetIds.length) return pending
  const details = await getCloudAssetDetails(assetIds)
  return {
    ...pending,
    referenceFileID: details.fileIDs[pending.referenceAssetId] || pending.referenceFileID,
    sourcePath: details.urls[pending.referenceAssetId] || pending.sourcePath,
    resultFileID: pending.resultAssetId ? details.fileIDs[pending.resultAssetId] || pending.resultFileID : pending.resultFileID,
    resultPath: pending.resultAssetId ? details.urls[pending.resultAssetId] || pending.resultPath : pending.resultPath,
  }
}

function showGeneratedFlowerResult(page: any, pending: PendingFlowerGeneration, result: GeneratedFlowerImage): void {
  const completedAt = Number(pending.completedAt) || Date.now()
  const completed: PendingFlowerGeneration = {
    ...pending,
    status: 'completed',
    sourcePath: result.referenceTempURL || pending.sourcePath,
    referenceFileID: result.referenceFileID || pending.referenceFileID,
    resultAssetId: result.resultAssetId,
    resultFileID: result.fileID,
    resultPath: result.tempFileURL,
    completedAt,
  }
  writePendingFlowerGeneration(completed)
  page._activeGenerationTaskId = ''
  const showNow = page.data.mode === 'inspiration'
    && (page.data.generating || page.data.generationResumePending)
  page.setData({
    generating: false,
    generationResumePending: false,
    generationSourcePath: completed.sourcePath,
    generationPreviewPath: result.tempFileURL,
    sourceFileID: completed.referenceFileID,
    generationFileID: result.fileID,
    generationSourceAssetId: completed.referenceAssetId,
    generationAssetId: result.resultAssetId,
    bouquetTitle: completed.title || page.data.bouquetTitle || '生活画面 · 花束',
    generationDateLabel: formatDateLabel(completedAt),
    generationDemo: false,
    generatedSaved: false,
    generationProgressPercent: 100,
    generationProgressLabel: '',
    generationProgressNote: '',
    generationProgressFillStyle: '',
    ...(showNow ? { mode: 'generationResult', topCaption: '拾光成花' } : {}),
  }, () => {
    if (showNow) page.refreshNav()
    void getDailyQuota().then((quota) => page.setData({ remainingUses: quota.remaining, quotaReserved: quota.reserved })).catch(() => {})
  })
}

async function handleFlowerGenerationFailure(page: any, error: any, taskId: string): Promise<void> {
  const failureMessage = aiFailureMessage(error, '生花失败，请稍后重试。')
  let task: any = null
  if (taskId) task = await getBackendTask(taskId).catch(() => null)
  const terminal = task && ['failed', 'blocked', 'cancelled'].includes(String(task.status || ''))
  if (terminal || !taskId) clearPendingFlowerGeneration()
  page._activeGenerationTaskId = ''
  page.setData({
    generating: false,
    generationResumePending: Boolean(taskId && !terminal),
    generationProgressMode: 'indeterminate',
    generationProgressLabel: taskId && !terminal ? '任务仍在后台运行' : '',
    generationProgressNote: taskId && !terminal ? '连接暂时中断；点击按钮可继续查看，不会重复扣次' : '',
    generationProgressFillStyle: '',
    inspirationMessage: failureMessage,
  })
  void getDailyQuota().then((quota) => page.setData({ remainingUses: quota.remaining, quotaReserved: quota.reserved })).catch(() => {})
}

function persistImage(path: string, done: (savedPath: string) => void): void {
  if (!path) { done(''); return }
  if (path.indexOf('/assets/') === 0 || path.indexOf('wxfile://store') === 0) { done(path); return }
  const save = (tempPath: string) => wx.saveFile({
    tempFilePath: tempPath,
    success: (result) => done(result.savedFilePath || tempPath),
    fail: () => done(''),
  })
  if (/^https?:\/\//i.test(path)) {
    wx.downloadFile({ url: path, success: (result) => result.statusCode === 200 ? save(result.tempFilePath) : done(''), fail: () => done('') })
  } else save(path)
}

function demoRowsFor(id: string): any[] {
  const sets: Record<string, Array<[string, string, number, number, string]>> = {
    'hand-bouquet': [['粉色玫瑰', '粉色', 4, 7, '支'], ['芍药', '浅粉', 2, 4, '支'], ['尤加利叶', '灰绿', 2, 3, '枝']],
    arrangement: [['洋桔梗', '粉色', 3, 5, '支'], ['小雏菊', '白色', 3, 5, '支'], ['尤加利叶', '灰绿', 2, 4, '枝']],
    basket: [['非洲菊', '橙粉', 3, 5, '支'], ['康乃馨', '浅粉', 3, 5, '支'], ['配花', '白色', 2, 4, '支']],
  }
  return (sets[id] || sets['hand-bouquet']).map(([name, colorLabel, quantityMin, quantityMax, unit], index) => {
    const flower = flowerAssetForName(name)
    return {
      id: 'sample-' + id + '-' + index, name, colorLabel, quantityMin, quantityMax, unit,
      quantityLabel: '约' + quantityMin + '–' + quantityMax + unit, confirmed: false,
      assetPath: flower ? flower.assetPath : '', swatch: flower ? flower.swatch : '#d7c2b8',
    }
  })
}

function chooseImage(done: (path: string) => void): void {
  wx.chooseImage({
    count: 1, sizeType: ['original'], sourceType: ['album', 'camera'],
    success: (result: any) => { const path = result.tempFilePaths && result.tempFilePaths[0]; if (path) done(path) },
  })
}

export const creationActions = {
  startImageCreation(this: any) {
    const pending = readPendingFlowerGeneration()
    if (pending) {
      this.setMode('inspiration', '拾光成花')
      void this.restorePendingGeneration(true)
      return
    }
    this.setData({
      inspirationPath: '', inspirationMessage: '',
      generationPreviewPath: '', generationSourcePath: '', generationFileID: '', sourceFileID: '', generationAssetId: '', generationSourceAssetId: '',
      bouquetTitle: '生活画面 · 花束', generationDateLabel: '', generationDemo: false,
      generating: false, generationResumePending: false, generatedSaved: false, generationProgressPercent: 0,
      generationProgressLabel: '', generationProgressNote: '', generationProgressFillStyle: '',
    })
    this.setMode('inspiration', '拾光成花')
  },
  clearPendingFlowerGeneration(this: any) {
    clearPendingFlowerGeneration()
    this._activeGenerationTaskId = ''
    this.setData({ generationResumePending: false })
  },
  async restorePendingGeneration(this: any, force = false) {
    const pending = readPendingFlowerGeneration()
    if (!pending) return false
    if (!force && !['home', 'inspiration'].includes(String(this.data.mode || 'home'))) return false
    if (this.data.mode !== 'inspiration') this.setMode('inspiration', '拾光成花')
    if (this._activeGenerationTaskId === pending.taskId && this.data.generating) return true

    this._activeGenerationTaskId = pending.taskId
    this.setData({
      inspirationPath: pending.sourcePath || '',
      bouquetTitle: pending.title || '生活画面 · 花束',
      generationStageLabel: '正在恢复任务…',
      generationProgressMode: 'indeterminate',
      generationProgressPercent: 0,
      generationProgressLabel: '正在恢复生成进度',
      generationProgressNote: '正在连接后台任务，不会重复上传或重复扣次',
      generationProgressFillStyle: '',
      generating: true,
      generationResumePending: false,
      inspirationMessage: '',
    })

    try {
      const refreshed = await refreshPendingFlowerAssets(pending).catch(() => pending)
      writePendingFlowerGeneration(refreshed)
      if (refreshed.sourcePath) this.setData({ inspirationPath: refreshed.sourcePath })
      const result = await resumeFlowerImageTask({
        taskId: pending.taskId,
        referenceAssetId: refreshed.referenceAssetId,
        referenceFileID: refreshed.referenceFileID,
        onStage: (stage) => {
          const labels: Record<string, string> = { preparing: '后台排队中…', uploading: '正在连接任务…', generating: '正在生花…' }
          this.setData({ generationStageLabel: labels[stage] || '正在生花…' })
        },
        onProgress: (progress) => this.setData({
          generationProgressMode: progress.mode,
          generationProgressPercent: progress.percent,
          generationProgressLabel: progress.label,
          generationProgressNote: progress.note,
          generationProgressFillStyle: progress.mode === 'determinate' ? 'width:' + progress.percent + '%;' : '',
        }),
      })
      showGeneratedFlowerResult(this, refreshed, result)
      return true
    } catch (error: any) {
      logAiFailure('bouquet', error, '恢复后台任务')
      await handleFlowerGenerationFailure(this, error, pending.taskId)
      wx.showToast({ title: '正在后台继续生成，可稍后点按钮恢复进度', icon: 'none', duration: 2600 })
      return false
    }
  },
  chooseInspiration(this: any) {
    const pending = readPendingFlowerGeneration()
    if (this.data.generating || (pending && pending.status === 'waiting')) {
      void this.restorePendingGeneration(true)
      wx.showToast({ title: '上一束花仍在后台生成', icon: 'none' })
      return
    }
    if (pending) this.clearPendingFlowerGeneration()
    chooseImage((path) => this.setData({
      inspirationPath: path, generationSourcePath: '', generationPreviewPath: '', generationFileID: '', sourceFileID: '', generationAssetId: '', generationSourceAssetId: '',
      bouquetTitle: '生活画面 · 花束', generationDateLabel: '', generationDemo: false, generatedSaved: false, generationResumePending: false, inspirationMessage: '',
      generationProgressPercent: 0, generationProgressLabel: '', generationProgressNote: '', generationProgressFillStyle: '',
    }))
  },
  chooseInspirationSample(this: any, event: any) {
    const pending = readPendingFlowerGeneration()
    if (this.data.generating || (pending && pending.status === 'waiting')) {
      void this.restorePendingGeneration(true)
      wx.showToast({ title: '上一束花仍在后台生成', icon: 'none' })
      return
    }
    if (pending) this.clearPendingFlowerGeneration()
    const path = String(event.currentTarget.dataset.path || '')
    const label = String(event.currentTarget.dataset.label || '生活画面')
    if (!path) return
    this.setData({
      inspirationPath: path, generationSourcePath: '', generationPreviewPath: '', generationFileID: '', sourceFileID: '', generationAssetId: '', generationSourceAssetId: '',
      bouquetTitle: label + ' · 花束', generationDateLabel: '', generationDemo: false, generatedSaved: false, generationResumePending: false, inspirationMessage: '',
      generationProgressPercent: 0, generationProgressLabel: '', generationProgressNote: '', generationProgressFillStyle: '',
    })
  },
  async applyInspiration(this: any) {
    const pending = readPendingFlowerGeneration()
    if (pending) { void this.restorePendingGeneration(true); return }
    const path = String(this.data.inspirationPath || '')
    if (!path || this.data.generating) return
    if (Number(this.data.remainingUses) <= 0) { wx.showToast({ title: '剩余次数不足', icon: 'none' }); return }
    this.setData({
      generating: true, generationStageLabel: '准备图片…', inspirationMessage: '',
      generationProgressMode: 'determinate', generationProgressPercent: 5,
      generationProgressLabel: '正在准备图片', generationProgressNote: '检查图片格式和大小',
      generationProgressFillStyle: 'width:5%;',
    })
    generateFlowerImageFromReference({
      filePath: path,
      prompt: '请提取原图的主色比例、视觉主体、光线和材质线索，并具体落实到花材搭配、包花纸与丝带设计中。',
      onTaskCreated: (task) => {
        const draft: PendingFlowerGeneration = {
          status: 'waiting', taskId: task.taskId,
          referenceAssetId: task.referenceAssetId, referenceFileID: task.referenceFileID,
          sourcePath: path, title: String(this.data.bouquetTitle || '生活画面 · 花束'), createdAt: Date.now(),
        }
        writePendingFlowerGeneration(draft)
        this._activeGenerationTaskId = task.taskId
        this.setData({ generationResumePending: false, generationProgressNote: '任务已保存到后台，离开页面后仍可回来查看' })
      },
      onStage: (stage) => {
        const labels: Record<string, string> = { preparing: '准备图片…', uploading: '正在上传…', generating: '正在生花…' }
        this.setData({ generationStageLabel: labels[stage] || '正在生花…' })
      },
      onProgress: (progress) => this.setData({
        generationProgressMode: progress.mode,
        generationProgressPercent: progress.percent,
        generationProgressLabel: progress.label,
        generationProgressNote: progress.note,
        generationProgressFillStyle: progress.mode === 'determinate' ? 'width:' + progress.percent + '%;' : '',
      }),
    }).then((result) => {
      const pending = readPendingFlowerGeneration() || {
        status: 'waiting' as const, taskId: result.taskId, referenceAssetId: result.referenceAssetId,
        referenceFileID: result.referenceFileID, sourcePath: path,
        title: String(this.data.bouquetTitle || '生活画面 · 花束'), createdAt: Date.now(),
      }
      showGeneratedFlowerResult(this, pending, result)
    }).catch(async (error: any) => {
      logAiFailure('bouquet', error, String(this.data.generationStageLabel || ''))
      const failureMessage = aiFailureMessage(error, '生花失败，请稍后重试。')
      const taskId = String(this._activeGenerationTaskId || '')
      await handleFlowerGenerationFailure(this, new Error(failureMessage), taskId)
      this.setData({ generationStageLabel: '', inspirationMessage: failureMessage })
      wx.showToast({ title: failureMessage.indexOf('图片上传权限') >= 0 ? '图片上传失败' : '生成未成功', icon: 'none' })
    })
  },
  updateBouquetTitle(this: any, event: any) { this.setData({ bouquetTitle: String(event.detail.value || '') }) },
  saveGeneratedWork(this: any) {
    if (!this.data.generationPreviewPath) return
    const page = this
    persistImage(String(this.data.generationPreviewPath), (previewPath) => persistImage(String(page.data.generationSourcePath || ''), (sourcePath) => {
      if (!previewPath || !sourcePath) { wx.showToast({ title: '图片未能持久保存，请稍后重试', icon: 'none' }); return }
      const now = Date.now()
      const work: WorkRecord = {
        id: String(now), kind: 'bouquet', title: String(page.data.bouquetTitle || '生活画面 · 花束'),
        previewPath, sourcePath, fileID: page.data.generationFileID, sourceFileID: page.data.sourceFileID,
        previewAssetId: page.data.generationAssetId, sourceAssetId: page.data.generationSourceAssetId,
        createdAt: now, dateKey: dayKey(new Date(now)),
        sourceKey: 'bouquet|' + String(page.data.sourceFileID || page.data.generationSourcePath) + '|' + String(page.data.generationFileID || ''),
      }
      try {
        const works = saveWork(work)
        clearPendingFlowerGeneration()
        page._activeGenerationTaskId = ''
        page.setData({ works, generatedSaved: true }, () => page.refreshWorks())
        const saved = works.find((item) => item.sourceKey === work.sourceKey) || work
        const sync = page.data.backendReady ? saveCloudWork({
          kind: work.kind, title: work.title, sourceKey: work.sourceKey,
          previewAssetId: work.previewAssetId, sourceAssetId: work.sourceAssetId,
          metadata: { createdAt: work.createdAt, fileID: work.fileID, sourceFileID: work.sourceFileID },
        }) : Promise.reject(new Error('云端暂不可用'))
        void sync.then((remote) => {
          const synced = readWorks().map((item) => item.id === saved.id ? { ...item, cloudWorkId: remote.workId, cloudRevision: remote.revision, cloudSyncPending: false } : item)
          wx.setStorageSync('houseflower.works', synced)
          page.setData({ works: synced }, () => wx.showToast({ title: '已保存到作品集', icon: 'success' }))
        }).catch(() => {
          const pending = readWorks().map((item) => item.id === saved.id ? { ...item, cloudSyncPending: true } : item)
          wx.setStorageSync('houseflower.works', pending)
          page.setData({ works: pending }, () => wx.showToast({ title: '已保存到本机，云端同步待重试', icon: 'none' }))
        })
      } catch { wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' }) }
    }))
  },
  downloadGeneratedImage(this: any) { if (this.data.generationPreviewPath) saveImageToAlbum(String(this.data.generationPreviewPath)) },
  recognizeGeneratedBouquet(this: any) {
    if (this.data.generationDemo) { wx.showToast({ title: '示例效果暂不可识花', icon: 'none' }); return }
    const path = String(this.data.generationPreviewPath || '')
    if (!path) return
    const sourceWork = (this.data.works || []).find((work: WorkRecord) =>
      (this.data.generationAssetId && work.previewAssetId === this.data.generationAssetId)
      || (this.data.generationFileID && work.fileID === this.data.generationFileID))
    const begin = (localPath: string) => {
      this.setData({
        replicaPath: localPath, replicaCandidates: [], replicaNotes: [], replicaAssetId: '',
        replicaMessage: '', replicaDemo: false, replicaSampleId: '', replicaParentWorkId: sourceWork ? sourceWork.id : '',
        sourceFileID: this.data.generationFileID || '', recognitionSaved: false,
      }, () => {
        this.setMode('recognition', '识花成单')
        this.refreshNav()
      })
    }
    if (/^https?:\/\//i.test(path)) {
      wx.downloadFile({
        url: path,
        success: (result) => result.statusCode === 200 ? begin(result.tempFilePath) : wx.showToast({ title: '成品图读取失败，请重试', icon: 'none' }),
        fail: () => wx.showToast({ title: '成品图读取失败，请重试', icon: 'none' }),
      })
    } else begin(path)
  },
  chooseReplica(this: any) {
    chooseImage((path) => this.setData({
      replicaPath: path, replicaCandidates: [], replicaNotes: [], replicaAssetId: '', replicaDemo: false, recognitionSaved: false,
      replicaSampleId: '', replicaParentWorkId: '', replicaMessage: '',
    }))
  },
  chooseReplicaSample(this: any, event: any) {
    const path = String(event.currentTarget.dataset.path || '')
    if (path) this.setData({
      replicaPath: path, replicaCandidates: [], replicaNotes: [], replicaAssetId: '',
      replicaSampleId: String(event.currentTarget.dataset.id || 'hand-bouquet'), replicaParentWorkId: '',
      replicaDemo: false, recognitionSaved: false, replicaMessage: '',
    })
  },
  async replicaAction(this: any) {
    const path = String(this.data.replicaPath || '')
    if (!path || this.data.identifying) return
    const sampleId = String(this.data.replicaSampleId || '')
    if (sampleId) {
      this.setData({
        mode: 'recognitionResult', topCaption: '识花成单', replicaCandidates: demoRowsFor(sampleId),
        replicaNotes: ['示例估算，请按实物确认花材与数量。'], identifying: false, replicaDemo: true,
        recognitionSaved: false, replicaMessage: '',
      }, () => this.refreshNav())
      return
    }
    if (Number(this.data.remainingUses) <= 0) { wx.showToast({ title: '剩余次数不足', icon: 'none' }); return }
    this.setData({ identifying: true, recognitionStageLabel: '准备图片…', replicaMessage: '' })
    identifyBouquet(path, (stage) => {
      const labels: Record<string, string> = { preparing: '准备图片…', uploading: '正在上传…', identifying: '正在识花…' }
      this.setData({ recognitionStageLabel: labels[stage] || '正在识花…' })
    }).then(async (result) => {
      const rows = result.rows.map((row) => {
        const flower = flowerAssetForName(row.name)
        return { ...row, assetPath: flower ? flower.assetPath : '', swatch: flower ? flower.swatch : row.swatch }
      })
      const quota = await getDailyQuota().catch(() => null)
      this.setData({
        mode: 'recognitionResult', topCaption: '识花成单', replicaCandidates: rows,
        replicaNotes: result.notes, sourceFileID: result.fileID, replicaAssetId: result.assetId, identifying: false, replicaDemo: false,
        recognitionSaved: false, replicaMessage: '', remainingUses: quota ? quota.remaining : this.data.remainingUses, quotaReserved: quota ? quota.reserved : 0,
      })
      this.refreshNav()
    }).catch(async (error: any) => {
      logAiFailure('recognition', error, String(this.data.recognitionStageLabel || ''))
      const failureMessage = aiFailureMessage(error, '识花失败，请稍后重试。')
      void getDailyQuota().then((quota) => this.setData({ remainingUses: quota.remaining, quotaReserved: quota.reserved })).catch(() => {})
      const visionDisabled = error && String(error.message || '').indexOf('识花视觉模型') >= 0
      this.setData({
        identifying: false, recognitionStageLabel: '', replicaMessage: failureMessage, replicaDemo: false,
      })
      wx.showToast({ title: visionDisabled ? '识花模型暂未开通' : 'AI 服务暂不可用，请稍后重试', icon: 'none' })
    })
  },
  replicaAgain(this: any) {
    this.setData({ mode: 'recognition', replicaCandidates: [], replicaNotes: [], recognitionSaved: false, replicaDemo: false, topCaption: '识花成单' })
    this.refreshNav()
  },
  editCandidateQuantity(this: any, event: any) {
    const index = Number(event.currentTarget.dataset.index)
    const rows = (this.data.replicaCandidates || []).slice()
    const row = rows[index]
    if (!row) return
    wx.showModal({
      title: '确认用量', content: '', editable: true,
      placeholderText: row.quantityMin && row.quantityMax ? '请输入确认数量' : '数量不确定，可填写估算值',
      confirmText: '确认',
      success: (result: any) => {
        if (!result.confirm) return
        const quantityText = String(result.content || '').trim()
        if (!/^[1-9]\d{0,2}$/.test(quantityText)) { wx.showToast({ title: '请输入 1–999 的整数', icon: 'none' }); return }
        const quantity = Number(quantityText)
        rows[index] = { ...row, quantity, confirmed: true }
        this.setData({ replicaCandidates: rows, recognitionSaved: false })
      },
    })
  },
  stepCandidateQuantity(this: any, event: any) {
    const index = Number(event.currentTarget.dataset.index)
    const delta = Number(event.currentTarget.dataset.delta || 0)
    const rows = (this.data.replicaCandidates || []).slice()
    const row = rows[index]
    if (!row) return
    const base = row.confirmed ? Number(row.quantity || 0) : Number(row.quantityMin || row.quantity || 1)
    const quantity = Math.max(1, Math.min(999, (Number.isInteger(base) ? base : 1) + delta))
    rows[index] = { ...row, quantity, confirmed: true }
    this.setData({ replicaCandidates: rows, recognitionSaved: false })
  },
  stepSavedQuantity(this: any, event: any) {
    const index = Number(event.currentTarget.dataset.index)
    const delta = Number(event.currentTarget.dataset.delta || 0)
    const current = this.data.currentWork
    const row = current && current.rows && current.rows[index]
    if (!row) return
    const base = row.confirmed ? Number(row.quantity || 0) : Number(row.quantityMin || row.quantity || 1)
    const quantity = Math.max(1, Math.min(999, (Number.isInteger(base) ? base : 1) + delta))
    const rows = current.rows.slice()
    rows[index] = { ...row, quantity, confirmed: true }
    this.setData({ currentWork: { ...current, rows, status: rows.every((item: any) => item.confirmed) ? 'confirmed' : 'draft' } }, () => this.scheduleSavedMaterialsSave())
  },
  addCandidate(this: any) {
    const current = (this.data.replicaCandidates || []).slice()
    wx.showModal({
      title: '添加花材', content: '', editable: true, placeholderText: '输入花材名称',
      success: (result: any) => {
        const name = String(result.content || '').trim()
        if (!result.confirm || !name) return
        current.push({
          id: 'manual-' + Date.now(), name, colorLabel: '自然色',
          quantityMin: null, quantityMax: null, quantityLabel: '数量待确认',
          unit: '支', confirmed: false, assetPath: '', swatch: '#d7c2b8',
        })
        this.setData({ replicaCandidates: current, recognitionSaved: false })
      },
    })
  },
  editCandidateText(this: any, event: any) {
    const index = Number(event.currentTarget.dataset.index)
    const field = String(event.currentTarget.dataset.field || '')
    if (!['name', 'colorLabel', 'unit'].includes(field)) return
    const saved = this.data.mode === 'workDetail' && this.data.currentWork
    const sourceRows = saved ? this.data.currentWork.rows || [] : this.data.replicaCandidates || []
    const row = sourceRows[index]
    if (!row) return
    if (field === 'unit') {
      const units = ['支', '枝', '朵', '束', '片', '份', '张', '米']
      wx.showActionSheet({
        itemList: units,
        success: (result: any) => {
          const value = units[Number(result.tapIndex)]
          if (!value || value === row.unit) return
          const rows = sourceRows.slice()
          const updated = { ...row, unit: value }
          if (row.quantityMin && row.quantityMax) updated.quantityLabel = '约' + row.quantityMin + '–' + row.quantityMax + value
          rows[index] = updated
          if (saved) {
            this.setData({ currentWork: { ...this.data.currentWork, rows, status: rows.every((item: any) => item.confirmed) ? 'confirmed' : 'draft' } }, () => this.scheduleSavedMaterialsSave())
          } else this.setData({ replicaCandidates: rows, recognitionSaved: false })
        },
      })
      return
    }
    const label = field === 'name' ? '花材名称' : field === 'colorLabel' ? '花材颜色' : '计量单位'
    wx.showModal({
      title: '调整' + label, content: '', editable: true, placeholderText: String(row[field] || ''),
      success: (result: any) => {
        const value = String(result.content || '').trim()
        if (!result.confirm || !value) return
        const rows = sourceRows.slice()
        const updated = { ...row, [field]: value }
        if (field === 'name') {
          const flower = flowerAssetForName(value)
          if (flower) updated.assetPath = flower.assetPath
        }
        rows[index] = updated
        if (saved) {
          this.setData({ currentWork: { ...this.data.currentWork, rows, status: rows.every((item: any) => item.confirmed) ? 'confirmed' : 'draft' } }, () => this.scheduleSavedMaterialsSave())
        } else this.setData({ replicaCandidates: rows, recognitionSaved: false })
      },
    })
  },
  removeCandidate(this: any, event: any) {
    const rows = (this.data.replicaCandidates || []).slice()
    rows.splice(Number(event.currentTarget.dataset.index), 1)
    this.setData({ replicaCandidates: rows, recognitionSaved: false })
  },
  saveReplicaWork(this: any) {
    if (this.data.replicaDemo) { wx.showToast({ title: '示例清单不能保存为真实作品', icon: 'none' }); return }
    const path = String(this.data.replicaPath || '')
    const rows = this.data.replicaCandidates || []
    if (!path || !rows.length) { wx.showToast({ title: '当前没有可保存的清单', icon: 'none' }); return }
    const page = this
    persistImage(path, (savedPath) => {
      const now = Date.now()
      const parent = (page.data.works || []).find((item: WorkRecord) => item.id === page.data.replicaParentWorkId)
      const work: WorkRecord = {
        ...(parent || {}), id: parent ? parent.id : String(now), kind: parent ? parent.kind : 'bouquet',
        title: parent ? parent.title : '照片花作', previewPath: parent ? parent.previewPath : savedPath,
        sourcePath: parent ? parent.sourcePath : savedPath,
        fileID: parent ? parent.fileID : page.data.sourceFileID,
        previewAssetId: parent ? parent.previewAssetId : page.data.replicaAssetId,
        sourceAssetId: parent ? parent.sourceAssetId : page.data.replicaAssetId,
        createdAt: parent ? parent.createdAt : now, dateKey: parent ? (parent.dateKey || dayKey(new Date(parent.createdAt))) : dayKey(new Date(now)),
        sourceKey: parent ? parent.sourceKey : 'bouquet-recognition|' + String(page.data.sourceFileID || page.data.replicaAssetId || savedPath),
        rows: JSON.parse(JSON.stringify(rows)), status: rows.every((row: any) => row.confirmed) ? 'confirmed' : 'draft',
        notes: page.data.replicaNotes || [],
      }
      try {
        const works = saveWork(work)
        page.setData({ works, recognitionSaved: true }, () => page.refreshWorks())
        const saved = works.find((item) => item.sourceKey === work.sourceKey) || work
        const sync = page.data.backendReady ? saveCloudWork({
          id: work.cloudWorkId, expectedRevision: work.cloudRevision,
          kind: work.kind, title: work.title, sourceKey: work.sourceKey,
          previewAssetId: work.previewAssetId || work.sourceAssetId, sourceAssetId: work.sourceAssetId, rows: work.rows,
          metadata: {
            createdAt: work.createdAt, fileID: work.fileID, notes: work.notes, status: work.status, note: work.note,
            previewPath: work.previewAssetId || work.sourceAssetId ? '' : work.previewPath,
            sourcePath: work.sourceAssetId ? '' : work.sourcePath,
          },
        }) : Promise.reject(new Error('云端暂不可用'))
        void sync.then((remote) => {
          const synced = readWorks().map((item) => item.id === saved.id ? { ...item, cloudWorkId: remote.workId, cloudRevision: remote.revision, previewAssetId: work.previewAssetId || work.sourceAssetId, cloudSyncPending: false } : item)
          wx.setStorageSync('houseflower.works', synced)
          page.setData({ works: synced }, () => wx.showToast({ title: work.status === 'confirmed' ? '清单已保存到作品集' : '估算清单已保存到作品集', icon: 'success' }))
        }).catch(() => {
          const pending = readWorks().map((item) => item.id === saved.id ? { ...item, cloudSyncPending: true } : item)
          wx.setStorageSync('houseflower.works', pending)
          page.setData({ works: pending }, () => wx.showToast({ title: '已保存在本机，云端同步待重试', icon: 'none' }))
        })
      } catch { wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' }) }
    })
  },
  editSavedQuantity(this: any, event: any) {
    const index = Number(event.currentTarget.dataset.index)
    const current = this.data.currentWork
    const row = current && current.rows && current.rows[index]
    if (!row) return
    wx.showModal({
      title: '调整用量', content: '', editable: true, placeholderText: '输入确认数量', confirmText: '确认',
      success: (result: any) => {
        if (!result.confirm) return
        const quantity = Number(String(result.content || '').replace(/[^\d]/g, ''))
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) { wx.showToast({ title: '请输入 1–999 的数量', icon: 'none' }); return }
        const rows = current.rows.slice()
        rows[index] = { ...row, quantity, confirmed: true }
        this.setData({ currentWork: { ...current, rows, status: rows.every((item: any) => item.confirmed) ? 'confirmed' : 'draft' } }, () => this.scheduleSavedMaterialsSave())
      },
    })
  },
  scheduleSavedMaterialsSave(this: any) {
    if (this._savedMaterialsTimer) clearTimeout(this._savedMaterialsTimer)
    this._savedMaterialsTimer = setTimeout(() => {
      this._savedMaterialsTimer = null
      this.saveSavedMaterials()
    }, 450)
  },
  async saveSavedMaterials(this: any) {
    const current = this.data.currentWork
    if (!current) return
    const updated = { ...current, rows: JSON.parse(JSON.stringify(current.rows || [])), status: (current.rows || []).every((row: any) => row.confirmed) ? 'confirmed' : 'draft' }
    try {
      const works = (this.data.works || []).map((work: WorkRecord) => work.id === updated.id ? updated : work)
      wx.setStorageSync('houseflower.works', works)
      this.setData({ works, currentWork: updated })
      this.refreshWorks()
      if (!this.data.backendReady) throw new Error('云端暂不可用')
      const remote = await saveCloudWork({
        id: updated.cloudWorkId,
        expectedRevision: updated.cloudRevision,
        kind: updated.kind,
        title: updated.title,
        sourceKey: updated.sourceKey,
        previewAssetId: updated.previewAssetId || updated.sourceAssetId,
        sourceAssetId: updated.sourceAssetId,
        rows: updated.rows,
        metadata: { createdAt: updated.createdAt, notes: updated.notes, status: updated.status, note: updated.note },
      })
      const synced = readWorks().map((item) => item.id === updated.id
        ? { ...item, cloudWorkId: remote.workId, cloudRevision: remote.revision, cloudSyncPending: false }
        : item)
      wx.setStorageSync('houseflower.works', synced)
      this.setData({ works: synced, currentWork: { ...updated, cloudWorkId: remote.workId, cloudRevision: remote.revision, cloudSyncPending: false } })
      wx.showToast({ title: updated.status === 'confirmed' ? '清单已确认并同步' : '估算草稿已同步', icon: 'success' })
    } catch {
      const pending = readWorks().map((item) => item.id === updated.id ? { ...item, cloudSyncPending: true } : item)
      wx.setStorageSync('houseflower.works', pending)
      this.setData({ works: pending, currentWork: { ...updated, cloudSyncPending: true } })
      wx.showToast({ title: '本机已保存，云端同步失败，请重试', icon: 'none' })
    }
  },
  recognizeSavedWork(this: any) {
    const work: WorkRecord | null = this.data.currentWork
    if (!work || !work.previewPath) return
    const begin = (path: string) => {
      this.setData({
        replicaPath: path, replicaCandidates: [], replicaNotes: [], replicaAssetId: '',
        sourceFileID: work.fileID || '', replicaSampleId: path.indexOf('/assets/') === 0 ? 'hand-bouquet' : '',
        replicaParentWorkId: work.id, replicaDemo: false, recognitionSaved: false, replicaMessage: '',
      }, () => {
        this.setMode('recognition', '识花成单')
        this.refreshNav()
      })
    }
    if (/^https?:\/\//i.test(work.previewPath)) {
      wx.downloadFile({ url: work.previewPath, success: (result) => result.statusCode === 200 ? begin(result.tempFilePath) : wx.showToast({ title: '作品图片读取失败，请重试', icon: 'none' }), fail: () => wx.showToast({ title: '作品图片读取失败，请重试', icon: 'none' }) })
    } else begin(work.previewPath)
  },
  downloadWorkImage(this: any) {
    const work = this.data.currentWork
    if (!work || !work.previewPath) return
    saveImageToAlbum(String(work.previewPath))
  },
  downloadMaterials(this: any) {
    const rows = (this.data.replicaCandidates || []).slice()
    if (!rows.length) { wx.showToast({ title: '没有可导出的花材', icon: 'none' }); return }
    this.renderMaterialsImage(rows, String(this.data.replicaPath || ''), Boolean(this.data.replicaDemo))
  },
  downloadSavedMaterials(this: any) {
    const work = this.data.currentWork
    const rows = work && Array.isArray(work.rows) ? work.rows.slice() : []
    if (!rows.length) { wx.showToast({ title: '没有可导出的花材', icon: 'none' }); return }
    this.renderMaterialsImage(rows, String(work.previewPath || ''), false)
  },
  renderMaterialsImage(this: any, rows: any[], artworkPath: string, demo: boolean) {
    const canvas = this._exportCanvas
    if (!canvas) { wx.showToast({ title: '清单画布尚未就绪，请稍后重试', icon: 'none' }); return }
    const page = this
    const ratio = 2
    const width = 360
    const rowHeight = 78
    const rowsTop = 202
    const height = rowsTop + Math.max(1, rows.length) * rowHeight + 46
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) { wx.showToast({ title: '清单暂时无法生成', icon: 'none' }); return }
    ctx.scale(ratio, ratio)
    const load = (path: string) => new Promise<any>((resolve) => {
      if (!path) { resolve(null); return }
      const image = canvas.createImage()
      image.onload = () => resolve(image)
      image.onerror = () => resolve(null)
      image.src = path
    })
    Promise.all([load(artworkPath), ...rows.map((row) => load(row.assetPath || ''))]).then((images) => {
      ctx.fillStyle = '#f8f4ee'; ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#302b27'; ctx.font = '20px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('House花生 · ' + (demo ? '示例清单' : '花材清单'), 24, 30)
      ctx.fillStyle = '#95877c'; ctx.font = '12px sans-serif'; ctx.fillText(new Date().toLocaleDateString(), 24, 50)
      const art = images[0]
      if (art) {
        const aw = width - 48, ah = 82, scale = Math.min(aw / art.width, ah / art.height)
        ctx.drawImage(art, 24 + (aw - art.width * scale) / 2, 62 + (ah - art.height * scale) / 2, art.width * scale, art.height * scale)
      }
      ctx.fillStyle = '#51473f'; ctx.font = '14px sans-serif'; ctx.fillText('花材与颜色', 24, 174)
      ctx.textAlign = 'right'; ctx.fillText('数量', width - 24, 174)
      rows.forEach((row, index) => {
        const y = rowsTop + index * rowHeight
        const thumb = images[index + 1]
        if (thumb) {
          const scale = Math.min(48 / thumb.width, 58 / thumb.height)
          const imageWidth = thumb.width * scale
          const imageHeight = thumb.height * scale
          ctx.drawImage(thumb, 24 + (48 - imageWidth) / 2, y + (60 - imageHeight) / 2, imageWidth, imageHeight)
        } else {
          ctx.fillStyle = row.swatch || '#d7c2b8'; ctx.beginPath(); ctx.arc(48, y + 30, 9, 0, Math.PI * 2); ctx.fill()
        }
        ctx.fillStyle = '#51473f'; ctx.font = '14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(String(row.name || '').slice(0, 14), 82, y + 26)
        ctx.fillStyle = '#92847a'; ctx.font = '11px sans-serif'; ctx.fillText(String(row.colorLabel || '').slice(0, 12), 82, y + 48)
        ctx.textAlign = 'right'; ctx.fillStyle = '#735e58'; ctx.font = '15px sans-serif'
        ctx.fillText(row.confirmed ? String(row.quantity) + String(row.unit || '支') : String(row.quantityLabel || '数量待确认'), width - 24, y + 35)
        ctx.strokeStyle = '#e6ddd4'; ctx.beginPath(); ctx.moveTo(24, y + rowHeight - 1); ctx.lineTo(width - 24, y + rowHeight - 1); ctx.stroke()
      })
      wx.canvasToTempFilePath({
        canvas, x: 0, y: 0, width: canvas.width, height: canvas.height,
        destWidth: canvas.width, destHeight: canvas.height, fileType: 'jpg', quality: .92,
        success: (result: any) => saveImageToAlbum(result.tempFilePath),
        fail: () => wx.showToast({ title: '清单生成失败，请重试', icon: 'none' }),
      }, page)
    })
  },
};
