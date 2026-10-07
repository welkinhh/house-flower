import { generateFlowerImageFromScene } from '../../utils/flower-image-ai'
import { aiFailureMessage, logAiFailure } from '../../utils/ai-diagnostics'
import { saveImageToAlbum } from '../../utils/image-album'
import { dayKey, readWorks, saveWork, type WorkRecord } from '../../utils/houseflower-data'
import { getDailyQuota, saveCloudWork } from '../../utils/backend'

function persistImage(path: string, done: (savedPath: string) => void): void {
  if (!path) { done(''); return }
  if (path.indexOf('/assets/') === 0 || path.indexOf('wxfile://store') === 0) { done(path); return }
  const save = (tempPath: string) => wx.saveFile({ tempFilePath: tempPath, success: (result) => done(result.savedFilePath || tempPath), fail: () => done('') })
  if (/^https?:\/\//i.test(path)) wx.downloadFile({ url: path, success: (result) => result.statusCode === 200 ? save(result.tempFilePath) : done(''), fail: () => done('') })
  else save(path)
}

function pointDistance(first: any, second: any): number {
  const dx = Number(first.clientX) - Number(second.clientX)
  const dy = Number(first.clientY) - Number(second.clientY)
  return Math.sqrt(dx * dx + dy * dy)
}

export const sceneActions = {
  downloadSceneImage(this: any) {
    const path = String(this.data.sceneResultPath || '')
    if (!path) return
    saveImageToAlbum(path, '效果图已保存')
  },
  chooseScene(this: any) {
    wx.chooseImage({
      count: 1, sizeType: ['original'], sourceType: ['album', 'camera'],
      success: (result: any) => {
        const path = result.tempFilePaths && result.tempFilePaths[0]
        if (!path) return
        this.setData({ scenePath: path, sceneAssetId: '', selectedSceneId: 'custom', sceneTitle: '自选场景', sceneMessage: '', sceneSaved: false }, () => this.captureSceneRect())
      },
    })
  },
  chooseScenePreset(this: any, event: any) {
    const scene = (this.data.sceneOptions || []).find((item: any) => item.id === String(event.currentTarget.dataset.id))
    if (!scene) return
    this.setData({ scenePath: scene.path, sceneAssetId: '', selectedSceneId: scene.id, sceneTitle: scene.name, sceneMessage: '', sceneSaved: false }, () => this.captureSceneRect())
  },
  chooseBouquet(this: any) {
    wx.chooseImage({
      count: 1, sizeType: ['original'], sourceType: ['album'],
      success: (result: any) => {
        const path = result.tempFilePaths && result.tempFilePaths[0]
        if (!path) return
        this.setData({ sceneBouquetPath: path, sceneBouquetFileID: '', sceneBouquetAssetId: '', sceneBouquetX: 50, sceneBouquetY: 56, sceneSaved: false }, () => { this.updateSceneStyle(); this.captureSceneRect() })
      },
    })
  },
  captureSceneRect(this: any) {
    wx.createSelectorQuery().in(this).select('#scene-board').boundingClientRect((rect: any) => { if (rect) this._sceneRect = rect }).exec()
  },
  updateSceneStyle(this: any) {
    const x = Number(this.data.sceneBouquetX || 50)
    const y = Number(this.data.sceneBouquetY || 56)
    const scale = Number(this.data.sceneScalePercent || 80) / 80
    this.setData({
      sceneBouquetStyle: 'left:' + x + '%;top:' + y + '%;transform:translate(-50%,-50%) scale(' + scale + ');',
      sceneScaleLabel: Math.round(scale * 100) + '%',
    })
  },
  onSceneBouquetTouchStart(this: any, event: any) {
    if (this.data.sceneGenerating) return
    const touches = event.touches || []
    if (!touches.length) return
    const rect = this._sceneRect || { left: 0, top: 0, width: wx.getSystemInfoSync().windowWidth, height: 400 }
    this._sceneGesture = {
      rect,
      x: Number(this.data.sceneBouquetX || 50),
      y: Number(this.data.sceneBouquetY || 56),
      scale: Number(this.data.sceneScalePercent || 80),
      startX: Number(touches[0].clientX),
      startY: Number(touches[0].clientY),
      distance: touches.length > 1 ? pointDistance(touches[0], touches[1]) : 0,
      touchCount: touches.length,
    }
  },
  onSceneBouquetTouchMove(this: any, event: any) {
    if (this.data.sceneGenerating) return
    const touches = event.touches || []
    let gesture = this._sceneGesture
    if (!gesture || !touches.length) return
    if (touches.length > 1 && (gesture.touchCount < 2 || gesture.distance <= 0)) {
      gesture.scale = Number(this.data.sceneScalePercent || 80)
      gesture.distance = pointDistance(touches[0], touches[1])
      gesture.touchCount = 2
      return
    }
    if (touches.length > 1 && gesture.distance > 0) {
      const ratio = pointDistance(touches[0], touches[1]) / gesture.distance
      this.setData({ sceneScalePercent: Math.max(32, Math.min(145, Math.round(gesture.scale * ratio))) }, () => this.updateSceneStyle())
      return
    }
    if (gesture.touchCount > 1) {
      this._sceneGesture = {
        rect: gesture.rect,
        x: Number(this.data.sceneBouquetX || 50), y: Number(this.data.sceneBouquetY || 56),
        scale: Number(this.data.sceneScalePercent || 80),
        startX: Number(touches[0].clientX), startY: Number(touches[0].clientY),
        distance: 0, touchCount: 1,
      }
      return
    }
    const x = Math.max(8, Math.min(92, gesture.x + (Number(touches[0].clientX) - gesture.startX) / gesture.rect.width * 100))
    const y = Math.max(8, Math.min(92, gesture.y + (Number(touches[0].clientY) - gesture.startY) / gesture.rect.height * 100))
    this.setData({ sceneBouquetX: x, sceneBouquetY: y }, () => this.updateSceneStyle())
  },
  onSceneBouquetTouchEnd(this: any, event: any) {
    const touches = event && event.touches || []
    const gesture = this._sceneGesture
    if (touches.length && gesture) {
      this._sceneGesture = {
        rect: gesture.rect,
        x: Number(this.data.sceneBouquetX || 50), y: Number(this.data.sceneBouquetY || 56),
        scale: Number(this.data.sceneScalePercent || 80),
        startX: Number(touches[0].clientX), startY: Number(touches[0].clientY),
        distance: touches.length > 1 ? pointDistance(touches[0], touches[1]) : 0,
        touchCount: touches.length,
      }
      this.setData({ sceneSaved: false })
      return
    }
    this._sceneGesture = null
    this.setData({ sceneSaved: false })
  },
  changeSceneScale(this: any, event: any) {
    if (this.data.sceneGenerating) return
    const value = Math.max(32, Math.min(145, Number(event.detail.value) || 80))
    this.setData({ sceneScalePercent: value, sceneSaved: false }, () => this.updateSceneStyle())
  },
  async composeScene(this: any) {
    if (this.data.sceneGenerating) return
    if (!this.data.scenePath || !this.data.sceneBouquetPath) { wx.showToast({ title: '先上传花束和场景图片', icon: 'none' }); return }
    if (Number(this.data.remainingUses) <= 0) { wx.showToast({ title: '剩余次数不足', icon: 'none' }); return }
    this.setData({
      sceneGenerating: true, generationStageLabel: '正在准备场景…', sceneMessage: '',
      generationProgressMode: 'indeterminate', generationProgressPercent: 0,
      generationProgressLabel: '正在合成场景图片', generationProgressNote: '正在准备花束与空间画面',
      generationProgressFillStyle: '',
    })
    const rect = this._sceneRect || { width: wx.getSystemInfoSync().windowWidth - 32, height: 360 }
    generateFlowerImageFromScene({
      scenePath: String(this.data.scenePath || ''),
      bouquetPath: String(this.data.sceneBouquetPath || ''),
      sceneAssetId: String(this.data.sceneAssetId || ''),
      bouquetAssetId: String(this.data.sceneBouquetAssetId || ''),
      x: Number(this.data.sceneBouquetX || 50),
      y: Number(this.data.sceneBouquetY || 56),
      scale: Number(this.data.sceneScalePercent || 80),
      aspectRatio: Number(rect.width) / Math.max(1, Number(rect.height)),
      prompt: '把叠加的花束自然融入空间，保留原有室内布局和光线。',
      onStage: (stage) => {
        const labels: Record<string, string> = { preparing: '准备场景…', uploading: '正在上传…', generating: '正在融合…' }
        this.setData({ generationStageLabel: labels[stage] || '正在融合…' })
      },
      onProgress: (progress) => this.setData({
        generationProgressMode: progress.mode,
        generationProgressPercent: progress.percent,
        generationProgressLabel: progress.label,
        generationProgressNote: progress.note,
        generationProgressFillStyle: progress.mode === 'determinate' ? 'width:' + progress.percent + '%;' : '',
      }),
    }).then(async (result) => {
        const quota = await getDailyQuota().catch(() => null)
        this.setData({
          mode: 'sceneResult', topCaption: '花映生活',
          sceneResultPath: result.tempFileURL, sceneResultFileID: result.fileID,
          sceneSourceFileID: result.sceneSourceFileID || '', sceneSourceAssetId: result.sceneSourceAssetId || '',
          sceneBouquetFileID: result.sceneBouquetFileID || '', sceneBouquetAssetId: result.sceneBouquetAssetId || '',
          sceneCompositeAssetId: result.sceneCompositeAssetId || result.referenceAssetId,
          sceneResultAssetId: result.resultAssetId, sceneGenerating: false, sceneSaved: false,
          sceneMessage: '', generationStageLabel: '', generationProgressLabel: '', generationProgressNote: '', generationProgressFillStyle: '',
          remainingUses: quota ? quota.remaining : this.data.remainingUses, bonusQuotaRemaining: quota ? quota.bonusRemaining : this.data.bonusQuotaRemaining, quotaReserved: quota ? quota.reserved : 0,
        })
        this.refreshNav()
      }).catch((error: any) => {
        logAiFailure('scene', error, String(error && error.stage || this.data.generationStageLabel || ''))
        const failureMessage = aiFailureMessage(error, '场景融合失败，请重试。')
        void getDailyQuota().then((quota) => this.setData({ remainingUses: quota.remaining, bonusQuotaRemaining: quota.bonusRemaining, quotaReserved: quota.reserved })).catch(() => {})
        this.setData({ sceneGenerating: false, generationStageLabel: '', generationProgressLabel: '', generationProgressNote: '', generationProgressFillStyle: '', sceneMessage: failureMessage })
        const toastMessage = /上传|校验|格式|大小/.test(failureMessage) ? '图片准备失败，请查看页面提示' : '融合未成功，请查看页面提示'
        wx.showToast({ title: toastMessage, icon: 'none' })
      })
  },
  returnToScene(this: any) { this.setMode('scene', '花映生活'); this.captureSceneRect() },
  saveScene(this: any) {
    if (!this.data.sceneResultPath) return
    const page = this
    persistImage(String(this.data.sceneResultPath), (previewPath) => persistImage(String(page.data.scenePath || ''), (sourcePath) => {
      if (!previewPath || !sourcePath) { wx.showToast({ title: '图片未能持久保存，请稍后重试', icon: 'none' }); return }
      const now = Date.now()
      const work: WorkRecord = {
        id: String(now), kind: 'scene', category: 'bouquet', title: String(page.data.sceneTitle || '生活场景') + ' · 花作',
        previewPath, sourcePath, fileID: page.data.sceneResultFileID, previewAssetId: page.data.sceneResultAssetId, sourceAssetId: page.data.sceneSourceAssetId,
        sceneSourceFileID: page.data.sceneSourceFileID, sceneBouquetAssetId: page.data.sceneBouquetAssetId,
        sceneCompositeAssetId: page.data.sceneCompositeAssetId,
        assetIds: [page.data.sceneBouquetAssetId, page.data.sceneCompositeAssetId].filter(Boolean),
        sceneId: page.data.selectedSceneId, sceneBouquetPath: page.data.sceneBouquetPath,
        sceneBouquetX: page.data.sceneBouquetX, sceneBouquetY: page.data.sceneBouquetY,
        sceneBouquetScale: page.data.sceneScalePercent, createdAt: now, dateKey: dayKey(new Date(now)),
        sourceKey: 'scene|' + String(page.data.sceneSourceFileID || page.data.scenePath) + '|' + String(page.data.sceneBouquetFileID || page.data.sceneBouquetPath),
      }
      try {
        const works = saveWork(work)
        page.setData({ works, sceneSaved: true }, () => page.refreshWorks())
        const saved = works.find((item) => item.sourceKey === work.sourceKey) || work
        const sync = page.data.backendReady ? saveCloudWork({
          kind: work.kind, title: work.title, sourceKey: work.sourceKey,
          previewAssetId: work.previewAssetId, sourceAssetId: work.sourceAssetId,
          assetIds: work.assetIds,
          metadata: { createdAt: work.createdAt, fileID: work.fileID, sceneId: work.sceneId, sceneBouquetX: work.sceneBouquetX, sceneBouquetY: work.sceneBouquetY, sceneBouquetScale: work.sceneBouquetScale, sceneBouquetAssetId: work.sceneBouquetAssetId, sceneCompositeAssetId: work.sceneCompositeAssetId },
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
      } catch { wx.showToast({ title: '保存失败，请重试', icon: 'none' }) }
    }))
  },
};
