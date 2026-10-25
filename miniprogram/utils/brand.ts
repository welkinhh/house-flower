// 品牌展示信息从本地配置读取；用户隐私和业务数据仍通过后端管理。

import { SHOP_BRAND_CONFIG } from './brand.config'

export type ShopBrand = {
  shopName: string
  logoAssetId: string
  logoUrl: string
  intro: string
  contactWechat: string
  contactPhone: string
  slogan: string
}

export const DEFAULT_BRAND: ShopBrand = {
  shopName: '花店名称',
  logoAssetId: '',
  logoUrl: '',
  intro: '用心挑选每一束花，把美好送到你手上',
  contactWechat: '',
  contactPhone: '',
  slogan: '把生活的点滴，一路生花',
}

export function normalizeBrand(raw: Partial<ShopBrand> | null | undefined): ShopBrand {
  const source = raw || {}
  return {
    shopName: String(source.shopName || DEFAULT_BRAND.shopName),
    logoAssetId: String(source.logoAssetId || ''),
    logoUrl: String(source.logoUrl || ''),
    intro: String(source.intro || DEFAULT_BRAND.intro),
    contactWechat: String(source.contactWechat || ''),
    contactPhone: String(source.contactPhone || ''),
    slogan: String(source.slogan || DEFAULT_BRAND.slogan),
  }
}

export function getLocalBrand(): ShopBrand {
  return normalizeBrand(SHOP_BRAND_CONFIG)
}
