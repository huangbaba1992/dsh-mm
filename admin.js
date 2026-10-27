// dsh-local-memory — 管理面：设置文件、Web 路由、对话记录、定时任务（Host 半内部模块）
import { appendFile, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  DOC_CAP,
  DOC_RE,
  GROUPS,
  INBOX_DIR,
  MAX_EDIT_BYTES,
  MEMORY_TYPES,
  TOPIC_DIR,
  TYPE_GROUP,
  TYPE_NAME,
  byteSize,
  collectDocs,
  fileName,
  inside,
  invalidateText,
  isUnder,
  parseFrontmatter,
  readText,
  relativeOf,
  rootOf,
  sanitizeSettings,
  shouldDistill,
  shouldDistillIdle,
  slugify,
  str,
  stringifyFrontmatter,
  writablePath
} from './core.js'
import { createJobs } from './jobs.js'
import { createModel } from './model.js'
import {
  createBackup,
  deleteBackup,
  emptyTrash,
  ensureLayout,
  listBackups,
  listTrash,
  moveToTrash,
  purgeTrash,
  restoreBackup,
  restoreTrash,
  pruneBackups,
  pruneTrash
} from './storage.js'

const MAX_BODY = 1 << 20
const CHECK_MS = 10 * 60 * 1000
const FIRST_CHECK_MS = 3 * 60 * 1000
const SESSION_END_MIN_GAP_MS = 60 * 1000
const MAX_CAPTURE_EVENTS = 40
const MAX_INBOX_PREVIEW = 30
const MAX_TRASH_ITEMS = 200

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

/** 统一处理路由错误：带 status 的错误回原状态码。 */
function sendError(res, error) {
  const status = Number(error?.status) >= 400 ? Number(error.status) : 400
  sendJson(res, status, { error: String(error?.message ?? error) })
}

/**
 * 创建管理面。
 * @param {any} ctx Host 插件上下文
 * @param {{dir: string, soulFile: string, memoryFile: string, maxMemoryBytes: number}} config
 */
