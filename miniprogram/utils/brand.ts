// 店铺品牌配置（B 端白标）。云端 shops 集合按 shopId 隔离，MVP 固定 default 单店。
// 顾客端读 brand 做门面展示；老板(isAdmin)可自助改 logo/店名/简介/联系方式。

export type ShopBrand = {
  shopId: string
  shopName: string
  logoAssetId: string
  logoUrl: string
  intro: string
  contactWechat: string
  contactPhone: string
  slogan: string
}

export const DEFAULT_SHOP_ID = 'default'

export const DEFAULT_BRAND: ShopBrand = {
  shopId: DEFAULT_SHOP_ID,
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
    shopId: String(source.shopId || DEFAULT_SHOP_ID),
    shopName: String(source.shopName || DEFAULT_BRAND.shopName),
    logoAssetId: String(source.logoAssetId || ''),
    logoUrl: String(source.logoUrl || ''),
    intro: String(source.intro || DEFAULT_BRAND.intro),
    contactWechat: String(source.contactWechat || ''),
    contactPhone: String(source.contactPhone || ''),
    slogan: String(source.slogan || DEFAULT_BRAND.slogan),
  }
}
