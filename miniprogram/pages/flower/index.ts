import { EDITORIAL_ASSETS } from '../../data/editorial-assets'
import {
  DEFAULT_USES, PROFILE_KEY, USES_KEY,
  DEFAULT_WORK_CATEGORY, PORTFOLIO_CATEGORIES, PORTFOLIO_CATEGORY_LABEL,
  dayKey, formatDateLabel, kindLabel, migrateMiniProgramAssetPath, readWorks,
  type WorkRecord,
} from '../../utils/houseflower-data'
import { bootstrapBackend, defaultQuota, getAdminSummary, getCloudAssetDetails, getCloudAssetUrls, getEditorialAssetUrls, grantBonusQuota as grantUserBonusQuota, listBackendTasks, listCloudWorks, trackClientEvent, waitForBackendTask, type DailyQuota } from '../../utils/backend'
import { AI_VISION_ENABLED, LOCAL_DEMO_MODE } from '../../utils/cloud-env'
import { DEFAULT_BRAND, getLocalBrand, type ShopBrand } from '../../utils/brand'
import { flowerAssetForName } from '../../utils/flower-materials'
import { creationActions } from './creation-actions'
import { sceneActions } from './scene-actions'
import { worksActions } from './works-actions'

const QUOTA_GIFT_PENDING_STORAGE_KEY = 'houseflower.admin.quotaGiftPending'

const HOME_ENTRIES = [
  { id: 'inspiration', title: '拾光成花', note: '喜欢的画面，变成一束花', path: EDITORIAL_ASSETS.inspirationGarden },
  { id: 'recognition', title: '识花成单', note: '识别花材，整理用花清单', path: EDITORIAL_ASSETS.recognitionSamples[1] },
  { id: 'scene', title: '花映生活', note: '把一束花，放进你的生活', path: EDITORIAL_ASSETS.scenes[0].path },
]
const NAV_ITEMS = [
  { id: 'home', label: '首页', glyph: 'home' },
  { id: 'portfolio', label: '作品集', glyph: 'works' },
]
const TASK_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000
const INSPIRATION_EXAMPLES = [
  { id: 'truman', assetKey: 'case-truman-reference', title: '电影 · 楚门的世界', description: '走向天光的一刻，开成一束向阳的花。', path: EDITORIAL_ASSETS.showcases.truman.input, resultPath: EDITORIAL_ASSETS.showcases.truman.result },
  { id: 'jay', assetKey: 'case-jay-reference', title: '专辑 · 周杰伦《Jay》', description: '把暗红、黑色和琥珀金转化成一束花。', path: EDITORIAL_ASSETS.showcases.jay.input, resultPath: EDITORIAL_ASSETS.showcases.jay.result },
  { id: 'starry-night', assetKey: 'case-starry-night-pd-reference', title: '画作 · 梵高《星夜》', description: '群青星空与月光金，化作一束夜色花礼。', path: EDITORIAL_ASSETS.showcases.starryNight.input, resultPath: EDITORIAL_ASSETS.showcases.starryNight.result },
]
const RECOGNITION_EXAMPLES = [
  {
    id: 'hand-bouquet', assetKey: 'bouquet-home', label: '一束花', description: '手捧花束，最常见的一束。', path: EDITORIAL_ASSETS.recognitionSamples[0],
    rows: [
      { name: '粉色玫瑰', assetPath: '/assets/materials-ui/rose_001.jpg', colorLabel: '粉色', quantityMin: 4, quantityMax: 7, quantityLabel: '约4–7支', unit: '支', confirmed: false, swatch: '#d890a8' },
      { name: '芍药', assetPath: '/assets/materials-ui/peony_001.jpg', colorLabel: '浅粉', quantityMin: 2, quantityMax: 4, quantityLabel: '约2–4支', unit: '支', confirmed: false, swatch: '#f0c0c0' },
      { name: '尤加利叶', assetPath: '/assets/materials-ui/greenery_001.jpg', colorLabel: '灰绿', quantityMin: 2, quantityMax: 3, quantityLabel: '约2–3枝', unit: '枝', confirmed: false, swatch: '#789078' },
    ],
  },
  {
    id: 'arrangement', assetKey: 'bouquet-ivory-sample', label: '插花', description: '桌面插花，花器里的层次。', path: EDITORIAL_ASSETS.recognitionSamples[1],
    rows: [
      { name: '洋桔梗', assetPath: '/assets/materials-ui/lisianthus_001.jpg', colorLabel: '粉色', quantityMin: 3, quantityMax: 5, quantityLabel: '约3–5支', unit: '支', confirmed: false, swatch: '#d890a8' },
      { name: '小雏菊', assetPath: '/assets/materials-ui/daisy_001.jpg', colorLabel: '白色', quantityMin: 3, quantityMax: 5, quantityLabel: '约3–5支', unit: '支', confirmed: false, swatch: '#eee5d4' },
      { name: '尤加利叶', assetPath: '/assets/materials-ui/greenery_002.jpg', colorLabel: '灰绿', quantityMin: 2, quantityMax: 4, quantityLabel: '约2–4枝', unit: '枝', confirmed: false, swatch: '#789078' },
    ],
  },
  {
    id: 'basket', assetKey: 'bouquet-peach-sample', label: '花篮', description: '花篮造型，花材组合更丰富。', path: EDITORIAL_ASSETS.recognitionSamples[2],
    rows: [
      { name: '非洲菊', assetPath: '/assets/materials-ui/gerbera_001.jpg', colorLabel: '橙粉', quantityMin: 3, quantityMax: 5, quantityLabel: '约3–5支', unit: '支', confirmed: false, swatch: '#f09090' },
      { name: '康乃馨', assetPath: '/assets/materials-ui/carnation_001.jpg', colorLabel: '浅粉', quantityMin: 3, quantityMax: 5, quantityLabel: '约3–5支', unit: '支', confirmed: false, swatch: '#f090a8' },
      { name: '配花', assetPath: '/assets/materials-ui/filler_001.jpg', colorLabel: '白色', quantityMin: 2, quantityMax: 4, quantityLabel: '约2–4支', unit: '支', confirmed: false, swatch: '#eee5d4' },
    ],
  },
]
const DEFAULT_PROFILE = { avatarUrl: EDITORIAL_ASSETS.homeHero, name: '花友', id: '0001' }
const EDITORIAL_URL_CACHE_KEY = 'houseflower.editorialAssetUrls'

