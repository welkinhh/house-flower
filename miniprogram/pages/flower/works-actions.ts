import { EDITORIAL_ASSETS } from '../../data/editorial-assets'
import { PROFILE_KEY, WORKS_KEY, DEFAULT_WORK_CATEGORY, PORTFOLIO_CATEGORIES, PORTFOLIO_CATEGORY_LABEL, dayKey, readWorks, saveWork, type WorkRecord } from '../../utils/houseflower-data'
import { completeBackendUpload, deleteCloudWork, prepareBackendUpload, requestAccountDeletion, saveCloudWork, updateRemoteProfile } from '../../utils/backend'

function uploadLocalAsset(path: string, purpose = 'work-cover'): Promise<string> {
  return new Promise((resolve) => {
    if (!path || path.indexOf('/assets/') === 0 || path.indexOf('http') === 0) { resolve(''); return }
    wx.getImageInfo({
      src: path,
      success: async (info) => {
        const type = String(info.type || '').toLowerCase()
        const extension = type === 'png' ? 'png' : 'jpg'
        try {
          const prepared = await prepareBackendUpload(purpose, extension)
          const uploaded = await wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath: path })
          if (!uploaded.fileID) { resolve(''); return }
          await completeBackendUpload(prepared.assetId, uploaded.fileID)
          resolve(prepared.assetId)
        } catch { resolve('') }
      },
      fail: () => resolve(''),
    })
  })
}

