import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import sharp from 'sharp'

const root = process.cwd()
const assetRoot = path.join(root, 'miniprogram', 'assets', 'editorial')
const materialRoot = path.join(root, 'miniprogram', 'assets', 'materials')
const outputRoot = path.resolve(process.env.STATIC_PREVIEW_DIR || path.join(root, 'docs', 'previews'))
const imageCache = new Map()

async function imageData(file) {
  const source = (file.startsWith('material:') ? file.slice(9) : file).replace(/\.webp$/i, '.jpg')
  const resolved = path.join(file.startsWith('material:') ? materialRoot : assetRoot, source)
  if (!imageCache.has(resolved)) {
    const webp = await fs.readFile(resolved)
    const png = await sharp(webp).png().toBuffer()
    imageCache.set(resolved, 'data:image/png;base64,' + png.toString('base64'))
  }
  return imageCache.get(resolved)
}

function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

async function phone(title, draw, { nav = false, scale = 1 } = {}) {
  const body = []
  const defs = []
  const phoneId = phone.nextId++
  let clipId = 0
  const rect = (x, y, w, h, fill, radius = 0, stroke = 'none', strokeWidth = 1) => {
    body.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + radius + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"/>')
  }
  const overlay = (x, y, w, h, fill, opacity = .3) => {
    body.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" opacity="' + opacity + '"/>')
  }
  const line = (x1, y1, x2, y2, color = '#e9dfd4', width = 1) => {
    body.push('<path d="M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2 + '" fill="none" stroke="' + color + '" stroke-width="' + width + '"/>')
  }
  const text = (x, y, value, size = 10, color = '#3b342e', weight = 400, family = 'Microsoft YaHei, sans-serif', anchor = 'start') => {
    body.push('<text x="' + x + '" y="' + y + '" font-size="' + size + '" font-family="' + family + '" font-weight="' + weight + '" fill="' + color + '" text-anchor="' + anchor + '">' + esc(value) + '</text>')
  }
  const image = async (file, x, y, w, h, mode = 'cover', radius = 0) => {
    const href = await imageData(file)
    const id = 'clip' + phoneId + '-' + clipId++
    if (radius) defs.push('<clipPath id="' + id + '"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + radius + '"/></clipPath>')
    body.push('<image href="' + href + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" preserveAspectRatio="' + (mode === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice') + '"' + (radius ? ' clip-path="url(#' + id + ')"' : '') + '/>')
  }
  const button = (x, y, w, h, label, kind = 'primary', size = 9) => {
    const fill = kind === 'primary' ? '#bd7d7d' : kind === 'dark' ? '#332d29' : kind === 'disabled' ? '#e7dfd7' : '#fffdf9'
    const stroke = kind === 'outline' ? '#d8c9ba' : kind === 'disabled' ? '#e3dbd2' : 'none'
    const color = kind === 'outline' ? '#61564e' : kind === 'disabled' ? '#b2a79c' : '#fffdf9'
    rect(x, y, w, h, fill, h / 2, stroke)
    text(x + w / 2, y + h / 2 + size * .34, label, size, color, 500, 'Microsoft YaHei, sans-serif', 'middle')
  }
  const miniBar = (pageTitle, hasBack = true) => {
    rect(0, 0, 250, 25, '#faf7f2')
    text(14, 17, '9:41', 9, '#171615', 500, 'Arial, sans-serif')
    text(234, 17, '◔ ▰', 9, '#171615', 500, 'Arial, sans-serif', 'end')
    rect(83, 0, 84, 15, '#10100f', 0, '#10100f')
    rect(0, 25, 250, 35, '#faf7f2')
    text(125, 47, 'House花生', 11, '#292623', 400, 'Arial, sans-serif', 'middle')
    rect(205, 32, 34, 20, '#fff', 10, '#ddd8d1')
    text(222, 46, '•••  ◉', 8, '#252321', 500, 'Arial, sans-serif', 'middle')
    if (hasBack) {
      text(15, 100, '‹', 23, '#3b342e', 400, 'Arial, sans-serif')
      text(125, 96, pageTitle, 12, '#3b342e', 400, 'Songti SC, serif', 'middle')
      line(10, 110, 240, 110, '#e9dfd4', 1)
      return 122
    }
    return 68
  }
  const bottomNav = (active = '作品') => {
    rect(5, 520, 250, 36, '#faf7f2')
    line(5, 520, 255, 520, '#e9dfd4', 1)
    const tabs = ['首页', '灵感', '作品']
    tabs.forEach((label, i) => text(47 + i * 78, 543, (label === '首页' ? '⌂ ' : label === '灵感' ? '✧ ' : '▢ ') + label,
      8, label === active ? '#8a5f5b' : '#a99e93', label === active ? 600 : 400, 'Microsoft YaHei, sans-serif', 'middle'))
  }
  rect(0, 0, 260, 566, '#282724', 34)
  rect(5, 5, 250, 556, '#f6f1ea', 29)
  body.push('<g transform="translate(5 5)">')
  await draw({ rect, overlay, line, text, image, button, miniBar, bottomNav })
  body.push('</g>')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="566" viewBox="0 0 260 566"><defs>' + defs.join('') + '</defs>' + body.join('') + '</svg>'
  return { title, svg, scale }
}
phone.nextId = 1

async function sheet(number, title, entries) {
  const width = 1440
  const height = 710
  const scale = entries.length === 4 ? .84 : 1
  const gap = entries.length === 4 ? 18 : 28
  const itemWidth = 260 * scale
  const totalWidth = entries.length * itemWidth + (entries.length - 1) * gap
  const startX = (width - totalWidth) / 2
  const pages = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const rendered = await phone(entry.title, entry.draw, { nav: Boolean(entry.nav), scale })
    const x = startX + index * (itemWidth + gap)
    const y = 80
    pages.push('<g transform="translate(' + x + ' ' + y + ') scale(' + scale + ')">' + rendered.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') + '</g>')
    pages.push('<text x="' + (x + itemWidth / 2) + '" y="' + (y + 566 * scale + 20) + '" font-size="13" font-family="Microsoft YaHei,sans-serif" fill="#766a60" text-anchor="middle">' + (index + 1) + ' · ' + esc(entry.title) + '</text>')
    const slug = entry.title.replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    const individual = path.join(outputRoot, String(number).padStart(2, '0') + '-' + String(index + 1).padStart(2, '0') + '-' + slug + '.png')
    await sharp(Buffer.from(rendered.svg)).resize(520, 1132).png().toFile(individual)
  }
  const bg = '<rect width="' + width + '" height="' + height + '" fill="#e9e3dc"/>'
    + '<text x="46" y="39" font-size="13" font-family="Georgia,serif" letter-spacing="3" fill="#75695f">HOUSE FLOWER</text>'
    + '<text x="' + (width / 2) + '" y="43" font-size="21" font-family="Songti SC,serif" letter-spacing="3" fill="#3b342e" text-anchor="middle">' + esc(title) + '</text>'
    + '<text x="' + (width - 46) + '" y="39" font-size="11" font-family="Microsoft YaHei,sans-serif" fill="#9a8b7e" text-anchor="end">基于当前代码与项目素材 · 静态预览</text>'
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' + bg + pages.join('') + '</svg>'
  const file = path.join(outputRoot, String(number).padStart(2, '0') + '-' + title.replace(/[^\w\u4e00-\u9fff-]+/g, '-') + '.png')
  await sharp(Buffer.from(svg)).png().toFile(file)
  console.log(path.relative(root, file))
}

async function drawHome(c) {
  const y = c.miniBar('', false)
  await c.image('bouquet-home.webp', 0, y, 250, 452)
  c.overlay(0, y, 250, 95, '#f6f1ea', .42)
  c.overlay(0, y + 245, 250, 207, '#f6f1ea', .86)
  c.text(17, y + 28, 'House花生', 13, '#3b342e', 500, 'Songti SC,serif')
  c.text(17, y + 79, '把生活的点滴', 23, '#3b342e', 400, 'Songti SC,serif')
  c.text(17, y + 109, '一路生花', 23, '#3b342e', 400, 'Songti SC,serif')
  const cards = [
    ['inspiration-garden.webp', '拾光成花', '喜欢的画面变成花束'],
    ['bouquet-ivory-sample.webp', '识花成单', '识别花材，整理清单'],
    ['scene-living.webp', '花映生活', '让花束融入空间'],
  ]
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]
    const x = 10 + index * 78
    c.rect(x, y + 285, 72, 151, '#fffdf9', 8, '#e9dfd4')
    await c.image(card[0], x + 5, y + 290, 62, 82, 'cover', 5)
    c.text(x + 5, y + 389, card[1], 8, '#3b342e', 500)
    c.text(x + 5, y + 402, card[2], 6, '#9a8b7e')
    c.text(x + 52, y + 426, '→', 10, '#bd7d7d', 500)
  }
  c.bottomNav('首页')
}

