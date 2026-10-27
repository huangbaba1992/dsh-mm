// dsh-local-memory — 共享的常量、配置归一化、Markdown 与文件工具（Host 半内部模块）
import { readFileSync, statSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'

/* ---------------- 预算与上限 ---------------- */

/** soul 注入预算（字符数，按 UTF-16 计）。 */
export const SOUL_CAP = 4096
/** 单文件完整读取上限。 */
export const DOC_CAP = 64 * 1024
/** 搜索时单文件读取上限。 */
export const SEARCH_CAP = 128 * 1024
export const SEARCH_FILES = 200
export const LIST_FILES = 500
export const MAX_HITS = 20
export const CONCURRENCY = 16
export const CACHE_BYTES = 1 << 20
/** 提炼单次输入上限（字符）。 */
export const DISTILL_TOTAL_CHARS = 48 * 1024
/** 积压达到该字节数时提前提炼。 */
export const DISTILL_PENDING_BYTES = 16 * 1024
/** Web 编辑器单文件上限。 */
export const MAX_EDIT_BYTES = 256 * 1024

export const DOC_RE = /\.(md|txt)$/i
export const SKIP = new Set(['node_modules', '.git', '.obsidian', 'backups', 'trash'])

/** 主题文件统一放在一个目录里，分型由 frontmatter 的 type 字段表达。 */
export const TOPIC_DIR = 'topics'
export const TRASH_DIR = '.trash'
export const BACKUP_DIR = 'backups'
export const INBOX_DIR = 'inbox'
export const ARCHIVE_DIR = 'archive'

/** 合法的主题类型（frontmatter.type）。 */
export const MEMORY_TYPES = ['person', 'project', 'decision', 'preference', 'lesson', 'note']

/** 类型 → 界面分组。 */
export const TYPE_GROUP = {
  person: 'people',
  project: 'projects',
  decision: 'decisions',
  preference: 'preferences',
  lesson: 'lessons',
  note: 'notes'
}

/** 界面分组 → 类型（新建主题时用）。 */
export const GROUP_TYPE = {
  people: 'person',
  projects: 'project',
  decisions: 'decision',
  preferences: 'preference',
  lessons: 'lesson',
  notes: 'note'
}

/** 界面分组顺序（“other” 收纳未知/缺失类型）。 */
export const GROUPS = ['people', 'projects', 'decisions', 'preferences', 'lessons', 'notes', 'other']

/** 旧版分型目录 → 类型（迁移用）。 */
export const TYPE_NAME = {
  people: 'person',
  projects: 'project',
  decisions: 'decision',
  preferences: 'preference',
  lessons: 'lesson'
}

/* ---------------- 配置 ---------------- */

const RESERVED_NAMES = new Set(['', '.', '..'])

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  dir: '',
  compact: {
    enabled: false,
    everyHours: 24,
    provider: '',
    model: '',
    minFileBytes: 2048,
    maxInputBytes: 32768,
    maxFilesPerRun: 5,
    removeExactDuplicates: true,
    backupBeforeRun: true,
    lastRunAt: 0,
    lastResult: null
  },
  distill: {
    enabled: true,
    minPendingKB: 16,
    idleMinutes: 30,
    lastRunAt: 0,
    lastResult: null
  },
  capture: {
    enabled: true,
    maxChars: 1500
  },
  trash: {
    keepDays: 30
  },
  backup: {
    keep: 10
  }
})

const clamp = (value, min, max, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

export const str = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback)

/** 文件名只允许纯文件名：带斜杠、点目录等坏配置一律回退默认值，避免运行期抛错。 */
export function fileName(value, fallback) {
  const name = str(value)
  return RESERVED_NAMES.has(name) || name.includes('/') || name.includes('\\') ? fallback : name
}