function persistImage(path: string, done: (savedPath: string) => void): void {
  if (!path) { done(''); return }
  if (path.indexOf('/assets/') === 0 || path.indexOf('wxfile://store') === 0) { done(path); return }
  const save = (tempPath: string) => wx.saveFile({ tempFilePath: tempPath, success: (result) => done(result.savedFilePath || tempPath), fail: () => done('') })
  if (/^https?:\/\//i.test(path)) wx.downloadFile({ url: path, success: (result) => result.statusCode === 200 ? save(result.tempFilePath) : done(''), fail: () => done('') })
  else save(path)
}

function editorialPathsForWork(work: WorkRecord): { previewPath: string; sourcePath: string } | null {
  const sourceKey = String(work.sourceKey || '')
  if (!sourceKey.startsWith('inspiration-gallery|')) return null
  const caseId = sourceKey.slice('inspiration-gallery|'.length) as keyof typeof EDITORIAL_ASSETS.inspirationCases
  const assets = EDITORIAL_ASSETS.inspirationCases[caseId]
  return assets ? { previewPath: assets.flower, sourcePath: assets.reference } : null
}

export const worksActions = {
  async syncLocalWorks(this: any) {
    const source = readWorks().filter((work) => !String(work.id).startsWith('demo-') && (!work.cloudWorkId || work.cloudSyncPending))
    if (!source.length) { wx.showToast({ title: '没有待同步的本机作品', icon: 'none' }); return }
    let syncedCount = 0
    let failedCount = 0
    const next = readWorks().slice()
    for (const work of source) {
      try {
        const previewPath = String(work.previewPath || '')
        const sourcePath = String(work.sourcePath || '')
        const isBundleAsset = (path: string) => path.startsWith('/assets/')
        const editorialPaths = editorialPathsForWork(work)
        const isEditorialCase = Boolean(editorialPaths)
        let previewAssetId = String(work.previewAssetId || '') || (work.kind === 'materials' ? String(work.sourceAssetId || '') : '')
        let sourceAssetId = String(work.sourceAssetId || '')
        if (!isEditorialCase && !previewAssetId && previewPath && !isBundleAsset(previewPath)) previewAssetId = await uploadLocalAsset(previewPath)
        if (!isEditorialCase && !sourceAssetId && sourcePath && !isBundleAsset(sourcePath)) sourceAssetId = await uploadLocalAsset(sourcePath)
        if (!isEditorialCase && previewPath && !isBundleAsset(previewPath) && !previewAssetId) throw new Error('封面图片上传失败。')
        if (!isEditorialCase && sourcePath && !isBundleAsset(sourcePath) && !sourceAssetId) throw new Error('原始图片上传失败。')
        const remote = await saveCloudWork({
          id: work.cloudWorkId,
          expectedRevision: work.cloudRevision,
          kind: work.kind, title: work.title, sourceKey: work.sourceKey,
          previewAssetId, sourceAssetId, assetIds: work.assetIds || [], rows: work.rows,
          metadata: { createdAt: work.createdAt, previewPath: isEditorialCase ? editorialPaths!.previewPath : previewAssetId ? '' : work.previewPath, sourcePath: isEditorialCase ? editorialPaths!.sourcePath : sourceAssetId ? '' : work.sourcePath, note: work.note, notes: work.notes, status: work.status, sceneBouquetAssetId: work.sceneBouquetAssetId, sceneCompositeAssetId: work.sceneCompositeAssetId },
        })
        const index = next.findIndex((item) => item.id === work.id)
        if (index >= 0) next[index] = { ...next[index], cloudWorkId: remote.workId, cloudRevision: remote.revision, previewAssetId, sourceAssetId, cloudSyncPending: false }
        syncedCount += 1
      } catch {
        const index = next.findIndex((item) => item.id === work.id)
        if (index >= 0) next[index] = { ...next[index], cloudSyncPending: true }
        failedCount += 1
      }
    }
    wx.setStorageSync(WORKS_KEY, next)
    this.setData({ works: next }, () => this.refreshWorks())
    if (syncedCount) void this.syncCloudData()
    wx.showToast({
      title: failedCount ? `已同步 ${syncedCount} 件，${failedCount} 件待重试` : `已同步 ${syncedCount} 件作品`,
      icon: failedCount ? 'none' : 'success',
    })
  },
  async startUploadWork(this: any) {
    if (!this.data.isAdmin) { wx.showToast({ title: '仅店铺管理员可上传作品', icon: 'none' }); return }
    const page = this
    wx.chooseImage({
      count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: async (result: any) => {
        const path = result.tempFilePaths && result.tempFilePaths[0]
        if (!path) return
        const now = Date.now()
        const work: WorkRecord = {
          id: String(now), kind: 'bouquet', category: DEFAULT_WORK_CATEGORY,
          title: '店铺作品', previewPath: path, sourcePath: path,
          createdAt: now, dateKey: dayKey(new Date(now)), sourceKey: 'upload|' + now,
        }
        try {
          const works = saveWork(work)
          page.setData({ works }, () => page.refreshWorks())
          const assetId = await uploadLocalAsset(path, 'work-cover').catch(() => '')
          const remote = page.data.backendReady
            ? await saveCloudWork({
              kind: work.kind, title: work.title, sourceKey: work.sourceKey,
              previewAssetId: assetId, metadata: { createdAt: work.createdAt, category: work.category },
            }).catch(() => null)
            : null
          if (remote) {
            const synced = readWorks().map((item: WorkRecord) => item.id === work.id
              ? { ...item, cloudWorkId: remote.workId, cloudRevision: remote.revision, previewAssetId: assetId, cloudSyncPending: false }
              : item)
            wx.setStorageSync(WORKS_KEY, synced)
            page.setData({ works: synced }, () => page.refreshWorks())
          }
          wx.showToast({ title: '已添加到作品集', icon: 'success' })
        } catch { wx.showToast({ title: '添加失败，请重试', icon: 'none' }) }
      },
    })
  },
  changeWorksFilter(this: any, event: any) {
    this.setData({ worksFilter: String(event.currentTarget.dataset.id || 'all'), selectedWorkIds: [] }, () => this.refreshWorks())
  },
  toggleWorkSelectionMode(this: any) {
    const selectingWorks = !this.data.selectingWorks
    this.setData({ selectingWorks, selectedWorkIds: [] }, () => this.refreshWorks())
  },
  toggleSelectAllWorks(this: any) {
    const visible = this.data.visibleWorks || []
    const allIds = visible.map((work: WorkRecord) => work.id)
    const selectedWorkIds = allIds.length && this.data.selectedWorkIds.length === allIds.length ? [] : allIds
    this.setData({ selectedWorkIds }, () => this.refreshWorks())
  },
  deleteSelectedWorks(this: any) {
    const ids: string[] = (this.data.selectedWorkIds || []).slice()
    if (!ids.length) return
    wx.showModal({
      title: '删除选中的作品？',
      content: '共 ' + ids.length + ' 件作品；删除后无法恢复。',
      success: async (result) => {
        if (!result.confirm) return
        const before = readWorks()
        const removed = new Set<string>()
        let deleteFailed = false
        for (const work of before.filter((item) => ids.includes(item.id))) {
          if (work.cloudWorkId || (work.sourceKey && this.data.backendReady)) {
            try { await deleteCloudWork(String(work.cloudWorkId || ''), String(work.sourceKey || '')) }
            catch { deleteFailed = true; continue }
          }
          removed.add(work.id)
        }
        const works = before.filter((work) => !removed.has(work.id))
        wx.setStorageSync(WORKS_KEY, works)
        this.setData({ works, selectingWorks: false, selectedWorkIds: [] }, () => this.refreshWorks())
        if (deleteFailed) wx.showToast({ title: '部分作品未能同步删除，请重试', icon: 'none' })
      },
    })
  },
  openWork(this: any, event: any) {
    const list = this.data.mode === 'portfolio' ? (this.data.portfolioItems || []) : (this.data.visibleWorks || [])
    const work = list[Number(event.currentTarget.dataset.index)]
    if (!work) return
    if (this.data.selectingWorks) {
      const ids: string[] = (this.data.selectedWorkIds || []).slice()
      const index = ids.indexOf(work.id)
      if (index >= 0) ids.splice(index, 1)
      else ids.push(work.id)
      this.setData({ selectedWorkIds: ids }, () => this.refreshWorks())
      return
    }
    const sourcePath = work.sourcePath || ''
    this.setData({ currentWork: {
      ...work,
      categoryLabel: PORTFOLIO_CATEGORY_LABEL[work.category || 'bouquet'] || '花束',
      rows: work.rows ? JSON.parse(JSON.stringify(work.rows)) : [],
      showSource: Boolean(sourcePath && sourcePath !== work.previewPath),
      note: String(work.note || ''), noteLength: String(work.note || '').length,
    }, showWorkImageViewer: false })
    this.setMode('workDetail', work.title)
  },
  updateWorkNote(this: any, event: any) {
    const current = this.data.currentWork
    if (!current) return
    const note = String(event.detail.value || '').slice(0, 100)
    this.setData({ currentWork: { ...current, note, noteLength: note.length } })
  },
  async saveWorkNote(this: any) {
    const current: WorkRecord | null = this.data.currentWork
    if (!current) return
    const updated: WorkRecord = { ...current, note: String(current.note || '').slice(0, 100), noteLength: String(current.note || '').slice(0, 100).length }
    const local = readWorks().map((item) => item.id === updated.id ? updated : item)
    wx.setStorageSync(WORKS_KEY, local)
    this.setData({ works: local, currentWork: updated })
    if (!this.data.backendReady || !updated.sourceKey || String(updated.id).startsWith('demo-')) return
    try {
      const remote = await saveCloudWork({
        id: updated.cloudWorkId, expectedRevision: updated.cloudRevision,
        kind: updated.kind, title: updated.title, sourceKey: updated.sourceKey,
        previewAssetId: updated.previewAssetId, sourceAssetId: updated.sourceAssetId, rows: updated.rows,
        metadata: { createdAt: updated.createdAt, note: updated.note, notes: updated.notes, status: updated.status },
      })
      const synced = readWorks().map((item) => item.id === updated.id
        ? { ...item, cloudWorkId: remote.workId, cloudRevision: remote.revision, cloudSyncPending: false }
        : item)
      wx.setStorageSync(WORKS_KEY, synced)
      this.setData({ works: synced, currentWork: { ...updated, cloudWorkId: remote.workId, cloudRevision: remote.revision, cloudSyncPending: false } })
    } catch {
      const pending = readWorks().map((item) => item.id === updated.id ? { ...item, cloudSyncPending: true } : item)
      wx.setStorageSync(WORKS_KEY, pending)
      this.setData({ works: pending, currentWork: { ...updated, cloudSyncPending: true } })
    }
  },
  setWorkCategory(this: any, category: string) {
    const current: WorkRecord | null = this.data.currentWork
    if (!current) return
    const updated: WorkRecord = { ...current, category: String(category || DEFAULT_WORK_CATEGORY) }
    const local = readWorks().map((item) => item.id === updated.id ? updated : item)
    wx.setStorageSync(WORKS_KEY, local)
    this.setData({ works: local, currentWork: updated })
    this.refreshWorks()
    wx.showToast({ title: '分类已更新', icon: 'success' })
  },
  workMore(this: any, event: any) {
    const index = event && event.currentTarget && event.currentTarget.dataset ? Number(event.currentTarget.dataset.index) : -1
    const list = this.data.mode === 'portfolio' ? (this.data.portfolioItems || []) : (this.data.visibleWorks || [])
    const work: WorkRecord | null = index >= 0 ? list[index] : this.data.currentWork
    if (!work) return
    const page = this
    const isOwner = this.data.isAdmin
    const items = isOwner ? ['重命名', '改分类', '删除'] : ['重命名', '删除']
    wx.showActionSheet({
      itemList: items,
      success: (result) => {
        if (result.tapIndex === 0) {
          wx.showModal({
            title: '重命名作品', content: '', editable: true, placeholderText: work.title,
            success: async (modal: any) => {
              const title = String(modal.content || '').trim()
              if (!modal.confirm || !title) return
              const works = readWorks().map((item) => item.id === work.id ? { ...item, title } : item)
              wx.setStorageSync(WORKS_KEY, works)
              page.setData({ works, currentWork: page.data.currentWork ? { ...page.data.currentWork, title } : null })
              page.refreshWorks()
              if (page.data.mode === 'workDetail') page.setData({ topCaption: title })
              if (work.cloudWorkId || (work.sourceKey && page.data.backendReady)) {
                try {
                  const remote = await saveCloudWork({ id: work.cloudWorkId, expectedRevision: work.cloudRevision, kind: work.kind, title, sourceKey: work.sourceKey, previewAssetId: work.previewAssetId, sourceAssetId: work.sourceAssetId, rows: work.rows })
                  const synced = readWorks().map((item) => item.id === work.id ? { ...item, cloudWorkId: remote.workId, cloudRevision: remote.revision, cloudSyncPending: false } : item)
                  wx.setStorageSync(WORKS_KEY, synced)
                  page.setData({ works: synced })
                } catch {
                  const pending = readWorks().map((item) => item.id === work.id ? { ...item, cloudSyncPending: true } : item)
                  wx.setStorageSync(WORKS_KEY, pending)
                  page.setData({ works: pending })
                  wx.showToast({ title: '本机已重命名，云端同步失败', icon: 'none' })
                }
              }
            },
          })
          return
        }
        if (isOwner && result.tapIndex === 1) {
          const options = PORTFOLIO_CATEGORIES.filter((item) => item.id !== 'all')
          wx.showActionSheet({
            itemList: options.map((item) => item.label),
            success: (sheet) => {
              const picked = options[sheet.tapIndex]
              if (!picked) return
              if (page.data.mode !== 'workDetail' || !page.data.currentWork || page.data.currentWork.id !== work.id) {
                page.setData({ currentWork: { ...work, category: picked.id } })
              }
              page.setWorkCategory(picked.id)
            },
          })
          return
        }
        wx.showModal({
          title: '删除这件作品？', content: '删除后，作品图片会一并移除。',
          success: async (modal) => {
            if (!modal.confirm) return
            if (work.cloudWorkId || (work.sourceKey && page.data.backendReady)) {
              try { await deleteCloudWork(String(work.cloudWorkId || ''), String(work.sourceKey || '')) }
              catch { wx.showToast({ title: '云端删除失败，请检查网络后重试', icon: 'none' }); return }
            }
            const works = readWorks().filter((item) => item.id !== work.id)
            wx.setStorageSync(WORKS_KEY, works)
            page.setData({ works, currentWork: null, mode: 'portfolio', topCaption: '作品集' }, () => page.refreshWorks())
          },
        })
      },
    })
  },
  openSettings(this: any) { this.setMode('settings', '设置') },
  openPrivacyGuide(this: any) {
    const wxApi = wx as any
    const openPrivacyContract = wxApi.openPrivacyContract
    if (typeof openPrivacyContract !== 'function') {
      wx.showToast({ title: '完整指引暂不可用，请稍后再试', icon: 'none' })
      return
    }
    openPrivacyContract({
      fail: () => wx.showToast({ title: '完整指引暂不可用，请稍后再试', icon: 'none' }),
    })
  },
  workLongPress(this: any, event: any) {
    const list = this.data.mode === 'portfolio' ? (this.data.portfolioItems || []) : (this.data.visibleWorks || [])
    const work = list[Number(event.currentTarget.dataset.index)]
    if (!work || this.data.selectingWorks) return
    this.setData({ selectingWorks: true, selectedWorkIds: [work.id] }, () => this.refreshWorks())
    try { wx.vibrateShort({ type: 'light' }) } catch {}
  },
  chooseAvatar(this: any) {
    wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: (result: any) => {
      const path = result.tempFilePaths && result.tempFilePaths[0]
      if (path) this.setData({ 'userProfile.avatarUrl': path })
    } })
  },
  updateProfileName(this: any, event: any) { this.setData({ 'userProfile.name': String(event.detail.value || '') }) },
  saveProfile(this: any) {
    const page = this
    persistImage(String(this.data.userProfile.avatarUrl || ''), (avatarUrl) => {
      if (!avatarUrl) { wx.showToast({ title: '头像保存失败，请重试', icon: 'none' }); return }
      const profile = { ...page.data.userProfile, avatarUrl }
      uploadLocalAsset(avatarUrl, 'avatar').then((avatarAssetId) => updateRemoteProfile(String(profile.name || '花生用户'), avatarAssetId || String(profile.avatarAssetId || ''))).then((remote) => {
        const savedProfile = { ...profile, name: remote.nickname, avatarAssetId: remote.avatarAssetId }
        try { wx.setStorageSync(PROFILE_KEY, savedProfile) } catch {}
        page.setData({ userProfile: savedProfile }, () => wx.showToast({ title: '已保存', icon: 'success' }))
      }).catch(() => {
        try { wx.setStorageSync(PROFILE_KEY, profile) } catch {}
        page.setData({ userProfile: profile }, () => wx.showToast({ title: '已保存在本机，云端稍后同步', icon: 'none' }))
      })
    })
  },
  deleteAccount(this: any) {
    const page = this
    wx.showModal({
      title: '申请删除账号？',
      content: '云端作品、图片和 AI 任务会进入删除流程，操作不可恢复。',
      confirmText: '确认删除',
      success: (result) => {
        if (!result.confirm) return
        requestAccountDeletion().then(() => {
          ;[WORKS_KEY, PROFILE_KEY, 'houseflower.remainingUses'].forEach((key) => { try { wx.removeStorageSync(key) } catch {} })
          page.setData({ mode: 'home', works: [], visibleWorks: [], userProfile: { name: '花生用户', avatarUrl: '' }, backendReady: false })
          wx.showToast({ title: '已提交删除申请', icon: 'success' })
        }).catch((error: any) => wx.showToast({ title: error && error.message ? error.message : '申请失败，请稍后重试', icon: 'none' }))
      },
    })
  },
};