async function drawInspirationInput(c) {
  const y = c.miniBar('拾光成花')
  c.text(14, y + 20, '选一张照片，变成一束花', 15, '#3b342e', 400, 'Songti SC,serif')
  c.rect(12, y + 34, 226, 76, '#fbf7f1', 10, '#d8cabc')
  c.rect(94, y + 50, 27, 27, '#fffdf9', 8, '#cfc1b3')
  c.text(107, y + 69, '＋', 20, '#8d8074', 300, 'Arial,sans-serif', 'middle')
  c.text(125, y + 92, '上传相册图片', 9, '#72665c', 400, 'Songti SC,serif', 'middle')
  c.text(13, y + 129, '灵感示例', 9, '#4c4239', 400, 'Songti SC,serif')
  const samples = [
    ['scene-living.webp', '电影海报 · 光影之外', '把画面里的柔光变成花束', 'bouquet-ivory-sample.webp'],
    ['inspiration-garden.webp', '旅行照片 · 花园漫游', '收下旅途中遇见的花园颜色', 'bouquet-peach-sample.webp'],
    ['scene-dining.webp', '音乐专辑 · 午后慢歌', '把旋律里的温柔化成花色', 'bouquet-home.webp'],
  ]
  for (let i = 0; i < samples.length; i += 1) {
    const sy = y + 137 + i * 78
    c.rect(11, sy, 228, 71, '#fffdf9', 9, '#e9dfd4')
    await c.image(samples[i][0], 16, sy + 5, 47, 60, 'cover', 6)
    c.text(69, sy + 36, '→', 13, '#bd9a91', 400, 'Georgia,serif')
    await c.image(samples[i][3], 88, sy + 5, 48, 60, 'cover', 6)
    c.text(143, sy + 29, samples[i][1], 7.5, '#4c4239', 500)
    c.text(143, sy + 44, samples[i][2], 6.2, '#9a8b7e')
  }
  c.button(12, 485, 226, 34, '变成一束花　→', 'disabled', 9)
  c.bottomNav('首页')
}

