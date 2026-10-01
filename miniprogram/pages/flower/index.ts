import { EDITORIAL_ASSETS } from '../../data/editorial-assets'
import {
  DEFAULT_USES, PROFILE_KEY, USES_KEY,
  dayKey, formatDateLabel, kindLabel, migrateMiniProgramAssetPath, readDates, readWorks,
  type WorkRecord,
} from '../../utils/houseflower-data'
import { bootstrapBackend, defaultQuota, getAdminSummary, getCloudAssetDetails, getCloudAssetUrls, listBackendTasks, listCloudDates, listCloudWorks, saveCloudDate, trackClientEvent, waitForBackendTask, type DailyQuota } from '../../utils/backend'
import { AI_VISION_ENABLED, LOCAL_DEMO_MODE } from '../../utils/cloud-env'
import { flowerAssetForName } from '../../utils/flower-materials'
import { creationActions } from './creation-actions'
import { sceneActions } from './scene-actions'
import { worksActions } from './works-actions'

const HOME_ENTRIES = [
  { id: 'inspiration', title: '拾光成花', note: '喜欢的画面，变成一束花', path: EDITORIAL_ASSETS.inspirationGarden },
  { id: 'recognition', title: '识花成单', note: '识别花材，整理用花清单', path: EDITORIAL_ASSETS.recognitionSamples[1] },
  { id: 'scene', title: '花映生活', note: '把一束花，放进你的生活', path: EDITORIAL_ASSETS.scenes[0].path },
]
const NAV_ITEMS = [
  { id: 'home', label: '首页', glyph: 'home' },
  { id: 'inspirationList', label: '灵感', glyph: 'inspiration' },
  { id: 'works', label: '作品', glyph: 'works' },
]
const INSPIRATION_CATEGORIES = [
  { id: 'all', label: '全部' }, { id: 'film', label: '电影' }, { id: 'music', label: '音乐' },
  { id: 'art', label: '绘画' }, { id: 'photo', label: '摄影' }, { id: 'nature', label: '自然' },
  { id: 'season', label: '季节' }, { id: 'color', label: '色彩' },
]
const CATEGORY_LABELS: Record<string, string> = { all: '全部', film: '电影', music: '音乐', art: '绘画', photo: '摄影', nature: '自然', season: '季节', color: '色彩' }
const TASK_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000
const INSPIRATION_CASES = [
  // 季节
  { id: 'garden', category: 'season', title: '花园里的春日', description: '浅粉花影与灰绿色叶片交织，像晨光刚刚落进花园。', path: EDITORIAL_ASSETS.inspirationGarden },
  { id: 'peach', category: 'season', title: '午后阳光', description: '暖桃色花束与轻柔的室内光线，适合值得纪念的一天。', path: EDITORIAL_ASSETS.inspirationBouquets[1] },
  { id: 'spring-letter', category: 'season', title: '春日来信', description: '把一整个春天的花开，收进一束花里。', path: EDITORIAL_ASSETS.inspirationBouquets[0] },
  { id: 'white-poem', category: 'season', title: '白色诗意', description: '奶油白与浅绿，清透得像三月清晨。', path: EDITORIAL_ASSETS.recognitionSamples[1] },
  // 摄影
  { id: 'window-photo', category: 'photo', title: '窗边日光', description: '窗光与枝叶相映，把安静的日常留进一帧照片。', path: EDITORIAL_ASSETS.scenes[0].path },
  { id: 'table-photo', category: 'photo', title: '餐桌漫游', description: '木色餐桌和午后阳光，像一段缓慢的旅程。', path: EDITORIAL_ASSETS.scenes[1].path },
  { id: 'entryway-photo', category: 'photo', title: '归家一刻', description: '午后的光线落在玄关，把归家的片刻留成照片。', path: EDITORIAL_ASSETS.scenes[3].path },
  // 自然
  { id: 'garden-path', category: 'nature', title: '花园小径', description: '把枝叶、野花与晨光，编进一束自然花作。', path: EDITORIAL_ASSETS.inspirationGarden },
  { id: 'ivory-field', category: 'nature', title: '原野白花', description: '奶油白与浅绿，像风经过原野时留下的颜色。', path: EDITORIAL_ASSETS.recognitionSamples[1] },
  { id: 'peach-field', category: 'nature', title: '山野花影', description: '柔和的花色映着自然光，轻轻留住远行记忆。', path: EDITORIAL_ASSETS.inspirationBouquets[1] },
  // 电影
  { id: 'still-life', category: 'film', title: '一帧安静', description: '光线、留白与花朵组成一张安静的生活画面。', path: EDITORIAL_ASSETS.filmPoster },
  { id: 'truman', category: 'film', title: '楚门的世界', description: '走出摄影棚的那束光，开成一束向阳的花。', path: EDITORIAL_ASSETS.filmPoster },
  { id: 'seaside-dusk', category: 'film', title: '海边的黄昏', description: '落日把海面染成蜜桃色，也把花染成蜜桃色。', path: EDITORIAL_ASSETS.filmPoster },
  // 色彩
  { id: 'bouquet', category: 'color', title: '柔粉的告白', description: '奶油白与浅粉相伴，把温柔留在日常的角落。', path: EDITORIAL_ASSETS.inspirationBouquets[2] },
  { id: 'pink-romance', category: 'color', title: '粉色浪漫', description: '粉色是心跳的颜色，也是花瓣的颜色。', path: EDITORIAL_ASSETS.inspirationBouquets[0] },
  { id: 'afternoon-cup', category: 'color', title: '一杯花的下午', description: '把午后泡进一杯花茶，让时间慢下来。', path: EDITORIAL_ASSETS.scenes[1].path },
  // 音乐
  { id: 'vinyl', category: 'music', title: '循环的温柔', description: '把一张单曲循环，变成一束安静的花。', path: EDITORIAL_ASSETS.albumCover },
  { id: 'nocturne', category: 'music', title: '夜曲与花', description: '低音里的夜色，藏着深浅不一的花影。', path: EDITORIAL_ASSETS.albumCover },
  { id: 'orange-sunset', category: 'music', title: '橙色日落', description: '像一段副歌，把整天的明亮都收束进花里。', path: EDITORIAL_ASSETS.albumCover },
  // 画作
  { id: 'starry', category: 'art', title: '星夜花束', description: '梵高的星空，旋转成蓝紫色的花束。', path: EDITORIAL_ASSETS.inspirationGarden },
  { id: 'sunflower-art', category: 'art', title: '向日葵的午后', description: '把一片金黄的向日葵，留在桌边的花瓶里。', path: EDITORIAL_ASSETS.scenes[2].path },
  { id: 'retro-romance', category: 'art', title: '复古的浪漫', description: '旧油画的暖调，落在花瓣的褶皱里。', path: EDITORIAL_ASSETS.recognitionSamples[0] },
]
const INSPIRATION_BANNERS = [
  { id: 'bn-spring', caseId: 'garden', title: '花园里的春日', sub: '四季的温柔，都藏在花里', path: EDITORIAL_ASSETS.inspirationGarden },
  { id: 'bn-confess', caseId: 'bouquet', title: '柔粉的告白', sub: '把温柔留在日常的角落', path: EDITORIAL_ASSETS.inspirationBouquets[0] },
  { id: 'bn-starry', caseId: 'starry', title: '星夜花束', sub: '把一幅画，变成一束花', path: EDITORIAL_ASSETS.inspirationBouquets[2] },
]
const INSPIRATION_EXAMPLES = [
  { id: 'poster', title: '电影海报 · 光影之外', description: '把电影画面里的柔光和留白，变成一束花。', path: EDITORIAL_ASSETS.filmPosterInput, resultPath: EDITORIAL_ASSETS.inspirationBouquets[0] },
  { id: 'travel', title: '旅行照片 · 花园漫游', description: '把旅途中遇见的花园颜色，收进一束花里。', path: EDITORIAL_ASSETS.travelPhotoInput, resultPath: EDITORIAL_ASSETS.inspirationBouquets[1] },
  { id: 'album', title: '音乐专辑 · 午后慢歌', description: '把一段旋律的温柔，化成一束花的配色。', path: EDITORIAL_ASSETS.albumCoverInput, resultPath: EDITORIAL_ASSETS.inspirationBouquets[2] },
]
const RECOGNITION_EXAMPLES = [
  {
    id: 'hand-bouquet', label: '一束花', description: '手捧花束，最常见的一束。', path: EDITORIAL_ASSETS.recognitionSamples[0],
    rows: [
      { name: '粉色玫瑰', assetPath: '/assets/materials-ui/rose_001.jpg', colorLabel: '粉色', quantityMin: 4, quantityMax: 7, quantityLabel: '约4–7支', unit: '支', confirmed: false, swatch: '#d890a8' },
      { name: '芍药', assetPath: '/assets/materials-ui/peony_001.jpg', colorLabel: '浅粉', quantityMin: 2, quantityMax: 4, quantityLabel: '约2–4支', unit: '支', confirmed: false, swatch: '#f0c0c0' },
      { name: '尤加利叶', assetPath: '/assets/materials-ui/greenery_001.jpg', colorLabel: '灰绿', quantityMin: 2, quantityMax: 3, quantityLabel: '约2–3枝', unit: '枝', confirmed: false, swatch: '#789078' },
    ],
  },
  {
    id: 'arrangement', label: '插花', description: '桌面插花，花器里的层次。', path: EDITORIAL_ASSETS.recognitionSamples[1],
    rows: [
      { name: '洋桔梗', assetPath: '/assets/materials-ui/lisianthus_001.jpg', colorLabel: '粉色', quantityMin: 3, quantityMax: 5, quantityLabel: '约3–5支', unit: '支', confirmed: false, swatch: '#d890a8' },
      { name: '小雏菊', assetPath: '/assets/materials-ui/daisy_001.jpg', colorLabel: '白色', quantityMin: 3, quantityMax: 5, quantityLabel: '约3–5支', unit: '支', confirmed: false, swatch: '#eee5d4' },
      { name: '尤加利叶', assetPath: '/assets/materials-ui/greenery_002.jpg', colorLabel: '灰绿', quantityMin: 2, quantityMax: 4, quantityLabel: '约2–4枝', unit: '枝', confirmed: false, swatch: '#789078' },
    ],
  },
  {
    id: 'basket', label: '花篮', description: '花篮造型，花材组合更丰富。', path: EDITORIAL_ASSETS.recognitionSamples[2],
    rows: [
      { name: '非洲菊', assetPath: '/assets/materials-ui/gerbera_001.jpg', colorLabel: '橙粉', quantityMin: 3, quantityMax: 5, quantityLabel: '约3–5支', unit: '支', confirmed: false, swatch: '#f09090' },
      { name: '康乃馨', assetPath: '/assets/materials-ui/carnation_001.jpg', colorLabel: '浅粉', quantityMin: 3, quantityMax: 5, quantityLabel: '约3–5支', unit: '支', confirmed: false, swatch: '#f090a8' },
      { name: '配花', assetPath: '/assets/materials-ui/filler_001.jpg', colorLabel: '白色', quantityMin: 2, quantityMax: 4, quantityLabel: '约2–4支', unit: '支', confirmed: false, swatch: '#eee5d4' },
    ],
  },
]
const DEFAULT_PROFILE = { avatarUrl: EDITORIAL_ASSETS.homeHero, name: '花生用户', id: '0001' }

