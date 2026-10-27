// dsh-local-memory — 管理面：设置文件、Web 路由、模型目录、定时合并去重（Host 半内部模块）
import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rename, rm, rmdir, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { collectDocs, inside, invalidateText, readText, rootOf, DOC_CAP, DOC_RE, LIST_FILES, MEMORY_TYPES, TYPE_GROUP, TYPE_NAME, TOPIC_DIR, parseFrontmatter, stringifyFrontmatter } from './core.js'

const MAX_BODY = 1 << 20
const MAX_EDIT_BYTES = 256 * 1024
const CHECK_MS = 10 * 60 * 1000
const FIRST_CHECK_MS = 3 * 60 * 1000
const COMPACT_TIMEOUT_MS = 120 * 1000
const MAX_OUTPUT_TOKENS = 4096
const DISTILL_MAX_FILES = 3
const DISTILL_TOTAL_CHARS = 48 * 1024
const ARCHIVE_KEEP_DAYS = 30
const DISTILL_PENDING_BYTES = 16 * 1024
const DISTILL_MIN_GAP_MS = 60 * 60 * 1000
const SESSION_END_MIN_GAP_MS = 60 * 1000

/**
 * 是否值得提前提炼：积压够多，且距上次提炼超过最小间隔。
 * @param {{bytes:number}} pending inbox 积压
 * @param {number} lastAt 上次提炼时间戳
 * @param {number} now 当前时间戳
 * @returns {boolean}
 */
export function shouldDistill(pending, lastAt, now) {
  return pending.bytes >= DISTILL_PENDING_BYTES && now - lastAt >= DISTILL_MIN_GAP_MS
}

/**
 * 空闲提炼：没有新活动超过 idleMs，且有待提炼内容、距上次提炼超过最小间隔。
 * @param {{bytes:number}} pending 待提炼积压
 * @param {number} lastActivityAt 最近活动时间
 * @param {number} lastAt 上次提炼时间
 * @param {number} now 当前时间
 * @param {number} idleMs 空闲阈值
 * @returns {boolean}
 */
export function shouldDistillIdle(pending, lastActivityAt, lastAt, now, idleMs) {
  return pending.bytes > 0 && now - lastActivityAt >= idleMs && now - lastAt >= SESSION_END_MIN_GAP_MS
}

/** 合并去重的出厂设置。 */
const DEFAULTS = {
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
    lastRunAt: 0,
    lastResult: null
  },
  capture: {
    enabled: true,
    maxChars: 1500,
    idleMinutes: 30
  }
}

const clamp = (value, min, max, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

const str = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback)

const RESERVED_NAMES = new Set(['', '.', '..'])

/** 文件名只允许纯文件名：带斜杠、点目录等坏配置一律回退默认值，避免运行期抛错。 */
const fileName = (value, fallback) => {
  const name = str(value)
  return RESERVED_NAMES.has(name) || name.includes('/') || name.includes('\\') ? fallback : name
}

/** 只接受已知字段，并把数值夹在合理区间。 */
function sanitize(raw) {
  const compact = raw?.compact ?? {}
  const capture = raw?.capture ?? {}
  return {
    version: 1,
    dir: str(raw?.dir),
    compact: {
      enabled: compact.enabled === true,
      everyHours: clamp(compact.everyHours, 1, 24 * 30, DEFAULTS.compact.everyHours),
      provider: str(compact.provider),
      model: str(compact.model),
      minFileBytes: clamp(compact.minFileBytes, 256, 1 << 20, DEFAULTS.compact.minFileBytes),
      maxInputBytes: clamp(compact.maxInputBytes, 1024, 512 * 1024, DEFAULTS.compact.maxInputBytes),
      maxFilesPerRun: clamp(compact.maxFilesPerRun, 1, 50, DEFAULTS.compact.maxFilesPerRun),
      removeExactDuplicates: compact.removeExactDuplicates !== false,
      lastRunAt: clamp(compact.lastRunAt, 0, Number.MAX_SAFE_INTEGER, 0),
      lastResult: compact.lastResult ?? null
    },
    capture: {
      enabled: capture.enabled !== false,
      maxChars: clamp(capture.maxChars, 200, 8000, DEFAULTS.capture.maxChars),
      idleMinutes: clamp(capture.idleMinutes, 5, 24 * 60, DEFAULTS.capture.idleMinutes)
    }
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

async function readJson(req, limit = MAX_BODY) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 })
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text === '' ? {} : JSON.parse(text)
}

/** 去掉模型可能加上的 Markdown 代码围栏。 */
function stripFence(text) {
  const body = text.trim()
  const fenced = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(body)
  return fenced === null ? body : fenced[1].trim()
}

