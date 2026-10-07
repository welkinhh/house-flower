/** Public CloudBase environment id; credentials remain server-side. */
export const CLOUDBASE_ENV_ID = 'huasheng-d1gevhc4b9cc370ca'

/** The single business entry point used by the first backend rollout. */
export const BACKEND_FUNCTION_NAME = 'flowerBackend'

/** Hunyuan image generation is available; image recognition stays model-gated. */
export const AI_RESOURCES_ENABLED = true
export const AI_VISION_ENABLED = false

/**
 * Free generations are granted once per account and never reset daily:
 * 5 for a personal account, 30 for a shop account. Everything beyond that is
 * bought through the recharge packs below. The daily allowance stays at 0 so the
 * permanent bucket is the only source of remaining uses.
 */
export const DAILY_AI_QUOTA_LIMIT = 0
export const WELCOME_QUOTA_PERSONAL = 5
export const WELCOME_QUOTA_SHOP = 30

/**
 * Recharge packs, mirrored from cloudfunctions/flowerBackend/recharge.js.
 * Amounts are in fen so no float ever reaches the payment API.
 */
export type RechargePlan = {
  id: string
  label: string
  uses: number
  amountFen: number
  badge: string
  unitPrice: number
}

export const RECHARGE_PLANS: RechargePlan[] = [
  { id: 'p10', label: '10 次', uses: 10, amountFen: 990, badge: '', unitPrice: 0.99 },
  { id: 'p30', label: '30 次', uses: 30, amountFen: 1990, badge: '最受欢迎', unitPrice: 0.663 },
  { id: 'p120', label: '120 次', uses: 120, amountFen: 5990, badge: '单价最低', unitPrice: 0.499 },
]

/** Seeded works are useful for visual review only; production starts empty. */
export const LOCAL_DEMO_MODE = false