function galleryResultPath(item: any): string {
  if (item && item.resultPath) return item.resultPath
  const index = INSPIRATION_CASES.findIndex((entry) => entry.id === item.id)
  return EDITORIAL_ASSETS.inspirationBouquets[(Math.max(0, index)) % EDITORIAL_ASSETS.inspirationBouquets.length]
}

function taskRecoveryDeadline(task: any): number {
  const value = task && (task.completedAt || task.updatedAt || task.createdAt)
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp + TASK_RECOVERY_WINDOW_MS : 0
}

function taskRecoveryExpired(task: any, now = Date.now()): boolean {
  if (!task || task.status !== 'succeeded') return false
  const deadline = taskRecoveryDeadline(task)
  return Boolean(deadline && now >= deadline)
}

function mergeCloudWorks(localWorks: WorkRecord[], remoteWorks: any[], urls: Record<string, string>): WorkRecord[] {
  const deletedWorkIds = new Set(remoteWorks.filter((work: any) => work.deletedAt).map((work: any) => work.workId))
  const deletedWorkKeys = new Set(remoteWorks.filter((work: any) => work.deletedAt && work.sourceKey).map((work: any) => work.sourceKey))
  const merged = localWorks.filter((work: any) =>
    (!work.cloudWorkId || !deletedWorkIds.has(work.cloudWorkId))
    && (!work.sourceKey || !deletedWorkKeys.has(work.sourceKey)))
  remoteWorks.forEach((remote: any) => {
    if (remote.deletedAt) return
    const match = merged.find((item: any) => item.cloudWorkId === remote.workId || (remote.sourceKey && item.sourceKey === remote.sourceKey))
    const metadataCreatedAt = Number(remote.metadata && remote.metadata.createdAt)
    const remoteCreatedAt = remote.createdAt ? new Date(remote.createdAt).getTime() : Date.now()
    const createdAt = Number.isFinite(metadataCreatedAt) && metadataCreatedAt > 0 ? metadataCreatedAt : remoteCreatedAt
    const incoming: WorkRecord = {
      id: match ? match.id : 'cloud-' + remote.workId,
      cloudWorkId: remote.workId,
      cloudRevision: remote.revision,
      kind: remote.kind,
      title: remote.title,
      previewPath: migrateMiniProgramAssetPath(urls[remote.previewAssetId] || (match && match.previewPath) || String(remote.metadata && remote.metadata.previewPath || '')),
      sourcePath: migrateMiniProgramAssetPath(urls[remote.sourceAssetId] || (match && match.sourcePath) || String(remote.metadata && remote.metadata.sourcePath || '')),
      previewAssetId: remote.previewAssetId || (match && match.previewAssetId) || '',
      sourceAssetId: remote.sourceAssetId || (match && match.sourceAssetId) || '',
      sceneBouquetAssetId: String(remote.metadata && remote.metadata.sceneBouquetAssetId || (match && match.sceneBouquetAssetId) || ''),
      sceneCompositeAssetId: String(remote.metadata && remote.metadata.sceneCompositeAssetId || (match && match.sceneCompositeAssetId) || ''),
      assetIds: Array.isArray(remote.assetIds) ? remote.assetIds : (match && match.assetIds) || [],
      sceneBouquetPath: migrateMiniProgramAssetPath(urls[remote.metadata && remote.metadata.sceneBouquetAssetId] || (match && match.sceneBouquetPath) || ''),
      sceneCompositePath: urls[remote.metadata && remote.metadata.sceneCompositeAssetId] || (match && match.sceneCompositePath) || '',
      sourceKey: remote.sourceKey,
      rows: Array.isArray(remote.rows) ? remote.rows.map((row: any) => ({ ...row, assetPath: migrateMiniProgramAssetPath(String(row.assetPath || '')) })) : [],
      note: remote.metadata && Object.prototype.hasOwnProperty.call(remote.metadata, 'note')
        ? String(remote.metadata.note || '') : String(match && match.note || ''),
      createdAt,
      dateKey: dayKey(new Date(createdAt)),
      status: Array.isArray(remote.rows) && remote.rows.length
        ? (remote.metadata && remote.metadata.status === 'confirmed'
          || remote.rows.every((row: any) => row.confirmed) ? 'confirmed' : 'draft')
        : undefined,
    }
    if (match && match.cloudSyncPending) {
      const expectedPreview = match.previewAssetId || (match.kind === 'materials' ? match.sourceAssetId : '')
      const sameRows = JSON.stringify(match.rows || []) === JSON.stringify(remote.rows || [])
      const alreadyApplied = match.kind === remote.kind
        && match.title === remote.title
        && expectedPreview === String(remote.previewAssetId || '')
        && String(match.sourceAssetId || '') === String(remote.sourceAssetId || '')
        && sameRows
      if (alreadyApplied) Object.assign(match, incoming, { cloudSyncPending: false })
      else if (!match.cloudWorkId) match.cloudWorkId = remote.workId
    } else if (match) Object.assign(match, incoming)
    else merged.push(incoming)
  })
  return merged
}