function editorialAssetKey(value: string): string {
  const match = String(value || '').match(/^\/assets\/editorial\/([a-zA-Z0-9_-]+)\.(?:jpg|jpeg|png|webp)$/i)
  return match ? match[1] : ''
}

function collectEditorialAssetKeys(value: any, keys = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    const key = editorialAssetKey(value)
    if (key) keys.add(key)
  } else if (Array.isArray(value)) value.forEach((item) => collectEditorialAssetKeys(item, keys))
  else if (value && typeof value === 'object') Object.keys(value).forEach((key) => collectEditorialAssetKeys(value[key], keys))
  return keys
}

const EDITORIAL_ASSET_KEYS = [...collectEditorialAssetKeys(EDITORIAL_ASSETS)]

function resolveEditorialPath(value: string, urls: Record<string, string>): string {
  const key = editorialAssetKey(value)
  return key ? String(urls[key] || '') : String(value || '')
}

function resolveEditorialValue(value: any, urls: Record<string, string>): any {
  if (typeof value === 'string') return resolveEditorialPath(value, urls)
  if (Array.isArray(value)) return value.map((item) => resolveEditorialValue(item, urls))
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {}
    Object.keys(value).forEach((key) => { result[key] = resolveEditorialValue(value[key], urls) })
    return result
  }
  return value
}

