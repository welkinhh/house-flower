import { DATES_KEY, PROFILE_KEY, WORKS_KEY, buildCalendar, dateFromKey, dayKey, formatDateLabel, kindLabel, readDates, readWorks, saveWork, type ImportantDate, type WorkRecord } from '../../utils/houseflower-data'
import { completeBackendUpload, deleteCloudDate, deleteCloudWork, prepareBackendUpload, requestAccountDeletion, saveCloudDate, saveCloudWork, saveSubscription, updateRemoteProfile } from '../../utils/backend'

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
        let previewAssetId = String(work.previewAssetId || '') || (work.kind === 'materials' ? String(work.sourceAssetId || '') : '')
        let sourceAssetId = String(work.sourceAssetId || '')
        if (!previewAssetId && previewPath && !isBundleAsset(previewPath)) previewAssetId = await uploadLocalAsset(previewPath)
        if (!sourceAssetId && sourcePath && !isBundleAsset(sourcePath)) sourceAssetId = await uploadLocalAsset(sourcePath)
        if (previewPath && !isBundleAsset(previewPath) && !previewAssetId) throw new Error('封面图片上传失败。')
        if (sourcePath && !isBundleAsset(sourcePath) && !sourceAssetId) throw new Error('原始图片上传失败。')
        const remote = await saveCloudWork({
          id: work.cloudWorkId,
          expectedRevision: work.cloudRevision,
          kind: work.kind, title: work.title, sourceKey: work.sourceKey,
          previewAssetId, sourceAssetId, assetIds: work.assetIds || [], rows: work.rows,
          metadata: { createdAt: work.createdAt, previewPath: previewAssetId ? '' : work.previewPath, sourcePath: sourceAssetId ? '' : work.sourcePath, note: work.note, notes: work.notes, status: work.status, sceneBouquetAssetId: work.sceneBouquetAssetId, sceneCompositeAssetId: work.sceneCompositeAssetId },
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
  async saveInspirationToWorks(this: any) {
    const item = this.data.selectedInspiration
    if (!item || !item.resultPath) return
    const now = Date.now()
    const record: WorkRecord = {
      id: String(now), kind: 'bouquet', title: String(item.title || '灵感花作'),
      previewPath: String(item.resultPath), sourcePath: String(item.sourcePath || item.path || ''),
      createdAt: now, dateKey: dayKey(new Date(now)),
      sourceKey: 'inspiration-gallery|' + String(item.id),
    }
    try {
      const works = saveWork(record)
      this.setData({
        works,
        selectedInspiration: { ...item, saved: true },
      })
      this.refreshWorks()
      const saved = works.find((work) => work.sourceKey === record.sourceKey) || record
      try {
        const remote = await saveCloudWork({ kind: record.kind, title: record.title, sourceKey: record.sourceKey, metadata: { previewPath: record.previewPath, sourcePath: record.sourcePath, createdAt: record.createdAt } })
        const synced = readWorks().map((work) => work.id === saved.id ? { ...work, cloudWorkId: remote.workId, cloudRevision: remote.revision, cloudSyncPending: false } : work)
        wx.setStorageSync(WORKS_KEY, synced)
        this.setData({ works: synced })
        wx.showToast({ title: '已保存到作品集', icon: 'success' })
      } catch {
        const pending = readWorks().map((work) => work.id === saved.id ? { ...work, cloudSyncPending: true } : work)
        wx.setStorageSync(WORKS_KEY, pending)
        this.setData({ works: pending })
        wx.showToast({ title: '已保存到本机，云端同步待重试', icon: 'none' })
      }
    } catch { wx.showToast({ title: '保存失败，请重试', icon: 'none' }) }
  },
  changeWorksFilter(this: any, event: any) {
    this.setData({ worksFilter: String(event.currentTarget.dataset.id || 'all'), selectedWorkIds: [] }, () => this.refreshWorks())
  },
  // 作品页顶部下划线 tab：作品集 / 花历
  async selectWorksTab(this: any, event: any) {
    const id = String(event.currentTarget.dataset.id || 'collection')
    if (id === 'calendar') {
      this.setData({ worksView: 'calendar', selectingWorks: false, selectedWorkIds: [] }, () => this.refreshCalendar())
      let pages = 0
      while (this.data.cloudWorksHasMore && pages < 100) {
        const loaded = await this.loadMoreWorks()
        if (!loaded) break
        pages += 1
      }
      return
    }
    this.setData({ worksView: 'collection', worksFilter: 'all', selectedWorkIds: [] }, () => this.refreshWorks())
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
        const dates = readDates().map((item) => removed.has(item.workId) ? { ...item, workId: '' } : item)
        wx.setStorageSync(WORKS_KEY, works)
        wx.setStorageSync(DATES_KEY, dates)
        this.setData({ works, importantDates: dates, selectingWorks: false, selectedWorkIds: [] }, () => this.refreshWorks())
        if (deleteFailed) wx.showToast({ title: '部分作品未能同步删除，请重试', icon: 'none' })
      },
    })
  },
  switchWorksView(this: any, event: any) {
    const view = String(event.currentTarget.dataset.id || 'collection')
    this.setData({ worksView: view })
    if (view === 'calendar') this.refreshCalendar()
    else this.refreshWorks()
  },
  openWork(this: any, event: any) {
    const work = this.data.visibleWorks[Number(event.currentTarget.dataset.index)]
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
      ...work, rows: work.rows ? JSON.parse(JSON.stringify(work.rows)) : [],
      showSource: Boolean(sourcePath && sourcePath !== work.previewPath),
      note: String(work.note || ''), noteLength: String(work.note || '').length,
    }, showWorkImageViewer: false })
    this.setMode('workDetail', work.title)
  },
  openCalendarWork(this: any, event: any) {
    const work = (this.data.visibleWorks || []).find((item: WorkRecord) => item.id === String(event.currentTarget.dataset.id))
    if (!work) return
    const sourcePath = work.sourcePath || ''
    this.setData({ currentWork: {
      ...work, rows: work.rows ? JSON.parse(JSON.stringify(work.rows)) : [],
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
  workMore(this: any, event: any) {
    const index = event && event.currentTarget && event.currentTarget.dataset ? Number(event.currentTarget.dataset.index) : -1
    const work: WorkRecord | null = index >= 0 ? this.data.visibleWorks[index] : this.data.currentWork
    if (!work) return
    const page = this
    wx.showActionSheet({
      itemList: ['重命名', '删除'],
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
        wx.showModal({
          title: '删除这件作品？', content: '删除后，作品图片和花历记录会一并移除。',
          success: async (modal) => {
            if (!modal.confirm) return
            if (work.cloudWorkId || (work.sourceKey && page.data.backendReady)) {
              try { await deleteCloudWork(String(work.cloudWorkId || ''), String(work.sourceKey || '')) }
              catch { wx.showToast({ title: '云端删除失败，请检查网络后重试', icon: 'none' }); return }
            }
            const works = readWorks().filter((item) => item.id !== work.id)
            const dates = readDates().map((item) => item.workId === work.id ? { ...item, workId: '' } : item)
            wx.setStorageSync(WORKS_KEY, works)
            wx.setStorageSync(DATES_KEY, dates)
            page.setData({ works, importantDates: dates, currentWork: null, mode: 'works', topCaption: '作品' }, () => page.refreshWorks())
          },
        })
      },
    })
  },
  previousMonth(this: any) { this.moveCalendarMonth(-1) },
  nextMonth(this: any) { this.moveCalendarMonth(1) },
  showCalendarPicker(this: any) {
    const nowYear = new Date().getFullYear()
    const yearsInWorks = (this.data.works || []).filter((work: WorkRecord) => work.kind !== 'materials').map((work: WorkRecord) => new Date(work.createdAt).getFullYear()).filter((year: number) => Number.isFinite(year))
    const yearsInEvents = (this.data.importantDates || []).map((item: ImportantDate) => Number(String(item.date).slice(0, 4))).filter((year: number) => Number.isFinite(year))
    const firstYear = Math.min(nowYear - 10, ...(yearsInWorks.concat(yearsInEvents)))
    const selectedYear = Number(String(this.data.calendarMonth).slice(0, 4)) || nowYear
    const lastYear = Math.max(nowYear + 10, selectedYear)
    const calendarYears: number[] = []
    for (let year = Math.max(1900, firstYear); year <= lastYear; year += 1) calendarYears.push(year)
    const yearIndex = Math.max(0, calendarYears.indexOf(selectedYear))
    const monthNumber = Number(String(this.data.calendarMonth).slice(5, 7)) || 1
    this.setData({
      calendarYears,
      calendarMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      calendarPickerValue: [yearIndex, monthNumber - 1],
      showCalendarPicker: true,
    })
  },
  changeCalendarPicker(this: any, event: any) {
    const value = event.detail.value || []
    this.setData({ calendarPickerValue: [Number(value[0] || 0), Number(value[1] || 0)] })
  },
  cancelCalendarPicker(this: any) { this.setData({ showCalendarPicker: false }) },
  confirmCalendarPicker(this: any) {
    const years: number[] = this.data.calendarYears || []
    const months: number[] = this.data.calendarMonths || []
    const value = this.data.calendarPickerValue || [0, 0]
    const year = years[Number(value[0])] || new Date().getFullYear()
    const month = months[Number(value[1])] || 1
    const selectedParts = String(this.data.selectedDate || dayKey(new Date())).split('-').map(Number)
    const requestedDay = selectedParts[2] || 1
    const lastDay = new Date(year, month, 0).getDate()
    const selectedDate = year + '-' + String(month).padStart(2, '0') + '-' + String(Math.min(requestedDay, lastDay)).padStart(2, '0')
    this.setData({
      calendarMonth: year + '-' + String(month).padStart(2, '0'),
      selectedDate,
      showCalendarPicker: false,
    }, () => this.refreshCalendar())
  },
  moveCalendarMonth(this: any, delta: number) {
    const parts = String(this.data.calendarMonth || dayKey(new Date()).slice(0, 7)).split('-').map(Number)
    const date = new Date(parts[0], parts[1] - 1 + delta, 1)
    this.setData({ calendarMonth: date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') }, () => this.refreshCalendar())
  },
  selectCalendarDate(this: any, event: any) {
    this.setData({ selectedDate: String(event.currentTarget.dataset.date || dayKey(new Date())) }, () => this.refreshCalendar())
  },
  addImportantDate(this: any) { this.openEventEditor(null) },
  editImportantDate(this: any, event: any) {
    const item = (this.data.importantDates || []).find((date: ImportantDate) => date.id === String(event.currentTarget.dataset.id))
    if (item) this.openEventEditor(item)
  },
  openEventEditor(this: any, event: ImportantDate | null) {
    const works = (this.data.works || []).filter((work: WorkRecord) => work.kind !== 'materials')
    const labels = ['不关联'].concat(works.map((work: WorkRecord) => work.title))
    const ids = [''].concat(works.map((work: WorkRecord) => work.id))
    const workId = event ? event.workId : ''
    this.setData({
      showEventEditor: true, editingEventId: event ? event.id : '',
      eventTitle: event ? event.title : '',
      eventDate: event ? event.date : (this.data.selectedDate || dayKey(new Date())),
      eventNote: event ? event.note : '',
      eventRepeats: event ? event.repeatYearly : false,
      eventWorkId: workId, eventWorkIndex: Math.max(0, ids.indexOf(workId)),
      eventWorkLabels: labels, eventWorkIds: ids,
    })
  },
  closeEventEditor(this: any) { this.setData({ showEventEditor: false }) },
  updateEventTitle(this: any, event: any) { this.setData({ eventTitle: String(event.detail.value || '') }) },
  updateEventDate(this: any, event: any) { this.setData({ eventDate: String(event.detail.value || '') }) },
  updateEventNote(this: any, event: any) { this.setData({ eventNote: String(event.detail.value || '') }) },
  toggleEventRepeat(this: any, event: any) { this.setData({ eventRepeats: Boolean(event.detail.value) }) },
  chooseEventWork(this: any, event: any) {
    const index = Number(event.detail.value || 0)
    this.setData({ eventWorkIndex: index, eventWorkId: this.data.eventWorkIds[index] || '' })
  },
  requestDateSubscription(this: any) {
    const templateId = String(this.data.subscriptionTemplates && this.data.subscriptionTemplates.date || '')
    if (!templateId) { wx.showToast({ title: '提醒模板尚未配置', icon: 'none' }); return }
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (result) => {
        saveSubscription(result as Record<string, string>).then(() => wx.showToast({ title: '订阅结果已保存', icon: 'success' })).catch(() => wx.showToast({ title: '订阅状态保存失败', icon: 'none' }))
      },
      fail: () => wx.showToast({ title: '订阅请求未完成', icon: 'none' }),
    })
  },
  saveImportantDate(this: any) {
    const title = String(this.data.eventTitle || '').trim()
    const date = String(this.data.eventDate || '').trim()
    if (!title) { wx.showToast({ title: '请填写日子名称', icon: 'none' }); return }
    if (!dateFromKey(date)) { wx.showToast({ title: '日期格式为 YYYY-MM-DD', icon: 'none' }); return }
    const linkedWork = (this.data.works || []).find((work: WorkRecord) => work.id === this.data.eventWorkId)
    const item: ImportantDate = {
      id: this.data.editingEventId || String(Date.now()), title, date,
      note: String(this.data.eventNote || '').trim(), repeatYearly: Boolean(this.data.eventRepeats),
      workId: String(this.data.eventWorkId || ''),
      cloudDateId: this.data.editingEventId ? ((this.data.importantDates || []).find((entry: ImportantDate) => entry.id === this.data.editingEventId) || {}).cloudDateId : '',
      cloudSyncPending: !this.data.backendReady || Boolean(linkedWork && !linkedWork.cloudWorkId),
    }
    const dates = [item, ...readDates().filter((entry) => entry.id !== item.id)]
    wx.setStorageSync(DATES_KEY, dates)
    this.setData({ importantDates: dates, showEventEditor: false }, () => this.refreshCalendar())
    const remoteDate = { ...item, id: item.cloudDateId || item.id, workId: linkedWork ? String(linkedWork.cloudWorkId || '') : '' }
    if (!item.cloudSyncPending) void saveCloudDate(remoteDate).then((remote) => {
      const synced = readDates().map((entry) => entry.id === item.id ? { ...entry, cloudDateId: remote.id } : entry)
      wx.setStorageSync(DATES_KEY, synced)
      this.setData({ importantDates: synced })
      wx.showToast({ title: '日子已同步', icon: 'success' })
    }).catch(() => {
      const pending = readDates().map((entry) => entry.id === item.id ? { ...entry, cloudSyncPending: true } : entry)
      wx.setStorageSync(DATES_KEY, pending)
      this.setData({ importantDates: pending })
      wx.showToast({ title: '本机已保存，云端同步待重试', icon: 'none' })
    })
    else wx.showToast({ title: '本机已保存，关联作品同步后会上传日子', icon: 'none' })
  },
  deleteImportantDate(this: any) {
    const id = String(this.data.editingEventId || '')
    wx.showModal({ title: '删除这个日子？', success: async (result) => {
      if (!result.confirm) return
      const before = readDates()
      const cloudDate = before.find((item: any) => item.id === id && item.cloudDateId)
      if (cloudDate || (this.data.backendReady && id)) {
        const targetDateId = String(cloudDate && cloudDate.cloudDateId || id)
        try { await deleteCloudDate(targetDateId) }
        catch { wx.showToast({ title: '云端删除失败，请检查网络后重试', icon: 'none' }); return }
      }
      const dates = before.filter((item) => item.id !== id)
      wx.setStorageSync(DATES_KEY, dates)
      this.setData({ importantDates: dates, showEventEditor: false }, () => this.refreshCalendar())
    } })
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
    const work = (this.data.visibleWorks || [])[Number(event.currentTarget.dataset.index)]
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
      content: '云端作品、图片、花历和 AI 任务会进入删除流程，操作不可恢复。',
      confirmText: '确认删除',
      success: (result) => {
        if (!result.confirm) return
        requestAccountDeletion().then(() => {
          ;[WORKS_KEY, DATES_KEY, PROFILE_KEY, 'houseflower.remainingUses'].forEach((key) => { try { wx.removeStorageSync(key) } catch {} })
          page.setData({ mode: 'home', works: [], visibleWorks: [], importantDates: [], userProfile: { name: '花生用户', avatarUrl: '' }, backendReady: false })
          wx.showToast({ title: '已提交删除申请', icon: 'success' })
        }).catch((error: any) => wx.showToast({ title: error && error.message ? error.message : '申请失败，请稍后重试', icon: 'none' }))
      },
    })
  },
  refreshCalendar(this: any) {
    // 花历是作品集的日期看板，始终从同一批可见花作生成格子和当天列表。
    const boardWorks: WorkRecord[] = (this.data.works || []).filter((work: WorkRecord) => work.kind !== 'materials')
    const data = buildCalendar(
      this.data.calendarMonth,
      boardWorks,
      this.data.importantDates || [],
      this.data.selectedDate || dayKey(new Date()),
    )
    data.selectedDateWorks = (data.selectedDateWorks || []).map((work: WorkRecord) => ({
      ...work, kindLabel: kindLabel(work.kind), dateLabel: formatDateLabel(work.createdAt),
    }))
    const parts = String(this.data.selectedDate || dayKey(new Date())).split('-')
    data.selectedDateLabel = Number(parts[1]) + ' 月 ' + Number(parts[2]) + ' 日的作品'
    const selectedKey = String(this.data.selectedDate || dayKey(new Date()))
    const selectedDateParts = selectedKey.split('-')
    data.selectedDateEvents = (this.data.importantDates || []).filter((event: ImportantDate) => {
      if (event.date === selectedKey) return true
      if (!event.repeatYearly) return false
      const eventParts = String(event.date || '').split('-')
      return eventParts.length === 3 && eventParts[1] === selectedDateParts[1] && eventParts[2] === selectedDateParts[2]
    })
    const monthParts = String(this.data.calendarMonth || dayKey(new Date()).slice(0, 7)).split('-')
    data.calendarYearLabel = monthParts[0]
    data.calendarMonthNumber = Number(monthParts[1]) || new Date().getMonth() + 1
    this.setData(data)
  },
};