async function drawGenerationResult(c) {
  c.miniBar('', false)
  await c.image('bouquet-home.webp', 0, 60, 250, 460, 'cover')
  c.rect(13, 68, 29, 29, 'rgba(255,253,249,.92)', 15, '#ffffff')
  c.text(27, 88, '‹', 20, '#3b342e', 400, 'Arial,sans-serif', 'middle')
  c.rect(208, 68, 29, 29, 'rgba(255,253,249,.92)', 15, '#ffffff')
  c.text(222, 88, '↓', 15, '#3b342e', 400, 'Arial,sans-serif', 'middle')
  c.rect(13, 416, 224, 60, 'rgba(255,253,249,.97)', 10, '#ece2d6')
  await c.image('scene-living.webp', 19, 422, 48, 48, 'cover', 7)
  c.text(77, 443, '生活画面 · 花束', 10, '#3b342e', 500, 'Songti SC,serif')
  c.text(77, 461, '2026.09.30', 7, '#9a8b7e')
  c.button(12, 483, 109, 35, '识别花材清单', 'outline', 8)
  c.button(129, 483, 109, 35, '保存到作品集', 'primary', 8)
}

async function drawRecognitionInput(c) {
  const y = c.miniBar('识花成单')
  c.text(14, y + 21, '看看这束花用了什么花材', 14, '#3b342e', 400, 'Songti SC,serif')
  c.rect(12, y + 34, 226, 76, '#fbf7f1', 10, '#d8cabc')
  c.rect(94, y + 48, 27, 27, '#fffdf9', 8, '#cfc1b3')
  c.text(107, y + 67, '＋', 20, '#8d8074', 300, 'Arial,sans-serif', 'middle')
  c.text(125, y + 91, '上传花束照片', 9, '#72665c', 400, 'Songti SC,serif', 'middle')
  c.text(13, y + 129, '灵感示例', 9, '#4c4239', 400, 'Songti SC,serif')
  const samples = [
    ['bouquet-home.webp', '一束花', '常见手捧花材组合'],
    ['bouquet-ivory-sample.webp', '桌面插花', '花器里的层次与搭配'],
    ['bouquet-peach-sample.webp', '花篮', '丰富花材的组合示例'],
  ]
  for (let i = 0; i < samples.length; i += 1) {
    const sy = y + 137 + i * 78
    c.rect(11, sy, 228, 71, '#fffdf9', 9, '#e9dfd4')
    await c.image(samples[i][0], 17, sy + 6, 62, 59, 'cover', 6)
    c.text(89, sy + 32, samples[i][1], 9, '#4c4239', 500, 'Songti SC,serif')
    c.text(89, sy + 48, samples[i][2], 7, '#9a8b7e')
  }
  c.button(12, 485, 226, 34, '开始识别　→', 'disabled', 9)
  c.bottomNav('首页')
}

