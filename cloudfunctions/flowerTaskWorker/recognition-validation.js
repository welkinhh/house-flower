const ALLOWED_UNITS = new Set(['支', '枝', '朵', '束', '片'])

function normalizeRecognitionResult(value) {
  if (!value || !Array.isArray(value.items)) return { result: null, error: '识花结果格式无效。' }
  const items = value.items.slice(0, 12).map((source) => {
    const item = source && typeof source === 'object' ? source : {}
    const name = String(item.name || '').trim().slice(0, 40)
    if (!name) return null
    const min = Number.isInteger(item.minimum) && item.minimum >= 1 && item.minimum <= 999 ? item.minimum : null
    const max = Number.isInteger(item.maximum) && item.maximum >= 1 && item.maximum <= 999 ? item.maximum : null
    let minimum = min
    let maximum = max
    if (minimum !== null && maximum !== null && minimum > maximum) [minimum, maximum] = [maximum, minimum]
    if (minimum === null || maximum === null) { minimum = null; maximum = null }
    const unit = ALLOWED_UNITS.has(String(item.unit || '')) ? String(item.unit) : '支'
    return {
      name,
      color: String(item.color || '').trim().slice(0, 24) || '自然色',
      minimum,
      maximum,
      unit,
      reason: String(item.reason || '').trim().slice(0, 160),
      confirmed: false,
    }
  }).filter(Boolean)
  if (!items.length) return { result: null, error: '没有识别到可确认的花材。' }
  const notes = Array.isArray(value.notes) ? value.notes.slice(0, 8).map((note) => String(note || '').slice(0, 160)) : []
  return { result: { items, notes }, error: '' }
}

module.exports = { normalizeRecognitionResult }
