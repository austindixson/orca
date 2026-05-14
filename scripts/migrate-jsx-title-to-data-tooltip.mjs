#!/usr/bin/env node
/**
 * Migrates DOM hover hints from `title=` to `data-tooltip=` for Orca driver.js tooltips.
 * Shields: TextShimmer / ProviderLogo opening tags (props stay `title=`).
 * Skips lines: iframe + title (a11y), Settings layout props (manual files excluded).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '../packages/client/src')

/** Files with SettingsPageHeader / mixed props — edit by hand after review. */
const EXCLUDE_FILES = new Set([
  'components/Settings/sections/AppearanceSection.tsx',
  'components/Settings/sections/AgentDataSection.tsx',
  'components/Settings/sections/IntegrationsSection.tsx',
  'components/Settings/sections/CanvasSection.tsx',
  'components/Settings/sections/ModelsSection.tsx',
  'components/Settings/ProviderSettingsPanel.tsx',
])

const PLACEHOLDER = (n) => `__TITLEPROP_${n}__`

function shieldComponentProps(text, tagName) {
  const placeholders = []
  const re = new RegExp(`<${tagName}\\b[\\s\\S]*?>`, 'g')
  const out = text.replace(re, (block) => {
    const i = placeholders.length
    placeholders.push(block)
    return PLACEHOLDER(i)
  })
  return { text: out, placeholders }
}

function unshieldComponentProps(text, placeholders) {
  let out = text
  placeholders.forEach((block, i) => {
    out = out.split(PLACEHOLDER(i)).join(block)
  })
  return out
}

function migrateLine(line) {
  const t = line.trimStart()
  if (t.includes('<iframe') && (t.includes('title=') || t.includes('data-tooltip='))) return line
  /** iframe name: often `title={title}` on its own line (see BrowserTile). */
  if (/^\s+title=\{title\}\s*$/.test(line)) return line
  if (line.includes('SettingsPageHeader')) return line
  if (line.includes('SettingsSwitchRow')) return line
  if (line.includes('SettingsAccordion')) return line
  if (/title=\{group\.title\}/.test(line)) return line
  if (/(^|\s)title=/.test(line)) return line.replace(/(\s)title=/g, '$1data-tooltip=')
  return line
}

function migrateFileContent(raw) {
  let { text, placeholders } = shieldComponentProps(raw, 'TextShimmer')
  let p2 = shieldComponentProps(text, 'ProviderLogo')
  text = p2.text
  placeholders = placeholders.concat(p2.placeholders)
  let p3 = shieldComponentProps(text, 'DeleteTilesConfirmModal')
  text = p3.text
  placeholders = placeholders.concat(p3.placeholders)

  const lines = text.split('\n')
  const migrated = lines.map(migrateLine).join('\n')

  return unshieldComponentProps(migrated, placeholders)
}

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) acc.push(p)
  }
  return acc
}

let changed = 0
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file)
  if (EXCLUDE_FILES.has(rel)) {
    console.log(`skip (excluded): ${rel}`)
    continue
  }
  const before = fs.readFileSync(file, 'utf8')
  const after = migrateFileContent(before)
  if (after !== before) {
    fs.writeFileSync(file, after)
    changed++
    console.log(rel)
  }
}
console.log(`Updated ${changed} files.`)
