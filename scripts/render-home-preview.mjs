import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets = path.join(root, 'flower-assets', 'editorial', 'cloud-ready')
const output = path.join(root, 'docs', 'assets', 'miniprogram-home-preview.png')

async function asDataUri(name) {
  const bytes = await fs.readFile(path.join(assets, name))
  return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

const [hero, inspiration, bouquet, scene] = await Promise.all([
  asDataUri('bouquet-home.jpg'),
  asDataUri('inspiration-garden.jpg'),
  asDataUri('bouquet-ivory-sample.jpg'),
  asDataUri('scene-living.jpg'),
])

const cards = [
  { x: 20, image: inspiration, title: '拾光成花', note: '喜欢的画面，变成一束花' },
  { x: 154, image: bouquet, title: '识花成单', note: '识别花材，整理清单' },
  { x: 288, image: scene, title: '花映生活', note: '把一束花放进生活' },
]

const cardSvg = cards.map((card) => `
  <g>
    <rect x="${card.x}" y="534" width="122" height="174" rx="18" fill="#fffdf9" stroke="#ece2d6"/>
    <image href="${card.image}" x="${card.x + 9}" y="543" width="104" height="104" preserveAspectRatio="xMidYMid slice" clip-path="url(#cardClip${card.x})"/>
    <text x="${card.x + 10}" y="670" class="card-title">${card.title}</text>
    <text x="${card.x + 10}" y="690" class="card-note">${card.note}</text>
  </g>`).join('')

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="430" height="932" viewBox="0 0 430 932">
  <defs>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6f1ea" stop-opacity=".74"/>
      <stop offset=".44" stop-color="#f6f1ea" stop-opacity=".02"/>
      <stop offset=".70" stop-color="#f6f1ea" stop-opacity=".76"/>
      <stop offset="1" stop-color="#f6f1ea" stop-opacity=".98"/>
    </linearGradient>
    <clipPath id="cardClip20"><rect x="29" y="543" width="104" height="104" rx="12"/></clipPath>
    <clipPath id="cardClip154"><rect x="163" y="543" width="104" height="104" rx="12"/></clipPath>
    <clipPath id="cardClip288"><rect x="297" y="543" width="104" height="104" rx="12"/></clipPath>
    <style>
      .ui { font-family: "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; fill: #3b342e; }
      .serif { font-family: "Songti SC", "Noto Serif CJK SC", serif; fill: #3b342e; }
      .card-title { font-family: "Songti SC", "Noto Serif CJK SC", serif; font-size: 15px; fill: #3b342e; }
      .card-note { font-family: "Microsoft YaHei", sans-serif; font-size: 10px; fill: #9a8b7e; }
    </style>
  </defs>
  <rect width="430" height="932" fill="#f6f1ea"/>
  <image href="${hero}" x="0" y="108" width="430" height="824" preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="108" width="430" height="824" fill="url(#veil)"/>
  <rect width="430" height="108" fill="#f8f4ee" fill-opacity=".94"/>
  <text x="26" y="30" class="ui" font-size="14">9:41</text>
  <text x="346" y="30" class="ui" font-size="13">●●●  ▰</text>
  <text x="215" y="78" class="serif" text-anchor="middle" font-size="15">花店名称</text>
  <rect x="328" y="57" width="76" height="34" rx="17" fill="#fff" stroke="#ddd8d1"/>
  <text x="351" y="79" class="ui" font-size="14">•••</text>
  <line x1="366" y1="64" x2="366" y2="84" stroke="#ded8d0"/>
  <circle cx="386" cy="74" r="7" fill="none" stroke="#3b342e" stroke-width="1.5"/>
  <text x="24" y="151" class="serif" font-size="14" letter-spacing="1">花店名称</text>
  <text x="24" y="218" class="serif" font-size="32" letter-spacing="3">把生活的点滴，</text>
  <text x="24" y="264" class="serif" font-size="32" letter-spacing="3">一路生花</text>
  <circle cx="387" cy="152" r="22" fill="#fffaf3" fill-opacity=".8"/>
  <text x="387" y="159" class="ui" text-anchor="middle" font-size="20">⚙</text>
  ${cardSvg}
  <rect x="20" y="725" width="390" height="70" rx="18" fill="#bd7d7d"/>
  <text x="40" y="754" font-family="Microsoft YaHei, sans-serif" font-size="15" fill="#fffdf9">剩余 5 次 · 个人账号免费 5 次</text>
  <text x="40" y="779" font-family="Microsoft YaHei, sans-serif" font-size="11" fill="#fffdf9" fill-opacity=".9">次数不会每日清零，用完可充值</text>
  <text x="384" y="770" font-family="Microsoft YaHei, sans-serif" text-anchor="middle" font-size="24" fill="#fffdf9">→</text>
  <rect x="0" y="820" width="430" height="72" fill="#fffdf9" fill-opacity=".96"/>
  <line x1="0" y1="820" x2="430" y2="820" stroke="#e9dfd4"/>
  <text x="137" y="858" class="ui" text-anchor="middle" font-size="12">⌂</text>
  <text x="137" y="879" class="ui" text-anchor="middle" font-size="11">首页</text>
  <text x="293" y="858" class="ui" text-anchor="middle" font-size="12">▤</text>
  <text x="293" y="879" class="ui" text-anchor="middle" font-size="11">作品集</text>
  <rect x="176" y="914" width="78" height="5" rx="3" fill="#1e1d1c"/>
</svg>`

await fs.mkdir(path.dirname(output), { recursive: true })
await sharp(Buffer.from(svg)).png().toFile(output)
process.stdout.write(`${path.relative(root, output)}\n`)