function resolveEditorialWork(work: any, urls: Record<string, string>): any {
  const sourceKey = String(work && work.sourceKey || '')
  if (sourceKey.startsWith('inspiration-gallery|')) {
    const caseId = sourceKey.slice('inspiration-gallery|'.length)
    const assets = (EDITORIAL_ASSETS.inspirationCases as Record<string, { reference: string; flower: string }>)[caseId]
    if (assets) return {
      ...work,
      previewPath: resolveEditorialPath(assets.flower, urls),
      sourcePath: resolveEditorialPath(assets.reference, urls),
    }
  }
  return resolveEditorialValue(work, urls)
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
  { title: '柔粉的告白', path: EDITORIAL_ASSETS.inspirationBouquets[0], daysAgo: 3, category: 'bouquet' },
  { title: '春日来信', path: EDITORIAL_ASSETS.inspirationBouquets[1], daysAgo: 9, category: 'bouquet' },
  { title: '午后阳光', path: EDITORIAL_ASSETS.inspirationBouquets[2], daysAgo: 16, category: 'basket' },
  { title: '一帧安静', path: EDITORIAL_ASSETS.inspirationGarden, daysAgo: 24, category: 'wedding' },
  { title: '窗边的春日', path: EDITORIAL_ASSETS.scenes[0].path, daysAgo: 31, category: 'gift' },
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
        id: 'demo-' + (index + 1), kind: 'bouquet', category: item.category, title: item.title,
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
    mode: 'home', topCaption: DEFAULT_BRAND.shopName, homeHero: EDITORIAL_ASSETS.homeHero,
    brand: DEFAULT_BRAND,
    editorialAssetsReady: false, editorialAssetsLoading: true, editorialAssetUrls: {} as Record<string, string>,
    inspirationHero: EDITORIAL_ASSETS.inspirationGarden, homeEntries: HOME_ENTRIES,
    navItems: NAV_ITEMS.map((item) => ({ ...item, active: item.id === 'home' })),
    worksFilter: 'all', worksView: 'collection',
    selectingWorks: false, selectedWorkIds: [] as string[],
    works: [] as WorkRecord[], visibleWorks: [] as WorkRecord[], workCount: 0,
    recentTasks: [] as any[], currentRecoveredTaskId: '', resumingTaskId: '',
    cloudWorksOffset: 0, cloudWorksHasMore: false, cloudWorksLoading: false,
    showProfileEditor: false, userProfile: DEFAULT_PROFILE, remainingUses: DEFAULT_USES, bonusQuotaRemaining: 0,
    quotaDateKey: '', quotaLimit: DEFAULT_USES, quotaReserved: 0, quotaResetsAt: '', backendReady: false, visionAvailable: AI_VISION_ENABLED,
    isAdmin: false, subscriptionTemplates: { date: '', task: '' }, adminRange: 30, adminSummary: null as any,
    quotaGiftUserId: '', quotaGiftCount: '1', quotaGiftReason: '', quotaGiftBusy: false,
    inspirationExamples: INSPIRATION_EXAMPLES, recognitionExamples: RECOGNITION_EXAMPLES,
    portfolioCategory: 'all', portfolioSearch: '', portfolioItems: [] as WorkRecord[], portfolioCategories: PORTFOLIO_CATEGORIES,
    showWorkImageViewer: false,
    inspirationPath: '', inspirationAssetKey: '', inspirationMessage: '',
    generationPreviewPath: '', generationSourcePath: '', generationFileID: '', sourceFileID: '', generationAssetId: '', generationSourceAssetId: '',
    bouquetTitle: '生活画面 · 花束', generationDateLabel: '', generationDemo: false,
    generating: false, generationResumePending: false, generationStageLabel: '', generationProgressMode: 'determinate',
    generationProgressPercent: 0, generationProgressLabel: '', generationProgressNote: '',
    generationProgressFillStyle: '', generatedSaved: false,
    replicaPath: '', replicaAssetKey: '', replicaMessage: '', replicaDemo: false, replicaAssetId: '', replicaSampleId: '', replicaParentWorkId: '',
    replicaCandidates: [] as any[], replicaNotes: [] as string[], identifying: false,
    recognitionStageLabel: '', recognitionSaved: false,
    sceneOptions: [] as any[], selectedSceneId: EDITORIAL_ASSETS.scenes[0].id,
    sceneTitle: EDITORIAL_ASSETS.scenes[0].name, scenePath: '', sceneAssetId: '',
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
      remainingUses: typeof uses === 'number' ? Math.max(0, uses) : DEFAULT_USES,
      bonusQuotaRemaining: 0,
      userProfile: profile && profile.name ? { ...profile, avatarUrl: migrateMiniProgramAssetPath(profile.avatarUrl || '') || DEFAULT_PROFILE.avatarUrl } : DEFAULT_PROFILE,
    }, () => { this.refreshWorks() })
    try { wx.setNavigationBarTitle({ title: this.data.brand.shopName }) } catch {}
    void this.loadShopBrand()
    this.applyRoleUI()
  },
  onShow(this: any) {
    this._quotaPageVisible = true
    this.refreshWorks()
    void this.refreshBackendSession()
    void this.refreshEditorialAssets()
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
      void this.refreshBackendSession()
    }, delay)
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
        bonusQuotaRemaining: quota.bonusRemaining,
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
        void this.refreshEditorialAssets()
        this.applyRoleUI()
      })
    } catch {
      // The UI can still browse local content while the environment is not deployed.
      if (this._quotaRefreshTimer) clearTimeout(this._quotaRefreshTimer)
      this._quotaRefreshTimer = null
      this.setData({ backendReady: false, editorialAssetsLoading: false })
    } finally {
      this._backendSessionRefreshing = false
    }
  },
  applyEditorialAssetUrls(this: any, urls: Record<string, string>) {
    const resolve = (value: any) => resolveEditorialValue(value, urls)
    const sceneOptions = resolve(EDITORIAL_ASSETS.scenes)
    const selectedScene = sceneOptions.find((scene: any) => scene.id === this.data.selectedSceneId) || sceneOptions[0]
    const profile = this.data.userProfile || DEFAULT_PROFILE
    const currentWork = this.data.currentWork ? resolveEditorialWork(this.data.currentWork, urls) : this.data.currentWork
    this.setData({
      editorialAssetUrls: urls,
      editorialAssetsReady: true,
      editorialAssetsLoading: false,
      homeHero: resolve(EDITORIAL_ASSETS.homeHero),
      inspirationHero: resolve(EDITORIAL_ASSETS.inspirationGarden),
      homeEntries: this.data.isAdmin ? resolve(HOME_ENTRIES) : [],
      inspirationExamples: resolve(INSPIRATION_EXAMPLES),
      recognitionExamples: resolve(RECOGNITION_EXAMPLES),
      sceneOptions,
      scenePath: this.data.selectedSceneId === 'custom' ? this.data.scenePath : selectedScene && selectedScene.path || '',
      sceneTitle: this.data.selectedSceneId === 'custom' ? this.data.sceneTitle : selectedScene && selectedScene.name || '',
      userProfile: {
        ...profile,
        avatarUrl: profile.avatarAssetId ? profile.avatarUrl : resolveEditorialPath(profile.avatarUrl || DEFAULT_PROFILE.avatarUrl, urls),
      },
      works: (this.data.works || []).map((work: any) => resolveEditorialWork(work, urls)),
      visibleWorks: (this.data.visibleWorks || []).map((work: any) => resolveEditorialWork(work, urls)),
      currentWork,
      inspirationPath: this.data.inspirationAssetKey ? urls[this.data.inspirationAssetKey] || '' : resolveEditorialPath(this.data.inspirationPath, urls),
      replicaPath: this.data.replicaAssetKey ? urls[this.data.replicaAssetKey] || '' : resolveEditorialPath(this.data.replicaPath, urls),
    }, () => {
      this.refreshWorks()
    })
  },
  async refreshEditorialAssets(this: any) {
    if (this._editorialAssetsLoading) return
    let cached: any = null
    try { cached = wx.getStorageSync(EDITORIAL_URL_CACHE_KEY) } catch {}
    const now = Date.now()
    if (cached && cached.urls && Number(cached.expiresAt) > now + 60_000) {
      if (!this.data.editorialAssetsReady) this.applyEditorialAssetUrls(cached.urls)
      return
    }
    if (!this.data.backendReady) return
    this._editorialAssetsLoading = true
    this.setData({ editorialAssetsLoading: true, editorialAssetsReady: false })
    try {
      const urls = await getEditorialAssetUrls(EDITORIAL_ASSET_KEYS)
      const missing = EDITORIAL_ASSET_KEYS.filter((key) => !urls[key])
      if (missing.length) throw new Error('部分案例图片尚未发布到云存储。')
      const next = { urls, expiresAt: Date.now() + 55 * 60 * 1000 }
      try { wx.setStorageSync(EDITORIAL_URL_CACHE_KEY, next) } catch {}
      this.applyEditorialAssetUrls(urls)
    } catch (error: any) {
      this.setData({ editorialAssetsLoading: false, editorialAssetsReady: false })
      wx.showToast({ title: error && error.message ? error.message : '高清图片加载失败，请检查网络后重试', icon: 'none' })
    } finally {
      this._editorialAssetsLoading = false
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
  updateQuotaGiftUserId(this: any, event: any) {
    this._quotaGiftGrantId = ''
    this.setData({ quotaGiftUserId: String(event.detail.value || '') })
  },
  updateQuotaGiftCount(this: any, event: any) {
    this._quotaGiftGrantId = ''
    this.setData({ quotaGiftCount: String(event.detail.value || '') })
  },
  updateQuotaGiftReason(this: any, event: any) {
    this._quotaGiftGrantId = ''
    this.setData({ quotaGiftReason: String(event.detail.value || '') })
  },
  grantQuotaGift(this: any) {
    if (!this.data.isAdmin || this.data.quotaGiftBusy) return
    const userId = String(this.data.quotaGiftUserId || '').trim()
    const count = Number(this.data.quotaGiftCount)
    if (!/^[a-f0-9]{32}$/i.test(userId)) { wx.showToast({ title: '请输入作品页设置中显示的完整用户 ID', icon: 'none' }); return }
    if (!Number.isInteger(count) || count < 1 || count > 1000) { wx.showToast({ title: '赠送次数需为 1–1000 的整数', icon: 'none' }); return }
    const page = this
    wx.showModal({
      title: '确认赠送次数？',
      content: `将向用户 ${userId.slice(0, 8)}… 赠送 ${count} 次。次数不会每日重置，日常额度用完后再使用。`,
      confirmText: '确认赠送',
      success: async (result) => {
        if (!result.confirm) return
        const reason = String(page.data.quotaGiftReason || '').trim()
        let pending: any = null
        try { pending = wx.getStorageSync(QUOTA_GIFT_PENDING_STORAGE_KEY) } catch {}
        const pendingMatches = pending && pending.userId === userId && Number(pending.count) === count && String(pending.reason || '') === reason
        if (!page._quotaGiftGrantId) page._quotaGiftGrantId = pendingMatches && pending.grantId || `gift_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`
        const grantId = page._quotaGiftGrantId
        try { wx.setStorageSync(QUOTA_GIFT_PENDING_STORAGE_KEY, { userId, count, reason, grantId }) } catch {}
        page.setData({ quotaGiftBusy: true })
        try {
          const response = await grantUserBonusQuota(userId, count, reason, grantId)
          page._quotaGiftGrantId = ''
          try {
            const savedPending = wx.getStorageSync(QUOTA_GIFT_PENDING_STORAGE_KEY)
            if (savedPending && savedPending.grantId === grantId) wx.removeStorageSync(QUOTA_GIFT_PENDING_STORAGE_KEY)
          } catch {}
          wx.showToast({ title: response.alreadyGranted ? '这笔赠送已处理' : `赠送成功，剩余赠送 ${response.quota.bonusRemaining} 次`, icon: 'success' })
          if (!response.alreadyGranted) page.setData({ quotaGiftCount: '1', quotaGiftReason: '' })
        } catch (error: any) {
          wx.showToast({ title: error && error.message ? error.message : '赠送失败，请重试', icon: 'none' })
        } finally {
          page.setData({ quotaGiftBusy: false })
        }
      },
    })
  },
  trackPageEvent(this: any, mode: string) { void trackClientEvent('page_view', { mode }).catch(() => {}) },
  async syncCloudData(this: any) {
    if (this._cloudSyncRefreshing) return
    this._cloudSyncRefreshing = true
    try {
      const [worksResult, tasksResult] = await Promise.allSettled([
        listCloudWorks(30, 0), listBackendTasks(20),
      ])
      const remotePage = worksResult.status === 'fulfilled'
        ? worksResult.value : { works: [], nextOffset: 0, hasMore: false }
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
      wx.setStorageSync('houseflower.works', merged)
      this.setData({ works: merged, recentTasks })
      this.refreshWorks()
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
      wx.setStorageSync('houseflower.works', merged)
      this.setData({
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
    const active = ['home', 'portfolio'].includes(mode) ? mode : 'home'
    this.setData({
      mode, topCaption: title,
      navItems: NAV_ITEMS.map((item) => ({ ...item, active: item.id === active })),
    })
    this.trackPageEvent(mode)
  },
  changeTab(this: any, event: any) {
    const id = String(event.currentTarget.dataset.id || 'home')
    if (id === 'portfolio') {
      this.setMode('portfolio', '作品集')
      this.refreshWorks()
      if (this.data.backendReady) void this.syncCloudData()
      return
    }
    this.setMode('home', this.data.brand.shopName)
  },
  openEntry(this: any, event: any) {
    if (!this.data.editorialAssetsReady) { wx.showToast({ title: '正在加载高清图片，请稍候', icon: 'none' }); return }
    const id = String(event.currentTarget.dataset.id || '')
    if (id === 'inspiration') { this.startImageCreation(); return }
    if (id === 'recognition') {
      this.setData({ replicaPath: '', replicaAssetKey: '', replicaCandidates: [], replicaNotes: [], replicaMessage: '', recognitionSaved: false })
      this.setMode('recognition', '识花成单')
      return
    }
    if (id === 'scene') {
      const scene = this.data.sceneOptions[0]
      if (!scene) return
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
      else if (mode === 'workDetail') { this.setMode('portfolio', '作品集'); this.refreshWorks() }
      else if (mode === 'settings') { this.setMode('portfolio', '作品集') }
      else this.setMode('home', this.data.brand.shopName)
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
          this.setData({ inspirationPath: '', inspirationAssetKey: '', generationPreviewPath: '', generationSourcePath: '' })
        }
        if (mode === 'recognitionResult') this.setData({ replicaPath: '', replicaAssetKey: '', replicaCandidates: [] })
        if (mode === 'sceneResult') this.setData({ sceneBouquetPath: '', sceneResultPath: '' })
        this.setMode('home', this.data.brand.shopName)
      },
    })
  },
  refreshNav(this: any) {
    const mode = String(this.data.mode || 'home')
    const active = ['home', 'portfolio'].includes(mode) ? mode : 'home'
    this.setData({ navItems: NAV_ITEMS.map((item) => ({ ...item, active: item.id === active })) })
  },
  // ---- 作品集（统一门面：店主与顾客同看一套作品） ----
  refreshPortfolio(this: any) {
    const category = this.data.portfolioCategory || 'all'
    const query = String(this.data.portfolioSearch || '').trim().toLowerCase()
    const items = (this.data.visibleWorks || [])
      .filter((work: any) => (category === 'all' || (work.category || DEFAULT_WORK_CATEGORY) === category)
        && (!query || (work.title + ' ' + (work.note || '')).toLowerCase().indexOf(query) >= 0))
      .map((work: any) => ({ ...work, categoryLabel: PORTFOLIO_CATEGORY_LABEL[work.category || DEFAULT_WORK_CATEGORY] || '花束' }))
    this.setData({ portfolioItems: items })
  },
  selectPortfolioCategory(this: any, event: any) {
    const category = String(event.currentTarget.dataset.id || 'all')
    this.setData({ portfolioCategory: category }, () => this.refreshPortfolio())
  },
  searchPortfolio(this: any, event: any) {
    this.setData({ portfolioSearch: String(event.detail.value || '') }, () => this.refreshPortfolio())
  },
  clearPortfolioSearch(this: any) {
    this.setData({ portfolioSearch: '' }, () => this.refreshPortfolio())
  },
  openCreationSheet(this: any) {
    if (!this.data.isAdmin) return
    this.changeTab({ currentTarget: { dataset: { id: 'home' } } })
  },
  stopPropagation() {},
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
    const urls = this.data.editorialAssetUrls || {}
    const works: WorkRecord[] = (this.data.works || []).map((work: any) => resolveEditorialWork(work, urls))
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
    this.refreshPortfolio()
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
  // ---- 店铺品牌（M1 源码交付：品牌来自本地配置 brand.config.ts） ----
  loadShopBrand(this: any) {
    this.applyShopBrand(getLocalBrand())
  },
  applyShopBrand(brand: ShopBrand) {
    const merged = { ...DEFAULT_BRAND, ...brand }
    this.setData({ brand: merged })
    if (this.data.editorialAssetsReady) {
      this.setData({ homeHero: (merged.logoUrl || resolveEditorialPath(EDITORIAL_ASSETS.homeHero, this.data.editorialAssetUrls)) as any })
    }
    try { wx.setNavigationBarTitle({ title: merged.shopName }) } catch {}
    if (this.data.mode === 'home') this.setData({ topCaption: merged.shopName })
    this.applyRoleUI()
  },
  applyRoleUI(this: any) {
    const isAdmin = this.data.isAdmin
    const mode = String(this.data.mode || 'home')
    const active = ['home', 'portfolio'].includes(mode) ? mode : 'home'
    const navItems = NAV_ITEMS.map((item: any) => ({ ...item, active: item.id === active }))
    const homeEntries = isAdmin
      ? (this.data.homeEntries && this.data.homeEntries.length ? this.data.homeEntries : resolveEditorialValue(HOME_ENTRIES, this.data.editorialAssetUrls))
      : []
    this.setData({ navItems, homeEntries })
  },
  copyWechat(this: any) {
    const wxid = this.data.brand.contactWechat || ''
    if (!wxid) return
    wx.setClipboardData({ data: wxid, success: () => wx.showToast({ title: '微信号已复制', icon: 'none' }) })
  },
  callPhone(this: any) {
    const phone = this.data.brand.contactPhone || ''
    if (!phone) return
    wx.makePhoneCall({ phoneNumber: phone, fail: () => {} })
  },
  ...creationActions,
  ...sceneActions,
  ...worksActions,
})
