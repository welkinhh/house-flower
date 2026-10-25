export type WorkKind = 'bouquet' | 'scene' | 'materials'
export type WorkRecord = {
  id: string
  kind: WorkKind
  kindLabel?: string
  category?: string
  title: string
  previewPath: string
  sourcePath?: string
  fileID?: string
  createdAt: number
  dateKey?: string
  dateLabel?: string
  sourceKey?: string
  rows?: any[]
  status?: 'draft' | 'confirmed'
  note?: string
  [key: string]: any
}
export const WORKS_KEY = 'houseflower.works'
export const PROFILE_KEY = 'houseflower.profile'
export const DEFAULT_USES = 5

// 作品集业务分类（花店门面语言）
export const DEFAULT_WORK_CATEGORY = 'bouquet'
export const PORTFOLIO_CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'bouquet', label: '花束' },
  { id: 'basket', label: '花篮' },
  { id: 'wedding', label: '婚礼' },
  { id: 'sympathy', label: '探病' },
  { id: 'opening', label: '开业' },
  { id: 'gift', label: '送礼' },
]
export const PORTFOLIO_CATEGORY_LABEL: Record<string, string> = {
  all: '全部', bouquet: '花束', basket: '花篮', wedding: '婚礼',
  sympathy: '探病', opening: '开业', gift: '送礼',
}

export function dayKey(date: Date): string {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

export function formatDateLabel(value: number): string {
  const date = new Date(Number(value) || Date.now())
  return date.getFullYear() + '.' + String(date.getMonth() + 1).padStart(2, '0') + '.' + String(date.getDate()).padStart(2, '0')
}

export function migrateMiniProgramAssetPath(value: string): string {
  return String(value || '')
    .replace(/^(\/assets\/editorial\/[a-zA-Z0-9_-]+)\.webp$/i, '$1.jpg')
    .replace(/^\/assets\/materials\/([a-zA-Z0-9_-]+)\.(?:webp|jpg)$/i, '/assets/materials-ui/$1.jpg')
}

export function kindLabel(kind: string): string {
  return kind === 'scene' ? '场景' : kind === 'materials' ? '清单' : '花束'
}

export function readWorks(): WorkRecord[] {
  try {
    const current = wx.getStorageSync(WORKS_KEY)
    if (Array.isArray(current)) {
      const migrated = current.map((work: WorkRecord) => ({
        ...work,
        previewPath: migrateMiniProgramAssetPath(work.previewPath),
        sourcePath: migrateMiniProgramAssetPath(String(work.sourcePath || '')),
        rows: Array.isArray(work.rows) ? work.rows.map((row: any) => ({ ...row, assetPath: migrateMiniProgramAssetPath(String(row.assetPath || '')) })) : work.rows,
      }))
      if (JSON.stringify(migrated) !== JSON.stringify(current)) wx.setStorageSync(WORKS_KEY, migrated)
      return migrated
    }
    const oldWorks = wx.getStorageSync('flower.works')
    const oldDownloads = wx.getStorageSync('flower.downloadedLists')
    const migrated: WorkRecord[] = []
    if (Array.isArray(oldWorks)) oldWorks.forEach((old: any) => {
      const kind: WorkKind = old.sourceType === 'scene' ? 'scene' : old.sourceType === 'replica' || old.type === 'downloaded' ? 'materials' : 'bouquet'
      const createdAt = Number(old.createdAt) || Date.now()
      migrated.push({
        ...old,
        id: String(old.id || createdAt + '-' + migrated.length),
        kind,
        title: String(old.title || (kind === 'materials' ? '花材清单' : kind === 'scene' ? '场景花作' : '一束花')),
        previewPath: String(old.previewPath || old.sourceOriginalPath || ''),
        sourcePath: String(old.sourcePath || old.sourceOriginalPath || ''),
        createdAt,
        dateKey: dayKey(new Date(createdAt)),
        status: kind === 'materials' ? 'draft' : undefined,
        rows: kind === 'materials' ? (old.rows || []).map((row: any) => ({
          ...row,
          quantityMin: row.quantityMin ?? (Number(row.quantity) || null),
          quantityMax: row.quantityMax ?? (Number(row.quantity) || null),
          quantityLabel: row.quantityLabel || '约' + Number(row.quantity || 0) + (row.unit || '支'),
          unit: row.unit || '支',
          confirmed: Boolean(row.confirmed),
        })) : old.rows,
      })
    })
    if (Array.isArray(oldDownloads)) oldDownloads.forEach((old: any) => {
      const createdAt = Number(old.createdAt) || Date.now()
      migrated.push({
        ...old, id: String(old.id || createdAt + '-' + migrated.length), kind: 'materials',
        title: String(old.title || '材料清单'), previewPath: String(old.previewPath || ''),
        createdAt, dateKey: dayKey(new Date(createdAt)), rows: old.rows || [], status: 'draft',
      })
    })
    if (migrated.length) wx.setStorageSync(WORKS_KEY, migrated)
    return migrated
  } catch { return [] }
}

export function saveWork(work: WorkRecord): WorkRecord[] {
  const current = readWorks()
  const match = work.sourceKey ? current.find((item) => item.sourceKey === work.sourceKey) : undefined
  const saved = {
    ...work,
    id: match ? match.id : work.id,
    createdAt: match ? match.createdAt : work.createdAt,
    dateKey: match ? (match.dateKey || dayKey(new Date(match.createdAt))) : (work.dateKey || dayKey(new Date(work.createdAt))),
  }
  const works = [saved, ...current.filter((item) => item.id !== saved.id)]
  wx.setStorageSync(WORKS_KEY, works)
  return works
}
