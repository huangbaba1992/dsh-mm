// dsh-local-memory — 共享的路径与文件读写工具（Host 半内部模块）
import { readFileSync, statSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'

export const SOUL_CAP = 4096
export const DOC_CAP = 64 * 1024
export const SEARCH_CAP = 128 * 1024
export const SEARCH_FILES = 200
export const LIST_FILES = 500
export const MAX_HITS = 20
export const CONCURRENCY = 16
export const CACHE_BYTES = 1 << 20
export const DOC_RE = /\.(md|txt)$/i
export const SKIP = new Set(['node_modules', '.git', '.obsidian'])

/** 主题文件统一放在一个目录里，分型由 frontmatter 的 type 字段表达。 */
export const TOPIC_DIR = 'topics'

/** 合法的记忆类型（frontmatter.type）。 */
export const MEMORY_TYPES = ['person', 'project', 'decision', 'preference', 'lesson']

/** 类型 → 分组键（界面分类按钮用）。 */
export const TYPE_GROUP = {
  person: 'people',
  project: 'projects',
  decision: 'decisions',
  preference: 'preferences',
  lesson: 'lessons'
}

/** 旧版分型目录 → 类型（迁移用）。 */
export const TYPE_NAME = {
  people: 'person',
  projects: 'project',
  decisions: 'decision',
  preferences: 'preference',
  lessons: 'lesson'
}

/** 解析 YAML 风格的简单 frontmatter（只支持 key: value 单行）。 */
export function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (match === null) return { data: {}, body: text }
  const data = {}
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    data[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return { data, body: text.slice(match[0].length) }
}

/** 生成固定字段顺序的 frontmatter。 */
export function stringifyFrontmatter(data, body) {
  const lines = []
  for (const key of ['name', 'description', 'type', 'updated']) {
    const value = data[key]
    if (typeof value === 'string' && value.trim() !== '') lines.push(`${key}: ${value.replace(/\n/g, ' ').trim()}`)
  }
  return `---\n${lines.join('\n')}\n---\n\n${String(body).trim()}\n`
}

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
    if (text.length > cap) text = text.slice(0, cap) + '\n\n[mem truncated]'
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