async function drawMaterialTable(c, title, demo = false) {
  const y = c.miniBar(title)
  await c.image('bouquet-home.webp', 12, y, 226, 74, 'cover', 8)
  c.text(13, y + 87, '原照片', 7, '#6b5f55')
  c.text(235, y + 87, '重新识别', 6.3, '#9a8b7e', 400, 'Microsoft YaHei,sans-serif', 'end')
  c.text(13, y + 105, demo ? '花材清单（6 种）' : '花材清单', 10, '#4c4239', 400, 'Songti SC,serif')
  c.text(235, y + 104, demo ? '估算数量 · 可确认' : '点数量可微调', 6.3, '#9a8b7e', 400, 'Microsoft YaHei,sans-serif', 'end')
  c.line(12, y + 115, 238, y + 115)
  c.text(17, y + 130, '花图', 7, '#9a8b7e')
  c.text(58, y + 130, '名称', 7, '#9a8b7e')
  c.text(134, y + 130, '颜色', 7, '#9a8b7e')
  c.text(233, y + 130, '数量', 7, '#9a8b7e', 400, 'Microsoft YaHei,sans-serif', 'end')
  const rows = [
    ['rose_001.webp', '粉色玫瑰', '粉色', '#d890a8', demo ? '约 5–7 支' : '6 支'],
    ['daisy_001.webp', '小雏菊', '白色', '#eee5d4', demo ? '约 4–6 支' : '4 支'],
    ['lisianthus_001.webp', '洋桔梗', '浅粉色', '#d890a8', demo ? '约 3–5 支' : '3 支'],
    ['greenery_003.webp', '尤加利叶', '绿色', '#789078', demo ? '约 2–4 枝' : '3 枝'],
    ['filler_001.webp', '满天星', '白色', '#eee5d4', demo ? '约 2–4 支' : '3 支'],
    ['greenery_007.webp', '喷泉草', '绿色', '#789078', demo ? '约 1–3 枝' : '2 枝'],
  ]
  for (let i = 0; i < rows.length; i += 1) {
    const ry = y + 137 + i * 37
    c.line(12, ry, 238, ry, '#eee7df')
    await c.image('material:' + rows[i][0], 15, ry + 2, 30, 36, 'contain')
    c.text(52, ry + 23, rows[i][1], 6.7, '#4c4239', 500, 'Songti SC,serif')
    c.rect(135, ry + 14, 8, 8, rows[i][3], 4)
    c.text(147, ry + 21, rows[i][2], 6.1, '#95877c')
    c.text(235, ry + 21, rows[i][4], 6.1, '#6b4f4c', 400, 'Microsoft YaHei,sans-serif', 'end')
  }
  c.button(12, 509, demo ? 226 : 108, 34, demo ? '导出清单' : '保存清单', demo ? 'primary' : 'outline', 8)
  if (!demo) c.button(130, 509, 108, 34, '导出清单', 'primary', 8)
}

