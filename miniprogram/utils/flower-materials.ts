import { FLOWER_MATERIALS, type FlowerMaterial } from '../data/flower-catalog'
import { migrateMiniProgramAssetPath } from './houseflower-data'

const MATERIAL_ALIASES: Array<{ prefix: string; aliases: string[] }> = [
  { prefix: 'greenery_', aliases: ['尤加利', '叶材', '绿叶', '桉叶'] },
  { prefix: 'filler_', aliases: ['配花', '满天星', '补花'] },
  { prefix: 'packaging_', aliases: ['包装纸', '包花纸', '包装', '丝带', '缎带'] },
]

function normalizeName(value: string): string {
  return String(value || '').replace(/[\s\d._-]/g, '')
}

export function flowerAssetForName(name: string): FlowerMaterial | undefined {
  const normalized = normalizeName(name)
  if (!normalized) return undefined

  let selected: FlowerMaterial | undefined
  if (normalized.includes('玫瑰') && /(粉|浅)/.test(normalized)) {
    selected = FLOWER_MATERIALS.find((item) => item.id === 'rose_002')
  } else if (normalized.includes('玫瑰') && /(红|深)/.test(normalized)) {
    selected = FLOWER_MATERIALS.find((item) => item.id === 'rose_001')
  }

  if (!selected) {
    const alias = MATERIAL_ALIASES.find((group) => group.aliases.some((value) => normalized.includes(normalizeName(value))))
    if (alias) selected = FLOWER_MATERIALS.find((item) => item.id.startsWith(alias.prefix))
  }

  if (!selected) {
    selected = FLOWER_MATERIALS.find((item) => {
      const candidate = normalizeName(item.name)
      return candidate.length >= 2 && (normalized.includes(candidate) || candidate.includes(normalized))
    })
  }
  return selected ? { ...selected, assetPath: migrateMiniProgramAssetPath(selected.assetPath) } : undefined
}