// 首次进入且本地没有作品时，写入 5 个示例作品，方便查看作品集排版（可长按删除）
const DEMO_SEED_KEY = 'houseflower.demoSeeded'
const DEMO_WORKS = [
  { title: '柔粉的告白', path: EDITORIAL_ASSETS.inspirationBouquets[0], daysAgo: 3 },
  { title: '春日来信', path: EDITORIAL_ASSETS.inspirationBouquets[1], daysAgo: 9 },
  { title: '午后阳光', path: EDITORIAL_ASSETS.inspirationBouquets[2], daysAgo: 16 },
  { title: '一帧安静', path: EDITORIAL_ASSETS.inspirationGarden, daysAgo: 24 },
  { title: '窗边的春日', path: EDITORIAL_ASSETS.scenes[0].path, daysAgo: 31 },
]

function seedDemoWorks(): WorkRecord[] {
  try {
    if (!LOCAL_DEMO_MODE) return []
    if (wx.getStorageSync(DEMO_SEED_KEY)) return []
    wx.setStorageSync(DEMO_SEED_KEY, true)
    const now = Date.now()
    const demo: WorkRecord[] = DEMO_WORKS.map((item, index) => {
      const created = new Date(now - item.daysAgo * 86400000)
      return {
        id: 'demo-' + (index + 1), kind: 'bouquet', title: item.title,
        previewPath: item.path, sourcePath: item.path,
        fileID: '', sourceFileID: '', createdAt: created.getTime(),
        dateKey: dayKey(created), sourceKey: 'demo|' + index,
      } as WorkRecord
    })
    const works = demo.concat(readWorks())
    wx.setStorageSync('houseflower.works', works)
    return works
  } catch { return [] }
}