async function drawSceneEditor(c) {
  const y = c.miniBar('花映生活')
  c.rect(10, y, 112, 56, '#fffdf9', 8, '#e9dfd4')
  c.rect(128, y, 112, 56, '#fffdf9', 8, '#e9dfd4')
  c.rect(16, y + 8, 38, 38, '#f4eee7', 6)
  c.text(35, y + 33, '＋', 18, '#aa9b8f', 300, 'Arial,sans-serif', 'middle')
  c.text(60, y + 24, '上传花束', 8, '#4c4239', 500)
  c.text(60, y + 38, '从相册选择', 6, '#9a8b7e')
  await c.image('scene-living.webp', 134, y + 8, 38, 38, 'cover', 6)
  c.text(178, y + 24, '更换场景图', 7.5, '#4c4239', 500)
  c.text(178, y + 38, '客厅', 6, '#9a8b7e')
  await c.image('scene-living.webp', 11, y + 66, 228, 250, 'cover', 10)
  c.text(13, y + 336, '选择空间模板', 8, '#4c4239', 400, 'Songti SC,serif')
  const rooms = ['scene-living.webp', 'scene-dining.webp', 'scene-bedroom.webp', 'scene-entryway.webp']
  const labels = ['客厅', '餐桌', '卧室', '玄关']
  for (let i = 0; i < rooms.length; i += 1) {
    const x = 12 + i * 57
    await c.image(rooms[i], x, y + 345, 50, 37, 'cover', 5)
    c.text(x + 25, y + 392, labels[i], 6.5, '#87796e', 400, 'Microsoft YaHei,sans-serif', 'middle')
  }
  c.button(12, 485, 226, 32, '生成场景效果　→', 'disabled', 8)
  c.bottomNav('首页')
}

async function drawSceneResult(c) {
  const y = c.miniBar('场景融合结果')
  await c.image('scene-living.webp', 12, y, 226, 294, 'cover', 8)
  await c.image('bouquet-peach-sample.webp', 70, y + 71, 111, 180, 'contain')
  c.text(13, y + 315, '客厅 · 花映生活', 12, '#4c4239', 400, 'Songti SC,serif')
  c.text(13, y + 333, '花束已融入所选空间，轻触图片可放大查看', 6.5, '#9a8b7e')
  c.button(12, 436, 108, 35, '重新调整', 'outline', 8)
  c.button(130, 436, 108, 35, '下载效果图', 'primary', 8)
  c.button(12, 480, 226, 33, '保存到作品集', 'outline', 8)
}

async function drawGallery(c) {
  const y = c.miniBar('', false)
  c.text(13, y + 19, '灵感', 16, '#3b342e', 400, 'Songti SC,serif')
  await c.image('inspiration-garden.webp', 12, y + 27, 226, 86, 'cover', 8)
  c.overlay(12, y + 76, 226, 37, '#322923', .55)
  c.text(20, y + 97, '花园里的春日', 12, '#fffdf9', 500, 'Songti SC,serif')
  c.text(20, y + 108, '四季的温柔，都藏在花里', 6.5, '#f6efe7')
  const tabs = ['全部', '电影', '音乐', '绘画', '摄影', '自然', '季节', '色彩']
  tabs.forEach((label, i) => {
    const x = 12 + i * 28.2
    c.text(x + 10, y + 133, label, 6.3, i === 0 ? '#3b342e' : '#9a8b7e', i === 0 ? 600 : 400, 'Microsoft YaHei,sans-serif', 'middle')
    if (i === 0) c.rect(x + 2, y + 139, 17, 2, '#3b342e', 1)
  })
  const tiles = [
    ['inspiration-garden.webp', '花园里的春日', '季节'],
    ['bouquet-peach-sample.webp', '午后阳光', '季节'],
    ['bouquet-ivory-sample.webp', '春日来信', '季节'],
    ['scene-living.webp', '窗边日光', '摄影'],
    ['scene-dining.webp', '餐桌漫游', '摄影'],
    ['scene-entryway.webp', '归家一刻', '摄影'],
    ['bouquet-home.webp', '柔粉的告白', '色彩'],
    ['scene-bedroom.webp', '夜曲与花', '音乐'],
    ['bouquet-ivory-sample.webp', '白色诗意', '自然'],
  ]
  for (let i = 0; i < tiles.length; i += 1) {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 12 + col * 77
    const ty = y + 148 + row * 88
    c.rect(x, ty, 70, 83, '#fffdf9', 6, '#e9dfd4')
    await c.image(tiles[i][0], x + 4, ty + 4, 62, 56, 'cover', 4)
    c.text(x + 5, ty + 70, tiles[i][1], 6.4, '#4c4239', 400, 'Songti SC,serif')
    c.text(x + 5, ty + 80, tiles[i][2], 5.7, '#a3948a')
  }
  c.bottomNav('灵感')
}