/** 带默认值与范围限制的配置归一化；兼容 0.2 的旧字段。 */
export function sanitizeSettings(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const compact = input.compact ?? {}
  const distill = input.distill ?? {}
  const capture = input.capture ?? {}
  const trash = input.trash ?? {}
  const backup = input.backup ?? {}
  const legacyDistill = compact.lastDistill ?? null
  const legacyIdle = capture.idleMinutes
  return {
    version: 1,
    dir: str(input.dir),
    compact: {
      enabled: compact.enabled === true,
      everyHours: clamp(compact.everyHours, 1, 24 * 30, DEFAULT_SETTINGS.compact.everyHours),
      provider: str(compact.provider),
      model: str(compact.model),
      minFileBytes: clamp(compact.minFileBytes, 256, 1 << 20, DEFAULT_SETTINGS.compact.minFileBytes),
      maxInputBytes: clamp(compact.maxInputBytes, 1024, 512 * 1024, DEFAULT_SETTINGS.compact.maxInputBytes),
      maxFilesPerRun: clamp(compact.maxFilesPerRun, 1, 50, DEFAULT_SETTINGS.compact.maxFilesPerRun),
      removeExactDuplicates: compact.removeExactDuplicates !== false,
      backupBeforeRun: compact.backupBeforeRun !== false,
      lastRunAt: clamp(compact.lastRunAt, 0, Number.MAX_SAFE_INTEGER, 0),
      lastResult: compact.lastResult ?? null
    },
    distill: {
      enabled: distill.enabled !== false,
      minPendingKB: clamp(distill.minPendingKB, 1, 1024, DEFAULT_SETTINGS.distill.minPendingKB),
      idleMinutes: clamp(distill.idleMinutes ?? legacyIdle, 5, 24 * 60, DEFAULT_SETTINGS.distill.idleMinutes),
      lastRunAt: clamp(distill.lastRunAt ?? legacyDistill?.at, 0, Number.MAX_SAFE_INTEGER, 0),
      lastResult: distill.lastResult ?? legacyDistill ?? null
    },
    capture: {
      enabled: capture.enabled !== false,
      maxChars: clamp(capture.maxChars, 200, 8000, DEFAULT_SETTINGS.capture.maxChars)
    },
    trash: {
      keepDays: clamp(trash.keepDays, 1, 365, DEFAULT_SETTINGS.trash.keepDays)
    },
    backup: {
      keep: clamp(backup.keep, 1, 50, DEFAULT_SETTINGS.backup.keep)
    }
  }
}

/** 0.2 的插件 Config（dir/soulFile/memoryFile/maxMemoryBytes）。 */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const max = Number(input.maxMemoryBytes)
  return {
    dir: typeof input.dir === 'string' ? input.dir : '',
    soulFile: fileName(input.soulFile, 'soul.md'),
    memoryFile: fileName(input.memoryFile, 'MEMORY.md'),
    maxMemoryBytes: Number.isFinite(max) ? Math.min(Math.max(max, 256), 1 << 20) : 4096
  }
}

/* ---------------- 路径 ---------------- */

/** 展开 ~，得出绝对根目录。 */
export function rootOf(dir) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const raw = (dir ?? '').trim() || join(home, 'memory')
  const full = raw === '~' ? homedir() : raw.startsWith('~' + sep) ? join(homedir(), raw.slice(2)) : raw
  return isAbsolute(full) ? full : resolve(full)
}

/** 相对路径限制在根目录内。 */
export function inside(root, rel) {
  const target = resolve(root, rel)
  if (target !== root && !target.startsWith(root + sep)) throw new Error(`path escapes memory root: ${rel}`)
  return target
}

/** 相对根目录的展示路径（统一用 /）。 */
export function relativeOf(root, file) {
  if (file === root) return '.'
  return file.slice(root.length + 1).split(sep).join('/')
}

/** 路径是否是某个目录本身或其后代（统一 / 分隔）。 */
export function isUnder(rel, dir) {
  return rel === dir || rel.startsWith(dir + '/')
}

/** 把用户输入的名字收敛成安全的文件名（不含扩展名）。 */
export function slugify(name) {
  const raw = str(name).replace(/\.md$/i, '')
  const cleaned = raw
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 64)
  return cleaned === '' ? '' : cleaned
}