Page({
  data: {
    mode: 'home', topCaption: 'House花生', homeHero: EDITORIAL_ASSETS.homeHero,
    inspirationHero: EDITORIAL_ASSETS.inspirationGarden, homeEntries: HOME_ENTRIES,
    navItems: NAV_ITEMS.map((item) => ({ ...item, active: item.id === 'home' })),
    worksFilter: 'all', worksView: 'collection',
    selectingWorks: false, selectedWorkIds: [] as string[],
    works: [] as WorkRecord[], visibleWorks: [] as WorkRecord[], workCount: 0,
    recentTasks: [] as any[], currentRecoveredTaskId: '', resumingTaskId: '',
    cloudWorksOffset: 0, cloudWorksHasMore: false, cloudWorksLoading: false,
    importantDates: [] as any[], calendarMonth: dayKey(new Date()).slice(0, 7),
    calendarMonthLabel: '', calendarYearLabel: String(new Date().getFullYear()),
    calendarMonthNumber: new Date().getMonth() + 1,
    showCalendarPicker: false, calendarYears: [] as number[],
    calendarMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    calendarPickerValue: [0, new Date().getMonth()],
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    calendarDays: [] as any[], selectedDate: dayKey(new Date()), selectedDateWorks: [] as any[],
    todayKey: dayKey(new Date()),
    showEventEditor: false, editingEventId: '', eventTitle: '', eventDate: dayKey(new Date()), eventNote: '',
    eventRepeats: false, eventWorkId: '', eventWorkIndex: 0, eventWorkLabels: ['不关联'], eventWorkIds: [''],
    showProfileEditor: false, userProfile: DEFAULT_PROFILE, remainingUses: DEFAULT_USES,
    quotaDateKey: '', quotaLimit: DEFAULT_USES, quotaReserved: 0, quotaResetsAt: '', backendReady: false, visionAvailable: AI_VISION_ENABLED,
    isAdmin: false, subscriptionTemplates: { date: '', task: '' }, adminRange: 30, adminSummary: null as any,
    inspirationExamples: INSPIRATION_EXAMPLES, recognitionExamples: RECOGNITION_EXAMPLES,
    inspirationBanners: INSPIRATION_BANNERS, bannerCurrent: 0,
    inspirationCategories: INSPIRATION_CATEGORIES, inspirationCategory: 'all', inspirationSearch: '',
    inspirationItems: INSPIRATION_CASES.map((item) => ({ ...item, categoryLabel: CATEGORY_LABELS[item.category], sourcePath: item.path, resultPath: galleryResultPath(item) })),
    showInspirationDetail: false, selectedInspiration: null as any,
    showWorkImageViewer: false,
    inspirationPath: '', inspirationMessage: '',
    generationPreviewPath: '', generationSourcePath: '', generationFileID: '', sourceFileID: '', generationAssetId: '', generationSourceAssetId: '',
    bouquetTitle: '生活画面 · 花束', generationDateLabel: '', generationDemo: false,
    generating: false, generationResumePending: false, generationStageLabel: '', generationProgressMode: 'determinate',
    generationProgressPercent: 0, generationProgressLabel: '', generationProgressNote: '',
    generationProgressFillStyle: '', generatedSaved: false,
    replicaPath: '', replicaMessage: '', replicaDemo: false, replicaAssetId: '', replicaSampleId: '', replicaParentWorkId: '',
    replicaCandidates: [] as any[], replicaNotes: [] as string[], identifying: false,
    recognitionStageLabel: '', recognitionSaved: false,
    sceneOptions: EDITORIAL_ASSETS.scenes, selectedSceneId: EDITORIAL_ASSETS.scenes[0].id,
    sceneTitle: EDITORIAL_ASSETS.scenes[0].name, scenePath: EDITORIAL_ASSETS.scenes[0].path, sceneAssetId: '',
    sceneBouquetPath: '', sceneBouquetFileID: '', sceneBouquetAssetId: '', sceneCompositeAssetId: '', sceneBouquetX: 50, sceneBouquetY: 56,
    sceneScalePercent: 80, sceneScaleLabel: '100%', sceneBouquetStyle: '', sceneMessage: '', sceneGenerating: false,
    sceneResultPath: '', sceneResultFileID: '', sceneResultAssetId: '', sceneSourceAssetId: '', sceneSourceFileID: '', sceneSaved: false, currentWork: null as WorkRecord | null,
  },
  onLoad(this: any) {
    let rawWorks = readWorks()
    if (!rawWorks.length) { const seeded = seedDemoWorks(); if (seeded.length) rawWorks = seeded }
    const works = rawWorks.map((work) => ({ ...work, kindLabel: kindLabel(work.kind), dateLabel: formatDateLabel(work.createdAt) }))
    const profile = wx.getStorageSync(PROFILE_KEY)
    let uses = wx.getStorageSync(USES_KEY)
    if (typeof uses !== 'number') uses = wx.getStorageSync('flower.remainingUses')
    this.setData({
      works,
      importantDates: readDates(),
      remainingUses: typeof uses === 'number' ? Math.max(0, uses) : DEFAULT_USES,
      userProfile: profile && profile.name ? { ...profile, avatarUrl: migrateMiniProgramAssetPath(profile.avatarUrl || '') || DEFAULT_PROFILE.avatarUrl } : DEFAULT_PROFILE,
    }, () => { this.refreshWorks(); this.refreshCalendar() })
    try { wx.setNavigationBarTitle({ title: 'House花生' }) } catch {}
  },
  onShow(this: any) {
    this._quotaPageVisible = true
    this.refreshWorks()
    this.refreshTodayCalendar()
    void this.refreshBackendSession()
    void this.restorePendingGeneration()
  },
  onHide(this: any) {
    this._quotaPageVisible = false
    if (this._quotaRefreshTimer) clearTimeout(this._quotaRefreshTimer)
    this._quotaRefreshTimer = null
    if (this._recentTaskExpiryTimer) clearTimeout(this._recentTaskExpiryTimer)
    this._recentTaskExpiryTimer = null
  },
  onUnload(this: any) {
    this._quotaPageVisible = false
    if (this._quotaRefreshTimer) clearTimeout(this._quotaRefreshTimer)
    this._quotaRefreshTimer = null
    if (this._recentTaskExpiryTimer) clearTimeout(this._recentTaskExpiryTimer)
    this._recentTaskExpiryTimer = null
  },
  scheduleQuotaRefresh(this: any) {
    if (this._quotaRefreshTimer) clearTimeout(this._quotaRefreshTimer)
    this._quotaRefreshTimer = null
    if (!this._quotaPageVisible || !this.data.backendReady || !this.data.quotaResetsAt) return
    const resetAt = new Date(this.data.quotaResetsAt).getTime()
    if (!Number.isFinite(resetAt)) return
    const delay = Math.max(1000, resetAt - Date.now() + 1000)
    this._quotaRefreshTimer = setTimeout(() => {
      this._quotaRefreshTimer = null
      this.refreshTodayCalendar()
      void this.refreshBackendSession()
    }, delay)
  },
  refreshTodayCalendar(this: any) {
    const today = dayKey(new Date())
    if (today === this.data.todayKey) return
    const followsToday = String(this.data.selectedDate || '') === String(this.data.todayKey || '')
    const updates: Record<string, any> = { todayKey: today }
    if (followsToday) {
      updates.selectedDate = today
      updates.calendarMonth = today.slice(0, 7)
    }
    this.setData(updates, () => this.refreshCalendar())
  },
  async refreshBackendSession(this: any) {
    if (this._backendSessionRefreshing) return
    this._backendSessionRefreshing = true
    try {
      const session = await bootstrapBackend()
      const quota: DailyQuota = session.quota || defaultQuota()
      const localProfile = this.data.userProfile || DEFAULT_PROFILE
      const avatarUrls: Record<string, string> = session.user.avatarAssetId ? await getCloudAssetUrls([session.user.avatarAssetId]).catch(() => ({})) : {}
      const remoteProfile = {
        ...localProfile,
        id: session.user.userId,
        name: session.user.nickname || localProfile.name,
        avatarUrl: avatarUrls[session.user.avatarAssetId] || localProfile.avatarUrl,
        avatarAssetId: session.user.avatarAssetId || localProfile.avatarAssetId || '',
      }
      this.setData({
        backendReady: true,
        remainingUses: quota.remaining,
        quotaDateKey: quota.dateKey,
        quotaLimit: quota.limit,
        quotaReserved: quota.reserved,
        quotaResetsAt: quota.resetsAt,
        userProfile: remoteProfile,
        isAdmin: Boolean(session.isAdmin),
        subscriptionTemplates: session.subscriptionTemplates || { date: '', task: '' },
      }, () => {
        this.scheduleQuotaRefresh()
        void this.syncCloudData()
      })
    } catch {
      // The UI can still browse local content while the environment is not deployed.
      if (this._quotaRefreshTimer) clearTimeout(this._quotaRefreshTimer)
      this._quotaRefreshTimer = null
      this.setData({ backendReady: false })
    } finally {
      this._backendSessionRefreshing = false
    }
  },
  openAdminPanel(this: any) {
    if (!this.data.isAdmin) { wx.showToast({ title: '没有运营数据权限', icon: 'none' }); return }
    this.setData({ mode: 'admin', topCaption: '运营数据' }, () => this.loadAdminSummary())
  },
  async loadAdminSummary(this: any) {
    if (!this.data.isAdmin) return
    try {
      const summary = await getAdminSummary(Number(this.data.adminRange || 30))
      this.setData({ adminSummary: summary })
    } catch (error: any) {
      wx.showToast({ title: error && error.message ? error.message : '运营数据读取失败', icon: 'none' })
    }
  },
  selectAdminRange(this: any, event: any) {
    const range = Number(event.currentTarget.dataset.range || 30)
    this.setData({ adminRange: range }, () => this.loadAdminSummary())
  },
  trackPageEvent(this: any, mode: string) { void trackClientEvent('page_view', { mode }).catch(() => {}) },
  async syncCloudData(this: any) {
    if (this._cloudSyncRefreshing) return
    this._cloudSyncRefreshing = true
    try {
      const [worksResult, datesResult, tasksResult] = await Promise.allSettled([
        listCloudWorks(30, 0), listCloudDates(), listBackendTasks(20),
      ])
      const remotePage = worksResult.status === 'fulfilled'
        ? worksResult.value : { works: [], nextOffset: 0, hasMore: false }
      const remoteDates = datesResult.status === 'fulfilled' ? datesResult.value : null
      const tasksAvailable = tasksResult.status === 'fulfilled'
      const taskRows = tasksAvailable ? tasksResult.value : []
      const remoteWorks = remotePage.works
      const activeRemoteWorks = remoteWorks.filter((work: any) => !work.deletedAt)
      const taskAssets = taskRows.flatMap((task: any) => [...(task.inputAssetIds || []), task.sceneSourceAssetId, task.sceneBouquetAssetId, ...(task.resultAssetIds || [])]).filter(Boolean)
      const workAssetIds = activeRemoteWorks.flatMap((work: any) => [work.previewAssetId, work.sourceAssetId, ...(work.assetIds || []), work.metadata && work.metadata.sceneBouquetAssetId, work.metadata && work.metadata.sceneCompositeAssetId]).filter(Boolean)
      const emptyAssetDetails: { urls: Record<string, string>; fileIDs: Record<string, string> } = { urls: {}, fileIDs: {} }
      const workDetails = workAssetIds.length ? await getCloudAssetDetails(workAssetIds).catch(() => emptyAssetDetails) : emptyAssetDetails
      const taskDetails = taskAssets.length ? await getCloudAssetDetails(taskAssets).catch(() => emptyAssetDetails) : emptyAssetDetails
      const assetDetails = {
        urls: { ...workDetails.urls, ...taskDetails.urls },
        fileIDs: { ...workDetails.fileIDs, ...taskDetails.fileIDs },
      }
      const urls = assetDetails.urls
      const merged = mergeCloudWorks(readWorks(), remoteWorks, urls)
      const savedAssetIds = new Set(merged.flatMap((work: any) => [work.previewAssetId, work.sourceAssetId, ...(work.assetIds || [])]).filter(Boolean))
      const recentTasks = tasksAvailable ? taskRows.filter((task: any) => {
        if (['queued', 'running', 'saving', 'checking', 'reconciling'].includes(task.status)) return true
        if (task.status !== 'succeeded') return false
        const linkedAssets = task.type === 'recognition' ? task.inputAssetIds || [] : task.resultAssetIds || []
        return !linkedAssets.some((assetId: string) => savedAssetIds.has(assetId))
      }).map((task: any) => ({
        ...task,
        title: task.type === 'recognition' ? '花材识别' : task.type === 'scene' ? '场景融合' : '拾光成花',
        statusLabel: ({ queued: '排队中', checking: '准备中', running: '生成中', saving: '保存结果', reconciling: '核对结果', succeeded: '已完成' } as Record<string, string>)[task.status] || '处理中',
        inputPreviewPath: urls[(task.inputAssetIds || [])[0]] || '',
        resultPreviewPath: urls[(task.resultAssetIds || [])[0]] || '',
        inputFileID: assetDetails.fileIDs[(task.inputAssetIds || [])[0]] || '',
        resultFileID: assetDetails.fileIDs[(task.resultAssetIds || [])[0]] || '',
        sceneSourcePreviewPath: urls[task.sceneSourceAssetId] || '',
        sceneSourceFileID: assetDetails.fileIDs[task.sceneSourceAssetId] || '',
        sceneBouquetPreviewPath: urls[task.sceneBouquetAssetId] || '',
        sceneBouquetFileID: assetDetails.fileIDs[task.sceneBouquetAssetId] || '',
      })) : (this.data.recentTasks || [])
      this.setData({
        cloudWorksOffset: remotePage.nextOffset || 0,
        cloudWorksHasMore: remotePage.hasMore,
      })
      const deletedDateIds = new Set((remoteDates || []).filter((date: any) => date.deletedAt).map((date: any) => date.id))
      const dates = readDates().filter((date: any) =>
        (!date.cloudDateId || !deletedDateIds.has(date.cloudDateId))
        && !deletedDateIds.has(date.id))
      ;(remoteDates || []).forEach((remote: any) => {
        if (remote.deletedAt) return
        const match = dates.find((item: any) => item.cloudDateId === remote.id || item.id === remote.id)
        const linkedWork = remote.workId ? merged.find((work: any) => work.cloudWorkId === remote.workId) : null
        const incoming = { ...remote, id: match ? match.id : 'cloud-' + remote.id, cloudDateId: remote.id, cloudWorkId: remote.workId || '', workId: linkedWork ? linkedWork.id : '' }
        if (match && match.cloudSyncPending) {
          match.cloudDateId = remote.id
          match.cloudWorkId = remote.workId || match.cloudWorkId || ''
        }
        else if (match) Object.assign(match, incoming)
        else dates.push(incoming)
      })
      for (let index = 0; index < dates.length; index += 1) {
        const date = dates[index]
        if (date.cloudDateId && !date.cloudSyncPending) continue
        const linkedWork = date.workId ? merged.find((work: any) => work.id === date.workId) : null
        if (date.workId && !linkedWork?.cloudWorkId) continue
        try {
          const remote = await saveCloudDate({ ...date, workId: linkedWork ? linkedWork.cloudWorkId : '' })
          dates[index] = { ...date, cloudDateId: remote.id, cloudSyncPending: false }
        } catch {
          dates[index] = { ...date, cloudSyncPending: true }
        }
      }
      wx.setStorageSync('houseflower.works', merged)
      wx.setStorageSync('houseflower.dates', dates)
      this.setData({ works: merged, importantDates: dates, recentTasks })
      this.refreshWorks()
      this.refreshCalendar()
    } catch {
      // Cloud sync is additive; local works remain available when the backend is offline.
    } finally {
      this._cloudSyncRefreshing = false
    }
  },
  async loadMoreWorks(this: any) {
    if (!this.data.backendReady || !this.data.cloudWorksHasMore || this.data.cloudWorksLoading) return false
    this.setData({ cloudWorksLoading: true })
    try {
      const page = await listCloudWorks(30, Number(this.data.cloudWorksOffset || 0))
      const activeWorks = page.works.filter((work: any) => !work.deletedAt)
      const assetIds = activeWorks.flatMap((work: any) => [work.previewAssetId, work.sourceAssetId, ...(work.assetIds || []), work.metadata && work.metadata.sceneBouquetAssetId, work.metadata && work.metadata.sceneCompositeAssetId]).filter(Boolean)
      const urls = assetIds.length ? await getCloudAssetUrls(assetIds) : {}
      const merged = mergeCloudWorks(readWorks(), page.works, urls)
      const dates = readDates().map((date: any) => {
        if (!date.cloudWorkId) return date
        const linked = merged.find((work: any) => work.cloudWorkId === date.cloudWorkId)
        return linked ? { ...date, workId: linked.id } : date
      })
      for (let index = 0; index < dates.length; index += 1) {
        const date = dates[index]
        if (date.cloudDateId && !date.cloudSyncPending) continue
        const linkedWork = date.workId ? merged.find((work: any) => work.id === date.workId) : null
        if (date.workId && !linkedWork?.cloudWorkId) continue
        try {
          const remote = await saveCloudDate({ ...date, id: date.cloudDateId || date.id, workId: linkedWork ? linkedWork.cloudWorkId : '' })
          dates[index] = { ...date, cloudDateId: remote.id, cloudWorkId: linkedWork ? linkedWork.cloudWorkId : '', cloudSyncPending: false }
        } catch {
          dates[index] = { ...date, cloudSyncPending: true }
        }
      }
      wx.setStorageSync('houseflower.works', merged)
      wx.setStorageSync('houseflower.dates', dates)
      this.setData({
        importantDates: dates,
        works: merged,
        cloudWorksOffset: page.nextOffset || Number(this.data.cloudWorksOffset || 0),
        cloudWorksHasMore: page.hasMore,
      }, () => this.refreshWorks())
      return true
    } catch {
      wx.showToast({ title: '加载更多作品失败，请稍后重试', icon: 'none' })
      return false
    } finally {
      this.setData({ cloudWorksLoading: false })
    }
  },
  onReady(this: any) {
    wx.createSelectorQuery().in(this).select('#export-canvas').fields({ node: true }, (result: any) => {
      if (result && result.node) (this as any)._exportCanvas = result.node
    }).exec()
  },
  setMode(this: any, mode: string, title: string) {
    const active = ['home', 'inspirationList', 'works'].includes(mode) ? mode : 'home'
    this.setData({
      mode, topCaption: title,
      navItems: NAV_ITEMS.map((item) => ({ ...item, active: item.id === active })),
    })
    this.trackPageEvent(mode)
  },
  changeTab(this: any, event: any) {
    const id = String(event.currentTarget.dataset.id || 'home')
    if (id === 'works') {
      this.setMode('works', '作品')
      this.refreshWorks()
      if (this.data.backendReady) void this.syncCloudData()
      return
    }
    if (id === 'inspirationList') { this.setMode('inspirationList', '灵感'); this.refreshInspiration(); return }
    this.setMode('home', 'House花生')
  },
  openEntry(this: any, event: any) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id === 'inspiration') { this.startImageCreation(); return }
    if (id === 'recognition') {
      this.setData({ replicaPath: '', replicaCandidates: [], replicaNotes: [], replicaMessage: '', recognitionSaved: false })
      this.setMode('recognition', '识花成单')
      return
    }
    if (id === 'scene') {
      const scene = EDITORIAL_ASSETS.scenes[0]
      this.setData({
        scenePath: scene.path, sceneAssetId: '', sceneBouquetPath: '', sceneBouquetFileID: '', sceneBouquetAssetId: '', sceneCompositeAssetId: '',
        sceneSourceAssetId: '', sceneSourceFileID: '',
        selectedSceneId: scene.id, sceneTitle: scene.name, sceneBouquetX: 50, sceneBouquetY: 56,
        sceneScalePercent: 80, sceneScaleLabel: '100%', sceneMessage: '', sceneGenerating: false, sceneSaved: false,
      }, () => { this.updateSceneStyle(); this.captureSceneRect() })
      this.setMode('scene', '花映生活')
    }
  },
  goBack(this: any) {
    const mode = String(this.data.mode)
    const finish = () => {
      if (mode === 'generationResult') { this.clearPendingFlowerGeneration(); this.setMode('inspiration', '拾光成花') }
      else if (mode === 'recognitionResult') this.setMode('recognition', '识花成单')
      else if (mode === 'sceneResult') { this.setMode('scene', '花映生活'); this.captureSceneRect() }
      else if (mode === 'workDetail') { this.setMode('works', '作品'); this.refreshWorks() }
      else if (mode === 'settings') { this.setMode('works', '作品') }
      else this.setMode('home', 'House花生')
    }
    const unsaved = (mode === 'generationResult' && !this.data.generatedSaved)
      || (mode === 'recognitionResult' && !this.data.recognitionSaved)
      || (mode === 'sceneResult' && !this.data.sceneSaved)
    if (!unsaved) { finish(); return }
    wx.showModal({
      title: '离开当前结果？', content: '未保存的内容会清空。', confirmText: '离开', cancelText: '继续查看',
      success: (result) => {
        if (!result.confirm) return
        if (mode === 'generationResult') {
          this.clearPendingFlowerGeneration()
          this.setData({ inspirationPath: '', generationPreviewPath: '', generationSourcePath: '' })
        }
        if (mode === 'recognitionResult') this.setData({ replicaPath: '', replicaCandidates: [] })
        if (mode === 'sceneResult') this.setData({ sceneBouquetPath: '', sceneResultPath: '' })
        this.setMode('home', 'House花生')
      },
    })
  },
  refreshNav(this: any) {
    const mode = String(this.data.mode || 'home')
    const active = ['home', 'inspirationList', 'works'].includes(mode) ? mode : 'home'
    this.setData({ navItems: NAV_ITEMS.map((item) => ({ ...item, active: item.id === active })) })
  },
  refreshInspiration(this: any) {
    const category = this.data.inspirationCategory || 'all'
    const query = String(this.data.inspirationSearch || '').trim().toLowerCase()
    const items = INSPIRATION_CASES
      .filter((item) => (category === 'all' || item.category === category)
        && (!query || (item.title + item.description + (CATEGORY_LABELS[item.category] || '')).toLowerCase().indexOf(query) >= 0))
        .map((item) => ({ ...item, sourcePath: item.path, resultPath: galleryResultPath(item), categoryLabel: CATEGORY_LABELS[item.category] || '灵感' }))
    this.setData({ inspirationItems: items })
  },
  onBannerChange(this: any, event: any) {
    if (event && event.detail && typeof event.detail.current === 'number') {
      this.setData({ bannerCurrent: event.detail.current })
    }
  },
  searchInspiration(this: any, event: any) {
    this.setData({ inspirationSearch: String(event.detail.value || '') }, () => this.refreshInspiration())
  },
  selectInspirationCategory(this: any, event: any) {
    const category = String(event.currentTarget.dataset.id || 'all')
    void trackClientEvent('inspiration_category', { category }).catch(() => {})
    this.setData({ inspirationCategory: category }, () => this.refreshInspiration())
  },
  openInspirationCase(this: any, event: any) {
    const item = INSPIRATION_CASES.find((entry) => entry.id === String(event.currentTarget.dataset.id))
    if (item) this.setData({
      selectedInspiration: {
        ...item, sourcePath: item.path, resultPath: galleryResultPath(item),
        categoryLabel: CATEGORY_LABELS[item.category] || '灵感',
        saved: readWorks().some((work) => work.sourceKey === 'inspiration-gallery|' + item.id),
      },
      showInspirationDetail: true,
    })
    if (item) void trackClientEvent('inspiration_open', { category: item.category, caseId: item.id, title: item.title }).catch(() => {})
  },
  closeInspirationDetail(this: any) { this.setData({ showInspirationDetail: false }) },
  stopPropagation() {},
  useInspirationCase(this: any) {
    const item = this.data.selectedInspiration
    if (!item) return
    void trackClientEvent('inspiration_use', { category: item.category, caseId: item.id, title: item.title }).catch(() => {})
    this.setData({
      showInspirationDetail: false, inspirationPath: item.path,
      generationPreviewPath: '', generationSourcePath: '', generationFileID: '', sourceFileID: '',
      generatedSaved: false, bouquetTitle: item.title + ' · 花束', inspirationMessage: '',
    })
    this.setMode('inspiration', '拾光成花')
  },
  generateInspirationList(this: any) {
    const item = this.data.selectedInspiration
    if (!item || !item.resultPath) return
    this.setData({
      showInspirationDetail: false,
      replicaPath: item.resultPath, replicaCandidates: [], replicaNotes: [], replicaAssetId: '',
      replicaSampleId: 'hand-bouquet', replicaParentWorkId: '', replicaDemo: false,
      recognitionSaved: false, replicaMessage: '',
    })
    this.setMode('recognition', '识花成单')
    this.refreshNav()
  },
  openWorkImageViewer(this: any) {
    const work = this.data.currentWork
    if (work && work.previewPath) this.setData({ showWorkImageViewer: true })
  },
  closeWorkImageViewer(this: any) { this.setData({ showWorkImageViewer: false }) },
  async openRecentTask(this: any, event: any) {
    const taskId = String(event.currentTarget.dataset.id || '')
    let task = (this.data.recentTasks || []).find((item: any) => item.taskId === taskId)
    if (!task) return
    if (task.status !== 'succeeded') {
      if (this.data.resumingTaskId === taskId) return
      this.setData({ resumingTaskId: taskId })
      try {
        await waitForBackendTask(taskId, (stage) => {
          const labels: Record<string, string> = { queued: '排队中', checking: '准备中', running: '生成中', saving: '保存结果', reconciling: '核对结果' }
          const completedAt = stage === 'completed' ? Date.now() : undefined
          const recentTasks = (this.data.recentTasks || []).map((item: any) => item.taskId === taskId ? {
            ...item, status: stage === 'completed' ? 'succeeded' : item.status,
            ...(completedAt ? { completedAt, updatedAt: completedAt } : {}),
            statusLabel: labels[stage] || item.statusLabel,
          } : item)
          this.setData({ recentTasks })
        })
        await this.syncCloudData()
        task = (this.data.recentTasks || []).find((item: any) => item.taskId === taskId)
        if (task && task.status === 'succeeded') wx.showToast({ title: '生成已完成，轻触查看结果', icon: 'success' })
      } catch (error: any) {
        wx.showToast({ title: error && error.message ? error.message : '暂时无法连接任务，请稍后重试', icon: 'none' })
      } finally {
        this.setData({ resumingTaskId: '' })
      }
      return
    }
    if (task.type === 'recognition') {
      const result = task.result || {}
      const rows = (result.items || []).map((item: any, index: number) => {
        const flower = flowerAssetForName(item.name)
        const minimum = Number.isInteger(item.minimum) ? item.minimum : null
        const maximum = Number.isInteger(item.maximum) ? item.maximum : null
        const unit = String(item.unit || '支')
        return {
          ...item,
          id: 'recovered-' + task.taskId + '-' + index,
          colorLabel: String(item.color || '自然色'),
          quantityMin: minimum,
          quantityMax: maximum,
          quantityLabel: minimum !== null && maximum !== null ? '约' + minimum + '–' + maximum + unit : '数量待确认',
          confirmed: false,
          assetPath: flower ? flower.assetPath : '',
          swatch: flower ? flower.swatch : '#d7c2b8',
        }
      })
      if (!rows.length || !task.inputPreviewPath) { wx.showToast({ title: '识别结果暂时无法读取，请刷新重试', icon: 'none' }); return }
      this.setData({
        mode: 'recognitionResult', topCaption: '识花成单', replicaPath: task.inputPreviewPath,
        sourceFileID: task.inputFileID || '', replicaAssetId: (task.inputAssetIds || [])[0] || '',
        replicaCandidates: rows, replicaNotes: result.notes || [], replicaSampleId: '', replicaParentWorkId: '',
        replicaDemo: false, identifying: false, recognitionSaved: false, recentTaskId: task.taskId,
      }, () => this.refreshNav())
      return
    }
    if (!task.resultPreviewPath || !task.resultFileID) { wx.showToast({ title: '成品图片暂时无法读取，请刷新重试', icon: 'none' }); return }
    if (task.type === 'scene') {
      this.setData({
        mode: 'sceneResult', topCaption: '花映生活', sceneResultPath: task.resultPreviewPath,
        sceneResultFileID: task.resultFileID, sceneResultAssetId: (task.resultAssetIds || [])[0] || '',
        scenePath: task.sceneSourcePreviewPath || task.inputPreviewPath || '', sceneSourceFileID: task.sceneSourceFileID || task.inputFileID || '',
        sceneSourceAssetId: task.sceneSourceAssetId || (task.inputAssetIds || [])[0] || '',
        sceneBouquetPath: task.sceneBouquetPreviewPath || '', sceneBouquetFileID: task.sceneBouquetFileID || '',
        sceneBouquetAssetId: task.sceneBouquetAssetId || '', sceneCompositeAssetId: (task.inputAssetIds || [])[0] || '',
        sceneAssetId: task.sceneSourceAssetId || (task.inputAssetIds || [])[0] || '', sceneTitle: '花束场景',
        sceneSaved: false, sceneGenerating: false, currentRecoveredTaskId: task.taskId,
      }, () => this.refreshNav())
      return
    }
    if (!task.inputPreviewPath) { wx.showToast({ title: '灵感原图暂时无法读取，请刷新重试', icon: 'none' }); return }
    this.setData({
      mode: 'generationResult', topCaption: '拾光成花', generationPreviewPath: task.resultPreviewPath,
      generationSourcePath: task.inputPreviewPath, generationFileID: task.resultFileID,
      generationAssetId: (task.resultAssetIds || [])[0] || '', sourceFileID: task.inputFileID || '',
      generationSourceAssetId: (task.inputAssetIds || [])[0] || '', bouquetTitle: '生活画面 · 花束',
      generationDateLabel: formatDateLabel(new Date(task.createdAt).getTime()), generating: false,
      generationDemo: false, generatedSaved: false, currentRecoveredTaskId: task.taskId,
    }, () => this.refreshNav())
  },
  previewImage(this: any, event: any) {
    const path = String(event.currentTarget.dataset.path || '')
    if (path) wx.previewImage({ current: path, urls: [path] })
  },
  refreshWorks(this: any) {
    const works: WorkRecord[] = this.data.works || []
    const selectedIds: string[] = this.data.selectedWorkIds || []
    const visibleWorks = works
      .filter((work) => work.kind !== 'materials')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((work) => ({ ...work, kindLabel: kindLabel(work.kind), dateLabel: formatDateLabel(work.createdAt), selected: selectedIds.indexOf(work.id) >= 0 }))
    const tasks = this.data.recentTasks || []
    const savedAssets = new Set(works.flatMap((work: any) => [work.previewAssetId, work.sourceAssetId, ...(work.assetIds || [])]).filter(Boolean))
    const recentTasks = tasks.filter((task: any) => {
      if (task.status !== 'succeeded') return true
      if (taskRecoveryExpired(task)) return false
      const linked = task.type === 'recognition' ? task.inputAssetIds || [] : task.resultAssetIds || []
      return !linked.some((assetId: string) => savedAssets.has(assetId))
    })
    this.setData({ visibleWorks, workCount: visibleWorks.length, recentTasks })
    this.scheduleRecentTaskExpiry()
    this.refreshCalendar()
  },
  scheduleRecentTaskExpiry(this: any) {
    if (this._recentTaskExpiryTimer) clearTimeout(this._recentTaskExpiryTimer)
    this._recentTaskExpiryTimer = null
    if (!this._quotaPageVisible) return
    const now = Date.now()
    const deadlines = (this.data.recentTasks || [])
      .filter((task: any) => task.status === 'succeeded')
      .map((task: any) => taskRecoveryDeadline(task))
      .filter((deadline: number) => deadline > now)
    if (!deadlines.length) return
    const nextExpiry = Math.min(...deadlines)
    this._recentTaskExpiryTimer = setTimeout(() => {
      this._recentTaskExpiryTimer = null
      this.refreshWorks()
    }, Math.max(250, nextExpiry - Date.now() + 50))
  },
  ...creationActions,
  ...sceneActions,
  ...worksActions,
})