async function drawGalleryDetail(c) {
  const y = c.miniBar('', false)
  await c.image('inspiration-garden.webp', 0, y, 250, 452, 'cover')
  c.overlay(0, y, 250, 452, '#302923', .5)
  c.rect(13, y + 16, 224, 420, '#faf7f1', 13)
  await c.image('bouquet-ivory-sample.webp', 13, y + 16, 224, 265, 'cover', 12)
  c.text(26, y + 305, '季节 · 灵感花束', 7, '#bd7d7d', 500)
  c.text(26, y + 328, '花园里的春日', 14, '#3b342e', 500, 'Songti SC,serif')
  c.text(26, y + 347, '浅粉花影与灰绿色叶片交织，', 7, '#8a7c6f')
  c.text(26, y + 360, '像晨光刚刚落进花园。', 7, '#8a7c6f')
  c.button(21, y + 385, 97, 34, '以此生花', 'outline', 8)
  c.button(126, y + 385, 102, 34, '保存到作品集', 'primary', 7)
}

async function drawWorks(c) {
  const y = c.miniBar('', false)
  await c.image('bouquet-home.webp', 12, y + 9, 38, 38, 'cover', 19)
  c.text(57, y + 25, '花生用户', 9, '#3b342e', 500, 'Songti SC,serif')
  c.text(57, y + 39, 'ID 0001', 6.5, '#a3948a')
  c.text(236, y + 20, '今日剩余次数', 5.5, '#9a8b7e', 400, 'Microsoft YaHei,sans-serif', 'end')
  c.text(236, y + 40, '10', 15, '#3b342e', 400, 'Georgia,serif', 'end')
  c.line(12, y + 56, 238, y + 56)
  c.text(73, y + 75, '作品集', 8, '#3b342e', 600, 'Microsoft YaHei,sans-serif', 'middle')
  c.text(181, y + 75, '花历', 8, '#9a8b7e', 400, 'Microsoft YaHei,sans-serif', 'middle')
  c.line(44, y + 83, 102, y + 83, '#3b342e', 2)
  const tiles = [
    ['bouquet-ivory-sample.webp', '柔粉的告白', '2026.09.27'], ['bouquet-peach-sample.webp', '春日来信', '2026.09.21'], ['bouquet-home.webp', '午后阳光', '2026.09.14'],
    ['inspiration-garden.webp', '一帧安静', '2026.09.06'], ['scene-living.webp', '窗边的春日', '2026.08.30'],
  ]
  for (let i = 0; i < tiles.length; i += 1) {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 12 + col * 77
    const ty = y + 91 + row * 103
    await c.image(tiles[i][0], x, ty, 70, 90, 'cover', 6)
    c.overlay(x, ty + 54, 70, 36, '#332821', .48)
    c.text(x + 5, ty + 76, tiles[i][1], 6.1, '#fffdf9', 400, 'Songti SC,serif')
    c.text(x + 5, ty + 85, tiles[i][2], 5.2, '#f1e9e0', 400, 'Microsoft YaHei,sans-serif')
  }
  c.bottomNav('作品')
}