export function createAdmin(ctx, config) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const stateFile = join(home, 'local-memory.json')

  let settings = sanitizeSettings(undefined)
  let root = rootOf(config.dir)
  let running = false

  const soulName = fileName(config.soulFile, 'soul.md')
  const memoryName = fileName(config.memoryFile, 'MEMORY.md')
  const model = createModel(ctx)

  const paths = () => ({
    root,
    soulPath: inside(root, soulName),
    memoryPath: inside(root, memoryName),
    topicDir: join(root, TOPIC_DIR),
    inboxDir: join(root, INBOX_DIR)
  })

  const jobs = createJobs({ config, getSettings: () => settings, paths, model })

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
            const stem = entry.name.replace(/\.md$/i, '')
            for (let n = 2; n < 1000; n += 1) {
              const candidate = join(topicsDir, `${stem}-${n}.md`)
              if (await stat(candidate).then(() => false, () => true)) {
                to = candidate
                break
              }
            }
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
      settings = sanitizeSettings(JSON.parse(await readFile(stateFile, 'utf8')))
    } catch {
      settings = sanitizeSettings(undefined)
    }
    root = rootOf(settings.dir || config.dir)
    await ensureLayout(root)
    await migrateLegacyDirs(root)
    await pruneTrash(root, settings.trash.keepDays).catch(() => {})
    await pruneBackups(root, settings.backup.keep).catch(() => {})
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
    const joinBlocks = (blocks) => {
      if (!Array.isArray(blocks)) return ''
      const text = blocks
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim()
      return text.length > cap ? `${text.slice(0, cap)}…` : text
    }
    if (event?.type === 'user/message') {
      const source = event.data?.source
      if (!(source === undefined || source === null || source.kind === 'user')) return ''
      const text = joinBlocks(event.data?.content)
      return text === '' ? '' : `**你**：${text}`
    }
    if (event?.type === 'assistant/message') {
      const text = joinBlocks(event.data?.message?.content)
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
      if (slot.length >= MAX_CAPTURE_EVENTS) return
      slot.push(text)
      pending.set(session.id, slot)
    } catch {
      /* 记录失败不影响会话 */
    }
  })

  const localDay = (date) => {
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  const flushCapture = async (agent, turn) => {
    const id = agent?.session?.id
    if (id === undefined) return
    const slot = pending.get(id)
    if (slot === undefined) return
    pending.delete(id)
    if (settings.capture.enabled !== true || slot.length === 0) return
    const now = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    const folder = join(paths().root, INBOX_DIR)
    await ensureLayout(paths().root)
    const turnId = typeof turn === 'number' || typeof turn === 'string' ? turn : '?'
    const entry = `\n## ${pad(now.getHours())}:${pad(now.getMinutes())} · turn ${turnId}\n\n${slot.join('\n\n')}\n`
    try {
      await appendFile(join(folder, `${localDay(now)}.md`), entry, 'utf8')
    } catch (error) {
      // 写盘失败时把本轮塞回去，下一轮一起写，别静默丢内容
      const back = pending.get(id) ?? []
      pending.set(id, [...slot, ...back].slice(-MAX_CAPTURE_EVENTS))
      throw error
    }
  }

  ctx.on('agent/turn-stopping', (payload) => {
    flushCapture(payload?.agent, payload?.turn).catch(() => {})
  })

  ctx.on('agent/disposed', (payload) => {
    const id = payload?.agent?.session?.id
    if (id !== undefined) pending.delete(id)
  })

  /** 最后一个会话关闭后：有待提炼就立刻跑一次。 */
  const maybeDistillOnClose = async () => {
    if (running || settings.distill.enabled !== true) return
    try {
      const agents = ctx.get('agents')
      const live = typeof agents?.list === 'function' ? agents.list().length : 0
      if (live > 0) return
      const count = await jobs.pendingInbox(root)
      if (count.bytes === 0) return
      if (Date.now() - settings.distill.lastRunAt < SESSION_END_MIN_GAP_MS) return
      await runDistill('session-end')
    } catch {
      /* 关闭阶段失败不影响宿主 */
    }
  }

  ctx.on('session/disposed', () => {
    void maybeDistillOnClose()
  })

  const reject = (req, res) => {
    const status = ctx.get('connection')?.requestRejection?.(req)
    if (status === undefined) return false
    res.statusCode = status
    res.end()
    return true
  }

  // ---------- 提炼 / 压缩 ----------
  const runDistill = async (reason) => {
    if (running) return { started: false, running: true }
    running = true
    try {
      await ready
      await ensureLayout(root)
      const distilled = await jobs.distillInbox()
      settings.distill.lastRunAt = Date.now()
      settings.distill.lastResult = { at: Date.now(), reason, ...distilled }
      await save()
      return { started: true, distilled }
    } catch (error) {
      const message = model.explain(error)
      settings.distill.lastRunAt = Date.now()
      settings.distill.lastResult = { at: Date.now(), reason, files: 0, facts: 0, archived: [], error: message }
      await save().catch(() => {})
      return { started: false, error: message }
    } finally {
      running = false
    }
  }

  const runCompact = async (reason) => {
    if (running) return { started: false, running: true }
    running = true
    try {
      await ready
      await ensureLayout(root)
      // 顺序固定：先提炼 inbox，再压缩记忆文件（提炼产出的内容也要进压缩流程）
      const distilled = await jobs.distillInbox().catch((error) => ({ error: model.explain(error) }))
      settings.distill.lastRunAt = Date.now()
      settings.distill.lastResult = { at: Date.now(), reason, ...distilled }
      const result = await jobs.compactOnce(reason)
      result.distilled = distilled
      settings.compact.lastRunAt = Date.now()
      settings.compact.lastResult = result
      await save()
      return { started: true, result }
    } catch (error) {
      const message = model.explain(error)
      settings.compact.lastRunAt = Date.now()
      settings.compact.lastResult = { at: Date.now(), reason, error: message }
      await save().catch(() => {})
      return { started: true, error: message }
    } finally {
      running = false
    }
  }

  // ---------- 状态 ----------
  const readCore = async (file, cap) => {
    const st = await stat(file).catch(() => undefined)
    const text = await readText(file, cap)
    return { text, bytes: byteSize(text), fileBytes: st?.size ?? 0, truncated: (st?.size ?? 0) > cap }
  }

  const statePayload = async () => {
    await ready
    const { root: current, soulPath, memoryPath } = paths()
    const memoryFiles = []
    for (const file of await collectDocs(current, 500)) {
      const rel = relativeOf(current, file)
      if (isUnder(rel, INBOX_DIR)) continue
      const st = await stat(file).catch(() => undefined)
      memoryFiles.push({ path: rel, bytes: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 })
    }

    const topics = Object.fromEntries(GROUPS.map((key) => [key, 0]))
    const topicFiles = Object.fromEntries(GROUPS.map((key) => [key, []]))
    for (const file of await collectDocs(join(current, TOPIC_DIR), 500)) {
      const rel = relativeOf(current, file)
      const st = await stat(file).catch(() => undefined)
      const { data } = parseFrontmatter(await readText(file, DOC_CAP))
      const type = String(data.type ?? '').toLowerCase()
      const group = TYPE_GROUP[type] ?? 'other'
      topicFiles[group].push({
        path: rel,
        name: data.name || rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/i, ''),
        type: type || 'note',
        description: data.description ?? '',
        updated: data.updated ?? '',
        bytes: st?.size ?? 0,
        mtime: st?.mtimeMs ?? 0
      })
    }
    for (const key of GROUPS) {
      topicFiles[key].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      topics[key] = topicFiles[key].length
    }

    const [soul, memory, catalog, pendingCount] = await Promise.all([
      readCore(soulPath, MAX_EDIT_BYTES),
      readCore(memoryPath, MAX_EDIT_BYTES),
      model.catalog(),
      jobs.pendingInbox(current)
    ])

    const inboxFiles = []
    let archivedCount = 0
    try {
      const entries = await readdir(join(current, INBOX_DIR), { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name === 'archive') {
          archivedCount = (await readdir(join(current, INBOX_DIR, 'archive')).catch(() => [])).filter((name) => DOC_RE.test(name)).length
          continue
        }
        if (!entry.isFile() || entry.name.startsWith('.') || !DOC_RE.test(entry.name)) continue
        const st = await stat(join(current, INBOX_DIR, entry.name)).catch(() => undefined)
        inboxFiles.push({ name: entry.name, bytes: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 })
      }
    } catch {
      /* inbox 还没建立 */
    }
    inboxFiles.sort((a, b) => (a.name < b.name ? 1 : -1))

    const trash = await listTrash(current).then(
      (items) => items.slice(0, MAX_TRASH_ITEMS),
      () => []
    )
    const backups = await listBackups(current)
    const route = await model.resolveRoute(settings.compact)
    const warnings = []
    if (route === undefined) warnings.push({ code: 'no-model', text: '未选择整理模型：自动提炼与压缩会被跳过，可在设置页选择。' })
    if (memory.fileBytes > config.maxMemoryBytes) warnings.push({ code: 'memory-over', text: `MEMORY.md 已超过注入预算（${memory.fileBytes} > ${config.maxMemoryBytes} 字节），注入内容会被截断。` })
    if (settings.distill.enabled === true && pendingCount.bytes >= settings.distill.minPendingKB * 1024) {
      warnings.push({ code: 'pending', text: `inbox 积压 ${pendingCount.files} 个文件 / ${pendingCount.bytes} 字节，达到提前提炼阈值。` })
    }
    if (settings.compact.enabled === true && route === undefined) warnings.push({ code: 'compact-disabled-effectively', text: '定时整理已开启但没有可用模型，只会做去重。' })

    return {
      root: current,
      soulPath,
      memoryPath,
      soulFile: soulName,
      memoryFile: memoryName,
      caps: { soul: 4096, memory: config.maxMemoryBytes, doc: DOC_CAP },
      files: memoryFiles,
      soul: { ...soul, cap: 4096 },
      memory: { ...memory, cap: config.maxMemoryBytes },
      settings,
      catalog: {
        default: catalog.default ?? null,
        groups: catalog.groups ?? [],
        failures: catalog.failures ?? []
      },
      running,
      lastRunAt: settings.compact.lastRunAt,
      lastResult: settings.compact.lastResult,
      lastDistill: settings.distill.lastResult,
      distill: settings.distill,
      pending: pendingCount,
      nextRunAt:
        settings.compact.enabled === true
          ? settings.compact.lastRunAt > 0
            ? settings.compact.lastRunAt + settings.compact.everyHours * 3600 * 1000
            : Date.now() + 10 * 60 * 1000
          : 0,
      topics,
      topicFiles,
      inbox: { files: inboxFiles.slice(0, MAX_INBOX_PREVIEW), count: inboxFiles.length, archived: archivedCount },
      trash,
      backups,
      warnings
    }
  }

  /** /memory 命令的纯文本摘要。 */
  const describe = async () => {
    const state = await statePayload()
    const lines = [
      `Memory root: ${state.root}`,
      `soul: ${state.soulFile} ${state.soul.bytes} B / ${state.caps.soul} B`,
      `index: ${state.memoryFile} ${state.memory.bytes} B / ${state.caps.memory} B${state.memory.truncated ? '（注入已截断）' : ''}`,
      `topics: ${state.files.filter((file) => file.path.startsWith(TOPIC_DIR + '/')).length} · ${GROUPS.map((key) => `${key} ${state.topics[key]}`).join(' · ')}`,
      `inbox pending: ${state.pending.files} file(s) · ${state.pending.bytes} B · archived ${state.inbox.archived}`
    ]
    if (state.lastDistill !== null && state.lastDistill !== undefined) {
      lines.push(`Last distill: ${state.lastDistill.error !== undefined ? `error: ${state.lastDistill.error}` : `${state.lastDistill.files ?? 0} file(s), ${state.lastDistill.facts ?? 0} fact(s), ${state.lastDistill.topics?.length ?? 0} topic file(s)`}`)
    }
    if (state.lastResult !== null && state.lastResult !== undefined) {
      lines.push(
        `Last compact: ${state.lastResult.error !== undefined ? `error: ${state.lastResult.error}` : `${state.lastResult.rewritten?.length ?? 0} rewritten, ${state.lastResult.removed?.length ?? 0} moved to trash`}`
      )
    }
    if (state.nextRunAt > 0) lines.push(`Next scheduled compact: ${new Date(state.nextRunAt).toLocaleString()}`)
    if (state.warnings.length > 0) lines.push('', ...state.warnings.map((warning) => `! ${warning.text}`))
    return lines.join('\n')
  }

  // ---------- 路由 ----------
  ctx.inject(['webServer'], (wsCtx) => {
    const route = (path, handler) =>
      wsCtx.effect(() => wsCtx.webServer.register({ kind: 'exact', path, handler }), `local-memory: ${path}`)

    route('/api/local-memory/state', async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      try {
        sendJson(res, 200, await statePayload())
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message ?? error) })
      }
    })

    route('/api/local-memory/file', async (req, res) => {
      if (reject(req, res)) return
      try {
        if (req.method === 'GET') {
          const url = new URL(String(req.url), 'http://localhost')
          const rel = str(url.searchParams.get('path'))
          if (rel === '') return sendJson(res, 400, { error: 'path is required' })
          const target = inside(paths().root, rel)
          const st = await stat(target).catch(() => undefined)
          if (st === undefined || !st.isFile()) return sendJson(res, 404, { error: 'not found' })
          const text = await readText(target, MAX_EDIT_BYTES)
          return sendJson(res, 200, { path: rel, text, bytes: byteSize(text), size: st.size, truncated: st.size > MAX_EDIT_BYTES })
        }
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        const body = await readJson(req)
        const rel = str(body.path)
        const content = typeof body.content === 'string' ? body.content : ''
        if (rel === '') return sendJson(res, 400, { error: 'path is required' })
        if (byteSize(content) > MAX_EDIT_BYTES) return sendJson(res, 413, { error: 'content too large' })
        const allowed = writablePath(rel, { soulFile: soulName, memoryFile: memoryName })
        const target = inside(paths().root, allowed.path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content, 'utf8')
        invalidateText(target)
        return sendJson(res, 200, { ok: true, path: allowed.path, bytes: byteSize(content) })
      } catch (error) {
        sendError(res, error)
      }
    })

    route('/api/local-memory/topic', async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      try {
        const body = await readJson(req)
        const name = str(body.name)
        const type = str(body.type, 'note')
        if (name === '') return sendJson(res, 400, { error: 'name is required' })
        if (!MEMORY_TYPES.includes(type)) return sendJson(res, 400, { error: `type must be one of ${MEMORY_TYPES.join(', ')}` })
        const slug = slugify(name)
        if (slug === '') return sendJson(res, 400, { error: 'name contains no usable characters' })
        const folder = join(paths().root, TOPIC_DIR)
        await mkdir(folder, { recursive: true })
        const target = await uniqueFileName(folder, slug)
        const bodyText = typeof body.body === 'string' ? body.body : ''
        if (byteSize(bodyText) > MAX_EDIT_BYTES) return sendJson(res, 413, { error: 'content too large' })
        const description = str(body.description) || str(bodyText).split('\n').map((line) => line.trim()).find((line) => line !== '')?.replace(/^[-#*\s]+/, '').slice(0, 80) || ''
        const now = new Date()
        const pad = (value) => String(value).padStart(2, '0')
        const updated = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
        const content = stringifyFrontmatter({ name, description, type, updated }, bodyText)
        await writeFile(target, content, 'utf8')
        invalidateText(target)
        return sendJson(res, 200, { ok: true, path: relativeOf(paths().root, target), type })
      } catch (error) {
        sendError(res, error)
      }
    })

    route('/api/local-memory/delete', async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      try {
        const body = await readJson(req)
        const rel = str(body.path)
        const allowed = writablePath(rel, { soulFile: soulName, memoryFile: memoryName })
        if (!allowed.isTopic || allowed.path !== rel) return sendJson(res, 400, { error: `only ${TOPIC_DIR}/ files can be deleted` })
        const moved = await moveToTrash(paths().root, rel)
        invalidateText(inside(paths().root, rel))
        return sendJson(res, 200, { ok: true, ...moved })
      } catch (error) {
        sendError(res, error)
      }
    })

    route('/api/local-memory/trash', async (req, res) => {
      if (reject(req, res)) return
      try {
        if (req.method === 'GET') return sendJson(res, 200, { items: await listTrash(paths().root) })
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        const body = await readJson(req)
        const action = str(body.action, 'restore')
        if (action === 'restore') {
          const result = await restoreTrash(paths().root, str(body.id), str(body.path))
          return sendJson(res, 200, { ok: true, ...result })
        }
        if (action === 'purge') {
          await purgeTrash(paths().root, str(body.id), str(body.path))
          return sendJson(res, 200, { ok: true })
        }
        if (action === 'empty') {
          await emptyTrash(paths().root)
          return sendJson(res, 200, { ok: true })
        }
        return sendJson(res, 400, { error: `unknown action: ${action}` })
      } catch (error) {
        sendError(res, error)
      }
    })

    route('/api/local-memory/backup', async (req, res) => {
      if (reject(req, res)) return
      try {
        if (req.method === 'GET') return sendJson(res, 200, { items: await listBackups(paths().root) })
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        const body = await readJson(req)
        const action = str(body.action, 'create')
        if (action === 'create') return sendJson(res, 200, { ok: true, backup: await createBackup(paths().root, paths(), settings.backup.keep) })
        if (action === 'delete') return sendJson(res, 200, { ok: true, ...(await deleteBackup(paths().root, str(body.id))) })
        if (action === 'restore') return sendJson(res, 200, { ok: true, ...(await restoreBackup(paths().root, str(body.id))) })
        return sendJson(res, 400, { error: `unknown action: ${action}` })
      } catch (error) {
        sendError(res, error)
      }
    })

    route('/api/local-memory/settings', async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      try {
        const body = await readJson(req)
        const priorKeep = settings.backup.keep
        const next = sanitizeSettings({
          ...settings,
          ...body,
          compact: { ...settings.compact, ...(body.compact ?? {}) },
          distill: { ...settings.distill, ...(body.distill ?? {}) },
          capture: { ...settings.capture, ...(body.capture ?? {}) },
          trash: { ...settings.trash, ...(body.trash ?? {}) },
          backup: { ...settings.backup, ...(body.backup ?? {}) }
        })
        settings = next
        const nextRoot = rootOf(settings.dir || config.dir)
        if (nextRoot !== root) {
          root = nextRoot
          await ensureLayout(root)
          await migrateLegacyDirs(root)
        }
        if (settings.backup.keep !== priorKeep) await pruneBackups(root, settings.backup.keep).catch(() => {})
        await save()
        return sendJson(res, 200, { ok: true, settings, root })
      } catch (error) {
        sendError(res, error)
      }
    })

    route('/api/local-memory/distill', async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (running) return sendJson(res, 200, { started: false, running: true })
      const task = runDistill('manual')
      task.catch(() => {})
      return sendJson(res, 200, { started: true })
    })

    route('/api/local-memory/compact', async (req, res) => {
      if (reject(req, res)) return
      if (req.method === 'GET') return sendJson(res, 200, { running, lastResult: settings.compact.lastResult })
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
      if (running) return sendJson(res, 200, { started: false, running: true })
      const task = runCompact('manual')
      task.catch(() => {})
      return sendJson(res, 200, { started: true })
    })
  })

  // ---------- 定时器 ----------
  const maybeScheduled = async () => {
    await ready
    if (running) return
    const now = Date.now()
    if (settings.distill.enabled === true) {
      const count = await jobs.pendingInbox(root)
      if (shouldDistill(count, settings.distill.lastRunAt, now, settings.distill.minPendingKB * 1024)) {
        await runDistill('pending')
        return
      }
      if (shouldDistillIdle(count, lastActivityAt, settings.distill.lastRunAt, now, settings.distill.idleMinutes * 60 * 1000)) {
        await runDistill('idle')
        return
      }
    }
    if (settings.compact.enabled !== true) return
    if (now - settings.compact.lastRunAt < settings.compact.everyHours * 3600 * 1000) return
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
    model,
    jobs,
    statePayload,
    describe,
    runCompact,
    runDistill
  }
}

/** 在目录里找一个不冲突的文件名（保留扩展名）。 */
async function uniqueFileName(folder, slug) {
  let candidate = join(folder, `${slug}.md`)
  if (await stat(candidate).then(() => false, () => true)) return candidate
  for (let n = 2; n < 1000; n += 1) {
    candidate = join(folder, `${slug}-${n}.md`)
    if (await stat(candidate).then(() => false, () => true)) return candidate
  }
  return join(folder, `${slug}-${Date.now()}.md`)
}
