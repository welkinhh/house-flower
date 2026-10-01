import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const sourceRoot = path.join(projectRoot, 'miniprogram')
const appConfigPath = path.join(sourceRoot, 'app.json')
const problems = []

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    problems.push('Cannot read ' + path.relative(projectRoot, filePath) + ': ' + error.message)
    return {}
  }
}

function walk(directory, predicate, files = []) {
  if (!fs.existsSync(directory)) return files
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'miniprogram_npm') continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(fullPath, predicate, files)
    else if (predicate(fullPath)) files.push(fullPath)
  }
  return files
}

function resolveLocalImport(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request)
  const candidates = [
    base, base + '.ts', base + '.js', base + '.json', base + '.wxs',
    path.join(base, 'index.ts'), path.join(base, 'index.js'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate))
}

const appConfig = readJson(appConfigPath)
let routeCount = 0
let subpackageRouteCount = 0
for (const route of appConfig.pages || []) {
  const pageBase = path.join(sourceRoot, route)
  const scriptExists = fs.existsSync(pageBase + '.ts') || fs.existsSync(pageBase + '.js')
  for (const extension of ['.wxml', '.wxss']) {
    if (!fs.existsSync(pageBase + extension)) {
      problems.push('App route "' + route + '" is missing ' + extension)
    }
  }
  if (!scriptExists) problems.push('App route "' + route + '" is missing its .ts/.js script')
  if (scriptExists) routeCount += 1
}
for (const subpackage of appConfig.subPackages || appConfig.subpackages || []) {
  for (const route of subpackage.pages || []) {
    const pageBase = path.join(sourceRoot, subpackage.root, route)
    const scriptExists = fs.existsSync(pageBase + '.ts') || fs.existsSync(pageBase + '.js')
    for (const extension of ['.wxml', '.wxss']) {
      if (!fs.existsSync(pageBase + extension)) {
        problems.push('Subpackage route "' + subpackage.root + '/' + route + '" is missing ' + extension)
      }
    }
    if (!fs.existsSync(pageBase + '.json')) {
      problems.push('Subpackage route "' + subpackage.root + '/' + route + '" is missing .json')
    }
    if (!scriptExists) problems.push('Subpackage route "' + subpackage.root + '/' + route + '" is missing its .ts/.js script')
    if (scriptExists) subpackageRouteCount += 1
  }
}

const sourceFiles = walk(sourceRoot, (file) => file.endsWith('.ts'))
const sourceText = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
let importCount = 0
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8')
  const imports = text.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)
  for (const match of imports) {
    const request = match[1]
    if (!request.startsWith('.')) continue
    importCount += 1
    if (!resolveLocalImport(file, request)) {
      problems.push(path.relative(projectRoot, file) + ' imports missing module "' + request + '"')
    }
  }
}

const templatePath = path.join(sourceRoot, 'pages/flower/index.wxml')
if (fs.existsSync(templatePath)) {
  const template = fs.readFileSync(templatePath, 'utf8')
  const handlers = new Set()
  for (const match of template.matchAll(/\b(?:bind|catch)[a-z]+="([A-Za-z_$][A-Za-z0-9_$]*)"/g)) {
    handlers.add(match[1])
  }
  const missingHandlers = [...handlers].filter((name) => !new RegExp('(?:^|\\n)\\s*(?:async\\s+)?' + name + '\\s*\\(').test(sourceText))
  for (const name of missingHandlers) {
    problems.push('WXML event "' + name + '" has no matching page/action handler')
  }
  if (problems.length === 0) {
    console.log('Mini Program structure OK: ' + routeCount + ' app route, ' + subpackageRouteCount + ' subpackage routes, ' + importCount + ' local imports, ' + handlers.size + ' WXML handlers.')
  }
} else {
  problems.push('Missing miniprogram/pages/flower/index.wxml')
}

if (problems.length > 0) {
  for (const problem of problems) console.error('ERROR: ' + problem)
  process.exitCode = 1
}
