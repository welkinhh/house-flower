/**
 * Recharge catalogue and order helpers.
 *
 * Payment credentials are intentionally NOT configured here. WeChat Pay requires
 * a verified business licence, so `paymentEnabled` stays false until an mchid is
 * supplied through the environment. Orders can still be created and inspected,
 * which keeps the whole purchase flow testable before the merchant account
 * exists. No order is ever marked paid without an explicit confirmation that
 * carries a verified transaction id.
 */

// Amounts are stored in fen (1 yuan = 100 fen) so no float ever reaches WeChat.
const RECHARGE_PLANS = [
  { id: 'p10', label: '10 次', uses: 10, amountFen: 990, badge: '' },
  { id: 'p30', label: '30 次', uses: 30, amountFen: 1990, badge: '最受欢迎' },
  { id: 'p120', label: '120 次', uses: 120, amountFen: 5990, badge: '单价最低' },
]

const RECHARGE_PLAN_IDS = RECHARGE_PLANS.map((plan) => plan.id)

function findRechargePlan(planId) {
  const id = String(planId || '').trim()
  return RECHARGE_PLANS.find((plan) => plan.id === id) || null
}

// Filled in only after a business licence is available. Until then the client
// renders an explicit "payment not enabled" state instead of faking success.
function paymentEnabled() {
  return Boolean(String(process.env.RECHARGE_MCH_ID || '').trim())
}

function paymentConfig() {
  const enabled = paymentEnabled()
  return {
    enabled,
    mchId: enabled ? String(process.env.RECHARGE_MCH_ID || '').trim() : '',
    notice: enabled
      ? ''
      : '充值收款尚未开通，请先联系店主。开通后此处可直接购买次数，无需更换小程序。',
  }
}

function orderId() {
  return `order_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`
}

function toPublicPlan(plan) {
  return {
    id: plan.id,
    label: plan.label,
    uses: plan.uses,
    amountFen: plan.amountFen,
    amountYuan: (plan.amountFen / 100).toFixed(2).replace(/\.00$/, ''),
    badge: plan.badge,
    unitPrice: Number((plan.amountFen / 100 / plan.uses).toFixed(3)),
  }
}

const ORDER_STATUS_LABELS = {
  pending: '待支付',
  paid: '已支付待到账',
  credited: '已到账',
  refunded: '已退款',
  closed: '已关闭',
}

function publicOrder(order) {
  const status = String(order.status || 'pending')
  return {
    orderId: order.orderId,
    planId: order.planId,
    planLabel: order.planLabel,
    uses: order.uses,
    amountFen: order.amountFen,
    amountYuan: (Number(order.amountFen || 0) / 100).toFixed(2).replace(/\.00$/, ''),
    status,
    statusLabel: status === 'credited' ? `已到账 ${Number(order.creditedUses) || order.uses} 次` : (ORDER_STATUS_LABELS[status] || status),
    creditedUses: Number(order.creditedUses) || 0,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
  }
}

module.exports = {
  RECHARGE_PLANS,
  RECHARGE_PLAN_IDS,
  findRechargePlan,
  paymentEnabled,
  paymentConfig,
  orderId,
  toPublicPlan,
  publicOrder,
}