/** 文件名是否可用作主题文件（不带目录）。 */
export function safeTopicFile(name) {
  const value = str(name)
  if (value === '' || value.length > 80 || value.startsWith('.')) return false
  if (!/^[\p{L}\p{N}._-]+\.md$/u.test(value)) return false
  return true
}

/**
 * 模型给出的主题路径 → 归一化路径与类型。
 * 接受 `topics/x.md`、旧分型目录 `people/x.md`，以及裸文件名 `x.md`（落到 topics/）。
 * @param {string} raw
 * @param {Set<string>} reserved 禁止的文件名/目录名（小写）
 * @returns {{path: string, type: string}|undefined}
 */
export function safeTopicPath(raw, reserved) {
  const value = str(raw).replace(/^\.\//, '')
  if (value === '' || value.length > 160 || value.startsWith('/') || value.startsWith('~')) return undefined
  if (value.includes('..') || value.includes('\\')) return undefined
  const segments = value.split('/')
  if (segments.length > 2) return undefined
  const file = segments[segments.length - 1]
  if (!safeTopicFile(file)) return undefined
  const base = file.replace(/\.md$/i, '').toLowerCase()
  if (reserved.has(base) || reserved.has(file.toLowerCase())) return undefined
  let type = 'note'
  if (segments.length === 2) {
    const folder = segments[0].toLowerCase()
    if (reserved.has(folder) || folder === 'inbox' || folder === 'archive' || folder === 'backups' || folder === 'trash') return undefined
    if (folder !== TOPIC_DIR) {
      const legacy = TYPE_NAME[folder]
      if (legacy === undefined) return undefined
      type = legacy
    }
  }
  return { path: `${TOPIC_DIR}/${file}`, type }
}

/**
 * 写文件（memory 工具 / Web 编辑器）的路径白名单。
 * 只允许 soul、MEMORY 与 topics/*.md；其余目录由插件自己管理。
 * @param {string} raw 用户给的相对路径
 * @param {{soulFile: string, memoryFile: string}} names
 * @returns {{path: string, type: string, isTopic: boolean}}
 */
export function writablePath(raw, names) {
  const value = str(raw).replace(/^\.\//, '')
  if (value === '' || value.length > 160 || value.startsWith('/') || value.startsWith('~') || value.includes('..') || value.includes('\\')) {
    throw new Error(`invalid memory path: ${raw}`)
  }
  const normalized = value.replace(/\\/g, '/')
  if (normalized === names.soulFile || normalized === names.memoryFile) {
    return { path: normalized, type: '', isTopic: false }
  }
  const segments = normalized.split('/')
  if (segments.length > 2) throw new Error(`only topics/<name>.md is writable: ${raw}`)
  const file = segments[segments.length - 1]
  if (!safeTopicFile(file)) throw new Error(`invalid memory file name: ${raw}`)
  const reserved = [names.soulFile, names.memoryFile].map((name) => name.toLowerCase())
  if (reserved.includes(file.toLowerCase())) throw new Error(`reserved memory file name: ${raw}`)
  let type = 'note'
  if (segments.length === 2) {
    const folder = segments[0].toLowerCase()
    if (folder === TOPIC_DIR) type = 'note'
    else if (TYPE_NAME[folder] !== undefined) type = TYPE_NAME[folder]
    else throw new Error(`only ${TOPIC_DIR}/ is writable: ${raw}`)
  }
  return { path: `${TOPIC_DIR}/${file}`, type, isTopic: true }
}

/* ---------------- 设置（frontmatter） ---------------- */

/** 解析 YAML 风格的简单 frontmatter（key: value 单行，支持 CRLF 与引号）。 */
export function parseFrontmatter(text) {
  const normalized = String(text).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized)
  if (match === null) return { data: {}, body: normalized }
  const data = {}
  let lastKey
  for (const line of match[1].split('\n')) {
    if (line.trim() === '') continue
    const at = line.indexOf(':')
    if (at <= 0) {
      if (lastKey !== undefined && /^\s+/.test(line)) {
        data[lastKey] = `${data[lastKey]} ${line.trim()}`.trim()
      }
      continue
    }
    const key = line.slice(0, at).trim()
    if (key === '') continue
    let value = line.slice(at + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    data[key] = value
    lastKey = key
  }
  return { data, body: normalized.slice(match[0].length) }
}

const FRONTMATTER_ORDER = ['name', 'description', 'type', 'updated']

/** 生成固定字段顺序的 frontmatter；保留额外标量字段。 */
export function stringifyFrontmatter(data, body) {
  const lines = []
  const seen = new Set()
  const push = (key) => {
    const value = data[key]
    if (typeof value !== 'string' || value.trim() === '') return
    seen.add(key)
    const flat = value.replace(/\n/g, ' ').trim()
    const needQuote = /[:#]/.test(flat) || /^\s|\s$/.test(flat)
    lines.push(`${key}: ${needQuote ? `"${flat.replace(/"/g, "'")}"` : flat}`)
  }
  for (const key of FRONTMATTER_ORDER) push(key)
  for (const key of Object.keys(data).sort()) {
    if (seen.has(key) || !/^[\p{L}\p{N}._-]+$/u.test(key)) continue
    push(key)
  }
  const header = lines.length === 0 ? '' : `---\n${lines.join('\n')}\n---\n\n`
  return `${header}${String(body).trim()}\n`
}

/** 把正文按行去重后并入已有正文。 */
export function mergeBody(prior, incoming) {
  const seen = new Set()
  const out = []
  for (const part of [prior, incoming]) {
    for (const line of String(part ?? '').split('\n')) {
      const key = line.trim()
      if (key === '') {
        if (out.length > 0 && out[out.length - 1] !== '') out.push('')
        continue
      }
      if (seen.has(key)) continue
      seen.add(key)
      out.push(line)
    }
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

/* ---------------- 读取与遍历 ---------------- */

/** 同步读取 + mtime/size 缓存：section 的 text 同步求值，文件没变只付一次 statSync。 */
export function cachedReader(cap) {
  const seen = new Map()
  return (file) => {
    let st
    try {
      st = statSync(file)
    } catch {
      seen.delete(file)
      return ''
    }
    const hit = seen.get(file)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.text
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      return ''
    }
    // 预算按 UTF-8 字节算（中文一个字 3 字节），避免字符串长度造成超预算
    const raw = Buffer.from(text, 'utf8')
    if (raw.length > cap) text = raw.subarray(0, cap).toString('utf8') + '\n\n[mem truncated]'
    seen.set(file, { mtimeMs: st.mtimeMs, size: st.size, text })
    return text
  }
}

// 搜索用文本缓存：同一进程内重复搜索只 stat，命中后不再读盘；总量封顶 1 MiB。
const CACHE = new Map()
let cacheBytes = 0

/** 丢弃某个文件的缓存（写入或外部改动后调用）。 */
export function invalidateText(file) {
  const old = CACHE.get(file)
  if (old === undefined) return
  CACHE.delete(file)
  cacheBytes -= old.text.length
}

/** 只读开头 cap 字节，不给大文件分配整块内存。 */
export async function readBody(file, st, cap) {
  const len = Math.min(st.size, cap)
  if (len === 0) return ''
  let fh
  try {
    fh = await open(file, 'r')
    const buf = Buffer.allocUnsafe(len)
    const { bytesRead } = await fh.read(buf, 0, len, 0)
    return buf.toString('utf8', 0, bytesRead)
  } catch {
    return ''
  } finally {
    await fh?.close()
  }
}

/** 按 mtime/size 校验过的文本；未变直接用缓存。 */
export async function readText(file, cap) {
  const st = await stat(file).catch(() => undefined)
  if (st === undefined) return ''
  const hit = CACHE.get(file)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    CACHE.delete(file)
    CACHE.set(file, hit)
    return hit.text
  }
  const text = await readBody(file, st, cap)
  const old = CACHE.get(file)
  if (old) cacheBytes -= old.text.length
  CACHE.set(file, { mtimeMs: st.mtimeMs, size: st.size, text })
  cacheBytes += text.length
  for (const [key, value] of CACHE) {
    if (cacheBytes <= CACHE_BYTES) break
    CACHE.delete(key)
    cacheBytes -= value.text.length
  }
  return text
}

/** 惰性遍历 md/txt：调用方 break 就停，不必先收齐整棵树。 */
export async function* walkDocs(dir) {
  let ents
  try {
    ents = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const ent of ents) {
    if (ent.name.startsWith('.') || SKIP.has(ent.name)) continue
    const full = join(dir, ent.name)
    if (ent.isDirectory()) yield* walkDocs(full)
    else if (DOC_RE.test(ent.name)) yield full
  }
}

/** 取文件列表，最多 limit 个。 */
export async function collectDocs(root, limit = LIST_FILES) {
  const out = []
  for await (const file of walkDocs(root)) {
    out.push(file)
    if (out.length >= limit) break
  }
  return out
}

/* ---------------- 提炼输出与触发 ---------------- */

/** 去掉模型可能加上的 Markdown 代码围栏。 */
export function stripFence(text) {
  const body = String(text).trim()
  const fenced = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(body)
  return fenced === null ? body : fenced[1].trim()
}

/** 拆出提炼输出的 INDEX 与 FILES 两段；没有标记时整段当索引。 */
export function parseDistill(raw) {
  const text = stripFence(raw)
  const sections = {}
  const re = /^##\s*(INDEX|FILES)\s*$/gim
  let match
  let last
  let start = 0
  while ((match = re.exec(text)) !== null) {
    if (last !== undefined) sections[last] = text.slice(start, match.index)
    last = match[1].toUpperCase()
    start = match.index + match[0].length
  }
  if (last !== undefined) sections[last] = text.slice(start)
  const index = (sections.INDEX ?? (last === undefined ? text : '')).trim()
  const files = []
  const body = (sections.FILES ?? '').trim()
  const parts = body.split(/^===\s*(.+)$/gm)
  for (let i = 1; i < parts.length; i += 2) {
    const path = parts[i].trim()
    const content = (parts[i + 1] ?? '').trim()
    if (path !== '' && content !== '') files.push({ path, content })
  }
  return { index, files }
}

/** 提取索引里的 `- ` 行（去掉空行与标题）。 */
export function indexLines(text) {
  return String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
}

/** 行归一化：去掉更新日期与多余空白，用于跨次去重。 */
export function normalizeIndexLine(line) {
  return String(line)
    .replace(/（更新\s*\d{4}-\d{2}-\d{2}）/g, '')
    .replace(/\(updated\s*\d{4}-\d{2}-\d{2}\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 是否值得提前提炼：积压够多，且距上次提炼超过最小间隔。
 * @param {{bytes:number}} pending inbox 积压
 * @param {number} lastAt 上次提炼时间戳
 * @param {number} now 当前时间戳
 * @param {number} [minBytes] 积压阈值
 * @param {number} [minGapMs] 最小间隔
 */
export function shouldDistill(pending, lastAt, now, minBytes = 16 * 1024, minGapMs = 3600 * 1000) {
  return pending.bytes >= minBytes && now - lastAt >= minGapMs
}

/** 空闲提炼：没有新活动超过 idleMs，且有待提炼内容。 */
export function shouldDistillIdle(pending, lastActivityAt, lastAt, now, idleMs) {
  return pending.bytes > 0 && now - lastActivityAt >= idleMs && now - lastAt >= 60 * 1000
}

/* ---------------- 杂项 ---------------- */

/** UTF-8 字节数。 */
export function byteSize(text) {
  return Buffer.byteLength(String(text ?? ''), 'utf8')
}

/** 生成可排序的本地时间戳：2026-10-27-09-58-12。 */
export function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/** 目标的唯一路径：已存在时追加 -2 / -3 … */
export async function uniquePath(folder, name) {
  const base = join(folder, name)
  if (await stat(base).then(() => false, () => true)) return base
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; n < 1000; n += 1) {
    const candidate = join(folder, `${stem}-${n}${ext}`)
    if (await stat(candidate).then(() => false, () => true)) return candidate
  }
  return join(folder, `${stem}-${Date.now()}${ext}`)
}