const DISTILL_SYSTEM =
  'You extract durable memories from a raw conversation log. Return exactly two Markdown sections:\n\n' +
  '## INDEX\n- one line per durable fact: `- [title](topics/slug.md) — one-line description (updated YYYY-MM-DD)` for topic-backed facts, or `- plain fact` otherwise. At most 200 characters per line, absolute dates.\n\n' +
  '## FILES\n=== topics/li.md\n---\nname: 李工\ndescription: 后端负责人\ntype: person\nupdated: 2026-10-27\n---\n- facts belonging to that topic, one per line\n\n' +
  'All topic files live under topics/ (one directory level, .md). type must be one of person, project, decision, preference, lesson. One file per person, project, decision, preference or lesson. Never use soul.md, MEMORY.md, inbox/, absolute paths or ... Omit FILES when nothing belongs to a topic. No code fences, no commentary.'

const COMPACT_SYSTEM =
  'You compress one Markdown memory file. Keep every distinct fact, name, date, preference and decision. Merge duplicated or repeated statements into one. Remove greetings, filler and chit-chat. Keep the original language and Markdown structure. Output only the new file content, no code fences, no commentary.'

/**
 * 创建管理面：读取/保存设置，注册 Web 路由，按设置定时跑合并去重。
 * @param ctx Host 插件上下文
 * @param config 本插件 Config
 * @returns 路径 getter 与运行状态
 */
