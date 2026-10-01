const ALLOWED_UNITS = new Set(['支', '枝', '朵', '束', '片'])

function normalizeMaterialRows(value) {
  if (!Array.isArray(value)) return { rows: [], error: '' }
  if (value.length > 60) return { rows: [], error: '花材清单最多包含 60 项。' }
  const rows = []
  for (const source of value) {
    const row = source && typeof source === 'object' ? source : {}
    const name = String(row.name || '').trim().slice(0, 40)
    if (!name) return { rows: [], error: '花材名称不能为空。' }
    const lowValue = Number.isInteger(row.quantityMin) && row.quantityMin >= 1 && row.quantityMin <= 999 ? row.quantityMin : null
    const highValue = Number.isInteger(row.quantityMax) && row.quantityMax >= 1 && row.quantityMax <= 999 ? row.quantityMax : null
    let minimum = lowValue
    let maximum = highValue
    if (minimum !== null && maximum !== null && minimum > maximum) [minimum, maximum] = [maximum, minimum]
    if (minimum === null || maximum === null) { minimum = null; maximum = null }
    const quantity = Number(row.quantity)
    const confirmed = Boolean(row.confirmed) && Number.isInteger(quantity) && quantity >= 1 && quantity <= 999
    const unit = ALLOWED_UNITS.has(String(row.unit || '')) ? String(row.unit) : '支'
    rows.push({
      id: String(row.id || '').slice(0, 80),
      name,
      colorLabel: String(row.colorLabel || '自然色').trim().slice(0, 24) || '自然色',
      quantityMin: minimum,
      quantityMax: maximum,
      quantityLabel: minimum !== null ? `约${minimum}–${maximum}${unit}` : '数量待确认',
      quantity: confirmed ? quantity : null,
      unit,
      confirmed,
      assetPath: /^\/assets\/(?:materials|materials-ui)\/[a-zA-Z0-9_-]+\.jpg$/.test(String(row.assetPath || '')) ? String(row.assetPath) : '',
      swatch: /^#[0-9a-fA-F]{6}$/.test(String(row.swatch || '')) ? String(row.swatch) : '#d7c2b8',
    })
  }
  return { rows, error: '' }
}

module.exports = { normalizeMaterialRows }