async function drawCalendar(c) {
  const y = c.miniBar('', false)
  await c.image('bouquet-home.webp', 12, y + 9, 38, 38, 'cover', 19)
  c.text(57, y + 25, '花生用户', 9, '#3b342e', 500, 'Songti SC,serif')
  c.text(57, y + 39, 'ID 0001', 6.5, '#a3948a')
  c.text(236, y + 20, '今日剩余次数', 5.5, '#9a8b7e', 400, 'Microsoft YaHei,sans-serif', 'end')
  c.text(236, y + 40, '10', 15, '#3b342e', 400, 'Georgia,serif', 'end')
  c.line(12, y + 56, 238, y + 56)
  c.text(73, y + 75, '作品集', 8, '#9a8b7e', 400, 'Microsoft YaHei,sans-serif', 'middle')
  c.text(181, y + 75, '花历', 8, '#3b342e', 600, 'Microsoft YaHei,sans-serif', 'middle')
  c.line(152, y + 83, 209, y + 83, '#3b342e', 2)
  c.text(29, y + 106, '‹', 12, '#8a7c6f')
  c.text(125, y + 106, '2026年　9月⌄', 10, '#3b342e', 500, 'Songti SC,serif', 'middle')
  c.text(221, y + 106, '›', 12, '#8a7c6f')
  const week = ['日', '一', '二', '三', '四', '五', '六']
  week.forEach((d, i) => c.text(28 + i * 32, y + 126, d, 6, '#b3a497', 400, 'Microsoft YaHei,sans-serif', 'middle'))
  const dates = ['', '', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30']
  for (let i = 0; i < 35; i += 1) {
    const row = Math.floor(i / 7), col = i % 7
    const x = 28 + col * 32, dy = y + 145 + row * 25
    if (i === 31) c.rect(x - 10, dy - 13, 20, 20, '#bd7d7d', 10)
    const label = dates[i] || ''
    c.text(x, dy, label, 7.5, i === 31 ? '#fffdf9' : '#796f65', 400, 'Georgia,serif', 'middle')
    if ([7, 15, 22, 28].includes(i)) c.rect(x - 2, dy + 4, 4, 4, '#bd7d7d', 2)
  }
  c.line(12, y + 274, 238, y + 274)
  c.text(13, y + 291, '接下来的日子', 9, '#4c4239', 500, 'Songti SC,serif')
  c.text(236, y + 291, '+ 添加', 7, '#a96663', 400, 'Microsoft YaHei,sans-serif', 'end')
  c.text(15, y + 310, '还没有提醒的日子，点「添加」记录', 6.5, '#a3948a')
  c.line(12, y + 339, 238, y + 339)
  c.text(14, y + 357, '9 月 30 日的作品', 8, '#4c4239', 400, 'Songti SC,serif')
  c.text(14, y + 382, '这一天还没有保存作品', 6.5, '#a3948a')
  c.bottomNav('作品')
}

async function drawProfile(c) {
  const y = c.miniBar('设置')
  c.rect(12, y, 226, 340, '#fffdf9', 12, '#e9dfd4')
  await c.image('bouquet-home.webp', 24, y + 17, 70, 70, 'cover', 35)
  c.text(24, y + 100, '点头像可更换头像', 7, '#b3a497')
  c.line(22, y + 120, 228, y + 120)
  c.text(24, y + 142, '名称', 8, '#9a8b7e')
  c.text(72, y + 142, '花生用户', 9, '#4c4239', 500)
  c.line(22, y + 154, 228, y + 154)
  c.text(24, y + 178, 'ID', 8, '#9a8b7e')
  c.text(72, y + 178, '0001', 9, '#4c4239', 500)
  c.line(22, y + 190, 228, y + 190)
  c.text(24, y + 217, '意见反馈', 8, '#4c4239')
  c.text(222, y + 217, '›', 15, '#b3a497', 400, 'Arial,sans-serif', 'end')
  c.line(22, y + 230, 228, y + 230)
  c.button(22, y + 260, 206, 36, '保存', 'primary', 9)
}

const sheets = [
  { n: 1, title: '创作流程', pages: [
    { title: '首页', draw: drawHome, nav: true },
    { title: '拾光成花', draw: drawInspirationInput, nav: true },
    { title: '成品展示', draw: drawGenerationResult },
  ] },
  { n: 2, title: '识花与清单', pages: [
    { title: '识花成单', draw: drawRecognitionInput, nav: true },
    { title: '估算清单', draw: (c) => drawMaterialTable(c, '识花成单', true) },
    { title: '已保存清单', draw: (c) => drawMaterialTable(c, '作品 · 花材清单', false) },
  ] },
  { n: 3, title: '场景与灵感', pages: [
    { title: '场景融合', draw: drawSceneEditor },
    { title: '场景成品', draw: drawSceneResult },
    { title: '灵感三列卡片', draw: drawGallery, nav: true },
  ] },
  { n: 4, title: '作品与记录', pages: [
    { title: '灵感详情', draw: drawGalleryDetail },
    { title: '作品集', draw: drawWorks, nav: true },
    { title: '花历', draw: drawCalendar, nav: true },
    { title: '个人资料', draw: drawProfile, nav: true },
  ] },
]

await fs.mkdir(outputRoot, { recursive: true })
for (const item of sheets) await sheet(item.n, item.title, item.pages)