export function createAdmin(ctx, config) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const stateFile = join(home, 'local-memory.json')

  let settings = DEFAULTS
  let root = rootOf(config.dir)
  let running = false

  const soulName = fileName(config.soulFile, 'soul.md')
  const memoryName = fileName(config.memoryFile, 'MEMORY.md')
  const paths = () => ({
    root,
    soulPath: inside(root, soulName),
    memoryPath: inside(root, memoryName)
  })

  /** 把旧版分型目录里的文件搬进 topics/，补上 type 字段；空目录删除。 */
  const migrateLegacyDirs = async (base) => {
    const topicsDir = join(base, TOPIC_DIR)
    for (const legacy of Object.keys(TYPE_NAME)) {
      const dir = join(base, legacy)
      let entries = []
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isFile() || !DOC_RE.test(entry.name)) continue
        try {
          const from = join(dir, entry.name)
          const { data, body } = parseFrontmatter(await readFile(from, 'utf8'))
          const declared = String(data.type ?? '').toLowerCase()
          const type = MEMORY_TYPES.includes(declared) ? declared : TYPE_NAME[legacy]
          await mkdir(topicsDir, { recursive: true })
          let to = join(topicsDir, entry.name)
          if (await stat(to).then(() => true, () => false)) {
            to = join(topicsDir, `${entry.name.replace(/\.md$/i, '')}-${Date.now()}.md`)
          }
          await writeFile(to, stringifyFrontmatter({ ...data, name: data.name || entry.name.replace(/\.md$/i, ''), type }, body), 'utf8')
          await rm(from).catch(() => {})
        } catch {
          /* 单个文件失败留待下次 */
        }
      }
      const left = await readdir(dir).catch(() => ['x'])
      if (left.length === 0) await rmdir(dir).catch(() => {})
    }
  }

  const ready = (async () => {
    try {
      settings = sanitize(JSON.parse(await readFile(stateFile, 'utf8')))
    } catch {
      settings = sanitize(undefined)
    }
    root = rootOf(settings.dir || config.dir)
    await migrateLegacyDirs(root)
  })()

  const save = async () => {
    await mkdir(home, { recursive: true })
    const tmp = `${stateFile}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8')
    await rename(tmp, stateFile)
  }

  // ---------- 对话记录：每轮把（你的话 + 我的回复）原文追加到 inbox/ ----------
  const pending = new Map()
  let lastActivityAt = Date.now()

  /** 从一条会话事件里取出模型可见文本；只收人类消息与助手正文。 */
  const textOf = (event) => {
    const cap = settings.capture.maxChars
    const join = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      const text = blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n').trim()
      return text.length > cap ? text.slice(0, cap) + '…' : text
    }
    if (event?.type === 'user/message') {
      const source = event.data?.source
      if (!(source === undefined || source === null || source.kind === 'user')) return ''
      const text = join(event.data?.content)
      return text === '' ? '' : `**你**：${text}`
    }
    if (event?.type === 'assistant/message') {
      const text = join(event.data?.message?.content)
      return text === '' ? '' : `**我**：${text}`
    }
    return ''
  }

  ctx.on('session/event', (session, event) => {
    try {
      lastActivityAt = Date.now()
      if (settings.capture.enabled !== true || session?.id === undefined) return
      const text = textOf(event)
      if (text === '') return
      const slot = pending.get(session.id) ?? []
      if (slot.length >= 40) return
      slot.push(text)
      pending.set(session.id, slot)
    } catch {
      /* 记录失败不影响会话 */
    }
  })

  const flushCapture = async (agent, turn) => {
    const id = agent?.session?.id
    if (id === undefined) return
    const slot = pending.get(id)
    if (slot === undefined) return
    pending.delete(id)
    if (settings.capture.enabled !== true || slot.length === 0) return
    const now = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const folder = join(paths().root, 'inbox')
    await mkdir(folder, { recursive: true })
    const entry = `\n## ${pad(now.getHours())}:${pad(now.getMinutes())} · turn ${turn ?? '?'}\n\n${slot.join('\n\n')}\n`
    await appendFile(join(folder, `${day}.md`), entry, 'utf8')
  }

  ctx.on('agent/turn-stopping', (payload) => {
    flushCapture(payload?.agent, payload?.turn).catch(() => {})
  })

  /** 最后一个会话关闭后：有待提炼就立刻跑一次。 */
  const maybeDistillOnClose = async () => {
    if (running) return
    try {
      const agents = ctx.get('agents')
      const live = typeof agents?.list === 'function' ? agents.list().length : 0
      if (live > 0) return
      const pending = await pendingInbox()
      if (pending.bytes === 0) return
      const lastAt = settings.compact.lastDistill?.at ?? 0
      if (Date.now() - lastAt < SESSION_END_MIN_GAP_MS) return
      await runDistill('session-end')
    } catch {
      /* 关闭阶段失败不影响宿主 */
    }
  }

  ctx.on('session/disposed', () => {
    void maybeDistillOnClose()
  })

  ctx.on('agent/disposed', (payload) => {
    const id = payload?.agent?.session?.id
    if (id !== undefined) pending.delete(id)
  })

  const reject = (req, res) => {
    const status = ctx.get('connection')?.requestRejection?.(req)
    if (status === undefined) return false
    res.statusCode = status
    res.end()
    return true
  }

  // ---------- 模型目录 ----------
  const fallbackRoute = () => {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    return selection?.provider && selection?.model ? { provider: selection.provider, model: selection.model } : undefined
  }

  const catalog = async () => {
    const controller = ctx.get('sessionController')
    try {
      if (controller?.modelCatalog) {
        const value = await controller.modelCatalog()
        if (value && Array.isArray(value.groups)) return value
      }
    } catch {
      /* 目录不可用时退回默认模型 */
    }
    return { default: fallbackRoute() ?? null, groups: [], failures: [] }
  }

  const resolveRoute = async () => {
    const compact = settings.compact
    if (compact.provider !== '' && compact.model !== '') return { provider: compact.provider, model: compact.model }
    return fallbackRoute()
  }

  // ---------- 合并去重 ----------
  const askModel = async (route, system, fileText, signal) => {
    const llm = ctx.get('llm')
    if (!llm?.prepareCall) throw new Error('llm service is unavailable')
    const call = await llm.prepareCall(
      { provider: route.provider, model: route.model, maxTokens: MAX_OUTPUT_TOKENS },
      signal
    )
    let text = ''
    for await (const chunk of call.stream({
      ...call.config,
      ...(system === '' ? {} : { system }),
      // 手写消息对象：不 import dsh-llm，避免本地链接安装时的包解析问题。
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: fileText }],
          source: { kind: 'local-memory-compact' }
        }
      ],
      // opencode-go 等供应商要求请求带会话标识（x-opencode-session），缺了会 400。
      sessionId: 'local-memory-compact',
      purpose: 'local-memory-compact',
      signal
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
        throw new Error(chunk.reason.failure?.message ?? 'model call failed')
      }
    }
    return text
  }

  // ---------- 失败处理：重试、上下文降级、system 降级、模型校验 ----------
  const RETRY_DELAYS = [800, 2500]
  const errorText = (error) => String(error?.message ?? error)

  const isTransient = (error) => /(429|rate.?limit|too many requests|timeout|timed out|ECONNRESET|ECONNREFUSED|socket|fetch failed|network|temporar)/i.test(errorText(error))
  const isContext = (error) => /(context.?(length|window)|maximum context|too long|exceed\w*.*token|token\w*.*exceed|input\w*.*too large)/i.test(errorText(error))
  const isSystemUnsupported = (error) => /(system\w*.*(not supported|unsupported|invalid)|does not support system)/i.test(errorText(error))

  /** 把原始报错翻成可操作的一句话。 */
  const explain = (error) => {
    const text = errorText(error)
    if (/401|unauthori[sz]ed|invalid.*(api.?key|credential)|authentication/i.test(text)) return `${text}（凭证无效：检查该供应商的 key）`
    if (/403|forbidden/i.test(text)) return `${text}（无权限：检查该 key 能访问的模型）`
    if (/429|rate.?limit|quota/i.test(text)) return `${text}（限流或额度不足：稍后重试或换模型）`
    if (/model.*(not found|does not exist|unknown)|NO_ADAPTER/i.test(text)) return `${text}（模型不可用：在设置页重新选择）`
    if (isContext(error)) return `${text}（上下文超限：调小 maxInputBytes 或换长窗口模型）`
    return text
  }

  /** 用量小的重试处理限流/网络抖动。 */
  const askWithRetry = async (route, system, text, signal) => {
    let last
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      if (signal?.aborted) throw new Error('aborted')
      try {
        return await askModel(route, system, text, signal)
      } catch (error) {
        last = error
        if (!isTransient(error)) throw error
        if (attempt < RETRY_DELAYS.length) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]))
      }
    }
    throw last
  }

  /** 把文本在换行处切成两半。 */
  const splitAt = (text) => {
    const mid = Math.floor(text.length / 2)
    const found = text.lastIndexOf('\n', mid)
    return found > text.length * 0.25 ? found : mid
  }

  /** 模型调用：限流重试 → 上下文超限则对半拆 → system 不被支持则并进用户消息。 */
  const askModelSafe = async (route, system, text, signal) => {
    try {
      return await askWithRetry(route, system, text, signal)
    } catch (error) {
      if (isSystemUnsupported(error)) {
        return await askWithRetry(route, '', `${system}\n\n${text}`, signal)
      }
      if (isContext(error) && text.length > 2000) {
        const at = splitAt(text)
        const head = await askWithRetry(route, system, text.slice(0, at), signal)
        const tail = await askWithRetry(route, system, text.slice(at), signal)
        return [head, tail].filter((part) => part.trim() !== '').join('\n')
      }
      throw error
    }
  }

  /** 运行前校验所选模型确实在当前可用目录里，避免白跑一次请求。 */
  const validateRoute = async (route) => {
    if (route === undefined) return
    const value = await catalog()
    const groups = value.groups ?? []
    if (groups.length === 0) return
    const group = groups.find((entry) => entry.id === route.provider)
    if (group === undefined) throw new Error(`provider "${route.provider}" is not available; available: ${groups.map((entry) => entry.id).join(', ')}`)
    const models = group.models ?? []
    if (models.length > 0 && !models.some((model) => model.id === route.model)) {
      throw new Error(`model "${route.model}" is not in provider "${route.provider}"; available: ${models.map((model) => model.id).join(', ')}`)
    }
  }

  /** 统计待提炼的 inbox 积压。 */
  const pendingInbox = async () => {
    const folder = join(paths().root, 'inbox')
    let entries = []
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch {
      return { files: 0, bytes: 0 }
    }
    let files = 0
    let bytes = 0
    for (const entry of entries) {
      if (!entry.isFile() || !DOC_RE.test(entry.name)) continue
      const st = await stat(join(folder, entry.name)).catch(() => undefined)
      if (st === undefined) continue
      files += 1
      bytes += st.size
    }
    return { files, bytes }
  }

  /** 归档路径：同名文件已存在时加时间戳后缀，绝不覆盖。 */
  const archivePath = async (folder, name) => {
    const archive = join(folder, 'archive')
    await mkdir(archive, { recursive: true })
    const base = join(archive, name)
    const exists = await stat(base).then(() => true, () => false)
    if (!exists) return base
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19)
    const dot = name.lastIndexOf('.')
    const alt = dot > 0 ? `${name.slice(0, dot)}-${stamp}${name.slice(dot)}` : `${name}-${stamp}`
    return join(archive, alt)
  }

  /** 上次提炼中途崩溃留下的 .processing-* 文件：恢复到 inbox 或归档。 */
  const recoverProcessing = async (folder) => {
    let entries = []
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith('.processing-')) continue
      const original = entry.name.slice('.processing-'.length)
      const temp = join(folder, entry.name)
      const target = join(folder, original)
      const exists = await stat(target).then(() => true, () => false)
      const dest = exists ? await archivePath(folder, original) : target
      await rename(temp, dest).catch(() => {})
    }
  }

  /** 删除归档里超过保留期的原文，避免 archive 无限增长。 */
  const pruneArchive = async (folder) => {
    const archive = join(folder, 'archive')
    let entries = []
    try {
      entries = await readdir(archive, { withFileTypes: true })
    } catch {
      return
    }
    const cutoff = Date.now() - ARCHIVE_KEEP_DAYS * 24 * 3600 * 1000
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const file = join(archive, entry.name)
      const st = await stat(file).catch(() => undefined)
      if (st !== undefined && st.mtimeMs < cutoff) await rm(file).catch(() => {})
    }
  }

  /** 拆出提炼输出的 INDEX 与 FILES 两段；没有标记时整段当索引（向后兼容）。 */
  const parseDistill = (raw) => {
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

  /**
   * 主题文件路径白名单：统一落到 topics/<name>.md。
   * 旧版分型目录（people/…）仍接受，返回归一化后的路径与推断类型。
   * @param {string} raw 模型给出的路径
   * @param {Set<string>} reserved 禁止使用的名字
   * @returns {{path: string, type: string}|undefined}
   */
  const safeTopicPath = (raw, reserved) => {
    const value = String(raw).trim().replace(/^\.\//, '')
    if (value === '' || value.length > 120 || value.startsWith('/') || value.startsWith('~')) return undefined
    if (value.includes('..') || value.includes('\\') || !/\.md$/i.test(value)) return undefined
    const segments = value.split('/')
    if (segments.length !== 2) return undefined
    if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) return undefined
    for (const seg of segments) if (!/^[\p{L}\p{N}._-]+$/u.test(seg)) return undefined
    const folder = segments[0].toLowerCase()
    const file = segments[1]
    if (reserved.has(folder) || reserved.has(file.toLowerCase())) return undefined
    if (folder === TOPIC_DIR) return { path: `${TOPIC_DIR}/${file}`, type: 'note' }
    const legacyType = TYPE_NAME[folder]
    return legacyType === undefined ? undefined : { path: `${TOPIC_DIR}/${file}`, type: legacyType }
  }

  /** 提炼 inbox 原文 → MEMORY.md；成功后把原文移到 inbox/archive/（不删除）。 */
  const distillInbox = async () => {
    const base = paths().root
    const folder = join(base, 'inbox')
    await recoverProcessing(folder)
    let entries = []
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch {
      return { files: 0, facts: 0, topics: [], archived: [] }
    }
    const docs = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && DOC_RE.test(entry.name))
      .map((entry) => join(folder, entry.name))
      .sort()
    if (docs.length === 0) return { files: 0, facts: 0, topics: [], archived: [] }
    const route = await resolveRoute()
    if (route === undefined) return { files: 0, facts: 0, archived: [], error: 'no model selected' }
    try {
      await validateRoute(route)
    } catch (error) {
      return { files: 0, facts: 0, topics: [], archived: [], error: explain(error), model: route }
    }

    // 先改名挪走再读：提炼期间 capture 追加到同名新文件，不会污染正在提炼的内容。
    const picked = []
    let total = 0
    for (const file of docs.slice(0, DISTILL_MAX_FILES)) {
      const name = relative(folder, file)
      const temp = join(folder, `.processing-${name}`)
      try {
        await rename(file, temp)
      } catch {
        continue
      }
      const text = await readText(temp, DOC_CAP)
      if (text.trim() === '') {
        await rename(temp, file).catch(() => {})
        continue
      }
      if (total + text.length > DISTILL_TOTAL_CHARS) {
        await rename(temp, file).catch(() => {})
        break
      }
      picked.push({ temp, text, name })
      total += text.length
    }
    if (picked.length === 0) return { files: 0, facts: 0, topics: [], archived: [] }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('distill timed out')), COMPACT_TIMEOUT_MS)
    try {
      const soulText = (await readText(paths().soulPath, DOC_CAP)).trim()
      const input =
        (soulText === '' ? '' : `### 用户画像（soul.md）\n${soulText}\n\n`) +
        picked.map((item) => `### ${item.name}\n${item.text}`).join('\n\n')
      const raw = await askModelSafe(route, DISTILL_SYSTEM, input, controller.signal)
      const parsed = parseDistill(raw)
      const facts = parsed.index
      const now = new Date()
      const date = now.toISOString().slice(0, 10)
      const pad = (value) => String(value).padStart(2, '0')
      if (facts !== '') {
        const { memoryPath } = paths()
        const prior = await readFile(memoryPath, 'utf8').catch(() => '')
        const heading = `## 从对话提炼（${date}）`
        let next
        if (prior.includes(heading)) {
          // 同一天第二次提炼：追加到当天小节下，不覆盖已有事实
          next = `${prior.replace(/\s*$/, '')}\n\n### 补充 ${pad(now.getHours())}:${pad(now.getMinutes())}\n${facts}\n`
        } else if (prior.trim() === '') {
          next = `# 长期记忆\n\n${heading}\n${facts}\n`
        } else {
          next = `${prior.replace(/\s*$/, '')}\n\n${heading}\n${facts}\n`
        }
        await mkdir(dirname(memoryPath), { recursive: true })
        await writeFile(memoryPath, next, 'utf8')
        invalidateText(memoryPath)
        // 索引超过注入预算就立刻压一次，避免 MEMORY.md 越写越长
        if (next.length > config.maxMemoryBytes) {
          try {
            const rawIndex = await askModelSafe(route, COMPACT_SYSTEM, next.slice(0, DISTILL_TOTAL_CHARS), controller.signal)
            const compactedIndex = stripFence(rawIndex).trim()
            if (compactedIndex.length >= 32 && compactedIndex.length <= next.length * 0.95) {
              await writeFile(memoryPath, `${compactedIndex}\n`, 'utf8')
              invalidateText(memoryPath)
            }
          } catch {
            /* 压缩失败保留原索引，下一次整理再试 */
          }
        }
      }
      // 主题文件：分型目录 + frontmatter，跨文件按行去重
      const topics = []
      const reserved = new Set([String(config.soulFile).toLowerCase(), String(config.memoryFile).toLowerCase(), 'inbox', 'archive'])
      const knownLines = new Set()
      for (const file of await collectDocs(join(base, TOPIC_DIR), 200)) {
        const { body } = parseFrontmatter(await readText(file, DOC_CAP))
        for (const line of body.split('\n')) {
          const trimmed = line.trim()
          if (trimmed !== '') knownLines.add(trimmed)
        }
      }
      const today = new Date().toISOString().slice(0, 10)
      for (const item of parsed.files.slice(0, 5)) {
        const normalized = safeTopicPath(item.path, reserved)
        if (normalized === undefined) continue
        const rel = normalized.path
        try {
          const { data, body } = parseFrontmatter(item.content)
          const target = inside(base, rel)
          const prior = await readFile(target, 'utf8').catch(() => '')
          const priorParts = parseFrontmatter(prior)
          const fresh = []
          for (const line of body.split('\n')) {
            const trimmed = line.trim()
            if (trimmed === '' || knownLines.has(trimmed)) continue
            knownLines.add(trimmed)
            fresh.push(line)
          }
          if (fresh.length === 0 && prior !== '') continue
          const fileName = rel.split('/')[1] ?? rel
          const declared = String(data.type ?? '').toLowerCase()
          const type = MEMORY_TYPES.includes(declared) ? declared : normalized.type
          const name = data.name || fileName.replace(/\.md$/i, '')
          const description = data.description || priorParts.data.description || ''
          const merged = stringifyFrontmatter(
            { name, description, type, updated: today },
            [priorParts.body.trim(), fresh.join('\n')].filter((part) => part !== '').join('\n')
          )
          if (merged.length > DOC_CAP || merged === prior) continue
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, merged, 'utf8')
          invalidateText(target)
          topics.push({ path: rel, name, type, added: fresh.length })
        } catch {
          /* 单个主题文件失败不影响整体提炼 */
        }
      }
      const archive = join(folder, 'archive')
      const archived = []
      for (const item of picked) {
        const target = await archivePath(folder, item.name)
        await rename(item.temp, target).catch(() => {})
        archived.push(relative(archive, target))
      }
      await pruneArchive(folder)
      return {
        files: picked.length,
        facts: facts.split('\n').filter((line) => line.trim().startsWith('-')).length,
        topics,
        archived,
        model: route
      }
    } catch (error) {
      // 失败：把挪走的文件放回 inbox，原文不丢
      for (const item of picked) await rename(item.temp, join(folder, item.name)).catch(() => {})
      return { files: 0, facts: 0, topics: [], archived: [], error: explain(error), model: route }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 跑一次整理；返回摘要，不抛错（错误写进摘要）。 */
  const compactOnce = async (reason) => {
    await ready
    const { root: base, soulPath } = paths()
    const result = {
      at: Date.now(),
      reason,
      scanned: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      removed: [],
      rewritten: [],
      skipped: [],
      model: null
    }
    const files = []
    for (const file of await collectDocs(base, LIST_FILES)) {
      if (file === soulPath) continue
      if (relative(base, file).startsWith('inbox/')) continue
      const st = await stat(file).catch(() => undefined)
      if (st === undefined) continue
      files.push({ file, bytes: st.size })
      result.bytesBefore += st.size
    }
    result.scanned = files.length

    // 1) 完全相同的文件：保留一个，其余直接移除（不备份）；MEMORY.md 永远保留。
    if (settings.compact.removeExactDuplicates) {
      const { memoryPath } = paths()
      const seen = new Map()
      for (const entry of files) {
        // 超过 DOC_CAP 的文件只读到上限，哈希可能误判，直接跳过。
        if (entry.bytes > DOC_CAP) continue
        const text = await readText(entry.file, DOC_CAP)
        if (text === '') continue
        const hash = createHash('sha1').update(text).digest('hex')
        const prior = seen.get(hash)
        if (entry.file === memoryPath) {
          // 索引文件优先：若此前已保留同内容的别处文件，移除它而不是移除索引。
          seen.set(hash, entry.file)
          if (prior !== undefined && prior !== entry.file) {
            try {
              await rm(prior)
              invalidateText(prior)
              result.removed.push({ path: relativeOf(base, prior), duplicateOf: relativeOf(base, entry.file) })
            } catch (error) {
              result.skipped.push({ path: relativeOf(base, prior), why: `dedupe failed: ${String(error?.message ?? error)}` })
            }
          }
          continue
        }
        if (prior === undefined) {
          seen.set(hash, entry.file)
          continue
        }
        try {
          await rm(entry.file)
          invalidateText(entry.file)
          result.removed.push({ path: relativeOf(base, entry.file), duplicateOf: relativeOf(base, prior) })
        } catch (error) {
          result.skipped.push({ path: relativeOf(base, entry.file), why: `dedupe failed: ${String(error?.message ?? error)}` })
        }
      }
    }

    // 2) 大文件交给模型压缩；只接受明显变小的结果。
    const route = await resolveRoute()
    if (route === undefined) {
      result.skipped.push({ path: '*', why: 'no model selected (set one in Settings → Local Memory)' })
    } else {
      try {
        await validateRoute(route)
      } catch (error) {
        result.skipped.push({ path: '*', why: explain(error) })
      }
      result.model = route
      let done = 0
      for (const entry of files) {
        if (result.skipped.some((item) => item.path === '*')) break
        if (done >= settings.compact.maxFilesPerRun) break
        if (entry.bytes < settings.compact.minFileBytes) continue
        const rel = relativeOf(base, entry.file)
        // 只压缩能完整读入的文件，避免用截断内容覆盖原文。
        if (entry.bytes > settings.compact.maxInputBytes) {
          result.skipped.push({ path: rel, why: 'larger than maxInputBytes' })
          continue
        }
        const exists = await stat(entry.file).catch(() => undefined)
        if (exists === undefined) continue
        const before = await readFile(entry.file, 'utf8')
        // 分型文件只压正文，frontmatter 原样保留并刷新 updated
        const typedFile =
          rel.startsWith(TOPIC_DIR + '/') || Object.keys(TYPE_NAME).some((dir) => rel.startsWith(dir + '/'))
        const typedType = typedFile ? (rel.split('/')[0] === TOPIC_DIR ? TOPIC_DIR : rel.split('/')[0]) : undefined
        const parts = typedType === undefined ? undefined : parseFrontmatter(before)
        const bodyText = parts === undefined ? before : parts.body
        const input = bodyText.slice(0, settings.compact.maxInputBytes)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(new Error('compaction timed out')), COMPACT_TIMEOUT_MS)
        try {
          const raw = await askModelSafe(route, COMPACT_SYSTEM, input, controller.signal)
          const after = stripFence(raw)
          if (after === '' || after.length < 8) {
            result.skipped.push({ path: rel, why: 'model returned nothing usable' })
          } else if (after.length > bodyText.length * 0.95) {
            result.skipped.push({ path: rel, why: 'model did not shrink the file' })
          } else {
            const nextText =
              parts === undefined
                ? after + '\n'
                : stringifyFrontmatter({ ...parts.data, updated: new Date().toISOString().slice(0, 10) }, after)
            await writeFile(entry.file, nextText, 'utf8')
            invalidateText(entry.file)
            result.rewritten.push({ path: rel, before: before.length, after: after.length })
            done += 1
          }
        } catch (error) {
          result.skipped.push({ path: rel, why: explain(error) })
        } finally {
          clearTimeout(timer)
        }
      }
    }

    // 3) 汇总整理后的体积。
    for (const entry of files) {
      const st = await stat(entry.file).catch(() => undefined)
      if (st !== undefined) result.bytesAfter += st.size
    }
    return result
  }

  /** 只提炼，不做文件压缩。 */
  const runDistill = async (reason) => {
    if (running) return { started: false, running: true }
    running = true
    try {
      await ready
      const distilled = await distillInbox()
      settings.compact.lastDistill = { at: Date.now(), reason, ...distilled }
      await save()
      return { started: true, distilled }
    } catch (error) {
      settings.compact.lastDistill = { at: Date.now(), reason, files: 0, facts: 0, archived: [], error: explain(error) }
      await save().catch(() => {})
      return { started: false, error: settings.compact.lastDistill.error }
    } finally {
      running = false
    }
  }

  const runCompact = async (reason) => {
    if (running) return { started: false, running: true }
    running = true
    try {
      await ready
      // 先提炼 inbox，再压缩记忆文件（顺序固定：提炼产出的内容也要进压缩流程）
      const distilled = await distillInbox().catch((error) => ({ error: String(error?.message ?? error) }))
      settings.compact.lastDistill = { at: Date.now(), reason, ...distilled }
      const result = await compactOnce(reason)
      result.distilled = distilled
      settings.compact.lastRunAt = Date.now()
      settings.compact.lastResult = result
      await save()
      return { started: true, result }
    } catch (error) {
      settings.compact.lastRunAt = Date.now()
      settings.compact.lastResult = { at: Date.now(), reason, error: explain(error) }
      await save().catch(() => {})
      return { started: true, error: settings.compact.lastResult.error }
    } finally {
      running = false
    }
  }

  // ---------- 路由 ----------
  const statePayload = async () => {
    await ready
    const { root: base, soulPath, memoryPath } = paths()
    const files = []
    for (const file of await collectDocs(base, LIST_FILES)) {
      const st = await stat(file).catch(() => undefined)
      files.push({ path: relativeOf(base, file), bytes: st?.size ?? 0 })
    }
    const GROUPS = ['people', 'projects', 'decisions', 'preferences', 'lessons', 'other']
    const topics = Object.fromEntries(GROUPS.map((key) => [key, 0]))
    const topicFiles = Object.fromEntries(GROUPS.map((key) => [key, []]))
    for (const file of await collectDocs(join(base, TOPIC_DIR), 200)) {
      const st = await stat(file).catch(() => undefined)
      const { data } = parseFrontmatter(await readText(file, DOC_CAP))
      const group = TYPE_GROUP[String(data.type ?? '').toLowerCase()] ?? 'other'
      const name = file.slice(file.lastIndexOf('/') + 1)
      topicFiles[group].push({
        path: relative(base, file),
        name,
        bytes: st?.size ?? 0,
        type: data.type ?? 'note',
        description: data.description ?? ''
      })
    }
    for (const key of GROUPS) {
      topicFiles[key].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      topics[key] = topicFiles[key].length
    }
    const [soulText, memoryText, modelCatalog] = await Promise.all([
      readText(soulPath, DOC_CAP),
      readText(memoryPath, DOC_CAP),
      catalog()
    ])
    return {
      root: base,
      soulPath,
      memoryPath,
      soulFile: soulName,
      memoryFile: memoryName,
      files,
      soul: { text: soulText, bytes: Buffer.byteLength(soulText, 'utf8') },
      memory: { text: memoryText, bytes: Buffer.byteLength(memoryText, 'utf8') },
      settings,
      catalog: {
        default: modelCatalog.default ?? null,
        groups: modelCatalog.groups ?? [],
        failures: modelCatalog.failures ?? []
      },
      running,
      lastRunAt: settings.compact.lastRunAt,
      lastResult: settings.compact.lastResult,
      lastDistill: settings.compact.lastDistill ?? null,
      pending: await pendingInbox(),
      topics,
      topicFiles,
      nextRunAt:
        settings.compact.enabled === true ? settings.compact.lastRunAt + settings.compact.everyHours * 3600 * 1000 : 0
    }
  }

  ctx.inject(['webServer'], (wsCtx) => {
    const route = (spec) => wsCtx.effect(() => wsCtx.webServer.register(spec), `local-memory: ${spec.path}`)

    route({
      kind: 'exact',
      path: '/api/local-memory/state',
      handler: async (req, res) => {
        if (reject(req, res)) return
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          sendJson(res, 200, await statePayload())
        } catch (error) {
          sendJson(res, 500, { error: String(error?.message ?? error) })
        }
      }
    })

    route({
      kind: 'exact',
      path: '/api/local-memory/file',
      handler: async (req, res) => {
        if (reject(req, res)) return
        if (req.method === 'GET') {
          try {
            const url = new URL(String(req.url), 'http://localhost')
            const rel = str(url.searchParams.get('path'))
            if (rel === '') return sendJson(res, 400, { error: 'path is required' })
            const target = inside(paths().root, rel)
            const st = await stat(target).catch(() => undefined)
            if (st === undefined) return sendJson(res, 404, { error: 'not found' })
            const text = await readText(target, MAX_EDIT_BYTES)
            return sendJson(res, 200, { path: rel, text })
          } catch (error) {
            return sendJson(res, 400, { error: String(error?.message ?? error) })
          }
        }
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          const body = await readJson(req)
          const rel = str(body.path)
          const content = typeof body.content === 'string' ? body.content : ''
          if (rel === '') return sendJson(res, 400, { error: 'path is required' })
          if (Buffer.byteLength(content, 'utf8') > MAX_EDIT_BYTES) return sendJson(res, 413, { error: 'content too large' })
          const target = inside(paths().root, rel)
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, content, 'utf8')
          invalidateText(target)
          sendJson(res, 200, { ok: true, path: rel, bytes: Buffer.byteLength(content, 'utf8') })
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      }
    })

    route({
      kind: 'exact',
      path: '/api/local-memory/settings',
      handler: async (req, res) => {
        if (reject(req, res)) return
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          const body = await readJson(req)
          settings = sanitize({ ...settings, ...body, compact: { ...settings.compact, ...(body.compact ?? {}) } })
          root = rootOf(settings.dir || config.dir)
          await save()
          sendJson(res, 200, { ok: true, settings, root })
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) })
        }
      }
    })

    route({
      kind: 'exact',
      path: '/api/local-memory/distill',
      handler: async (req, res) => {
        if (reject(req, res)) return
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        if (running) return sendJson(res, 200, { started: false, running: true })
        runDistill('manual').catch(() => {})
        sendJson(res, 200, { started: true })
      }
    })

    route({
      kind: 'exact',
      path: '/api/local-memory/compact',
      handler: async (req, res) => {
        if (reject(req, res)) return
        if (req.method === 'GET') return sendJson(res, 200, { running, lastResult: settings.compact.lastResult })
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        if (running) return sendJson(res, 200, { started: false, running: true })
        runCompact('manual').catch(() => {})
        sendJson(res, 200, { started: true })
      }
    })
  })

  // ---------- 定时器 ----------
  const maybeScheduled = async () => {
    await ready
    const compact = settings.compact
    if (!compact.enabled || running) return
    // 积压够多且距上次提炼满 1 小时：先提炼，不等整日周期
    const pending = await pendingInbox()
    const lastDistillAt = compact.lastDistill?.at ?? 0
    if (shouldDistill(pending, lastDistillAt, Date.now())) {
      await runDistill('pending')
      return
    }
    // 空闲够久（默认 30 分钟）也提炼一次，不必等积压到 16KB
    const idleMs = (settings.capture.idleMinutes ?? 30) * 60 * 1000
    if (shouldDistillIdle(pending, lastActivityAt, lastDistillAt, Date.now(), idleMs)) {
      await runDistill('idle')
      return
    }
    if (Date.now() - compact.lastRunAt < compact.everyHours * 3600 * 1000) return
    await runCompact('scheduled')
  }
  const first = setTimeout(() => void maybeScheduled().catch(() => {}), FIRST_CHECK_MS)
  const timer = setInterval(() => void maybeScheduled().catch(() => {}), CHECK_MS)
  first.unref?.()
  timer.unref?.()
  ctx.effect(
    () => () => {
      clearTimeout(first)
      clearInterval(timer)
    },
    'local-memory: compaction timer'
  )

  return {
    paths,
    ready,
    get settings() {
      return settings
    },
    catalog,
    runCompact
  }
}

/** 相对根目录的展示路径。 */
function relativeOf(root, file) {
  return file === root ? '.' : relative(root, file)
}
