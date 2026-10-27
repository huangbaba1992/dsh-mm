// dsh-local-memory — 提炼与压缩任务：inbox → MEMORY/topics，文件压缩去重（Host 半内部模块）
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DISTILL_TOTAL_CHARS,
  DOC_CAP,
  DOC_RE,
  INBOX_DIR,
  MEMORY_TYPES,
  TOPIC_DIR,
  TYPE_NAME,
  collectDocs,
  indexLines,
  invalidateText,
  inside,
  mergeBody,
  normalizeIndexLine,
  parseDistill,
  parseFrontmatter,
  readText,
  relativeOf,
  safeTopicPath,
  stamp,
  stringifyFrontmatter,
  stripFence,
  uniquePath
} from './core.js'
import { COMPACT_SYSTEM, COMPACT_TIMEOUT_MS, DISTILL_SYSTEM } from './model.js'
import {
  archivePath,
  createBackup,
  moveToTrash,
  pruneArchive,
  pruneBackups,
  pruneTrash,
  recoverProcessing
} from './storage.js'

export const DISTILL_MAX_FILES = 3
export const DISTILL_MAX_TOPIC_FILES = 8
const MAX_PROMPT_CHARS = 72 * 1024

/** 今天的本地日期 YYYY-MM-DD。 */
function localDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** HH:MM。 */
function clock(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 把新提炼的事实并入 MEMORY.md：同一天追加“补充”，跨行去重。
 * @param {string} prior 现有 MEMORY.md
 * @param {string} facts 模型返回的索引文本
 * @param {Date} now
 * @returns {{text: string, added: number}}
 */
export function mergeIndex(prior, facts, now = new Date()) {
  const existing = new Set(indexLines(prior).map(normalizeIndexLine))
  const lines = []
  for (const line of indexLines(facts)) {
    const key = normalizeIndexLine(line)
    if (key === '' || existing.has(key)) continue
    existing.add(key)
    lines.push(line)
  }
  if (lines.length === 0) return { text: prior, added: 0 }
  const date = localDate(now)
  const heading = `## 从对话提炼（${date}）`
  const block = lines.join('\n')
  let text
  if (String(prior).trim() === '') {
    text = `# 长期记忆\n\n${heading}\n${block}\n`
  } else if (prior.includes(heading)) {
    text = `${prior.replace(/\s*$/, '')}\n\n### 补充 ${clock(now)}\n${block}\n`
  } else {
    text = `${prior.replace(/\s*$/, '')}\n\n${heading}\n${block}\n`
  }
  return { text, added: lines.length }
}

/** 统计 inbox 顶层待提炼文件。 */
export async function pendingInbox(root) {
  const folder = join(root, INBOX_DIR)
  let entries = []
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch {
    return { files: 0, bytes: 0 }
  }
  let files = 0
  let bytes = 0
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.') || !DOC_RE.test(entry.name)) continue
    const st = await stat(join(folder, entry.name)).catch(() => undefined)
    if (st === undefined) continue
    files += 1
    bytes += st.size
  }
  return { files, bytes }
}

/** 已有主题的摘要，供提炼时避免重复。 */
async function topicDigest(root) {
  const lines = []
  for (const file of await collectDocs(join(root, TOPIC_DIR), 300)) {
    const { data } = parseFrontmatter(await readText(file, DOC_CAP))
    const name = data.name || file.slice(file.lastIndexOf('/') + 1).replace(/\.md$/i, '')
    const description = data.description ? `：${data.description}` : ''
    lines.push(`- ${relativeOf(root, file)} — ${name}${description}（${data.type || 'note'}）`)
  }
  return lines.join('\n')
}

/**
 * 创建提炼/压缩任务。
 * @param {{
 *   config: {soulFile: string, memoryFile: string, maxMemoryBytes: number},
 *   getSettings: () => any,
 *   paths: () => {root: string, soulPath: string, memoryPath: string},
 *   model: {resolveRoute: Function, validateRoute: Function, askModelSafe: Function, explain: Function}
 * }} options
 */
export function createJobs({ config, getSettings, paths, model }) {
  /** 提炼 inbox 原文 → MEMORY.md 与 topics；成功后归档原文（大文件只归档已处理部分，余量回写 inbox）。 */
  const distillInbox = async () => {
    const settings = getSettings()
    const { root, soulPath, memoryPath } = paths()
    const folder = join(root, INBOX_DIR)
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

    const route = await model.resolveRoute(settings.compact)
    if (route === undefined) return { files: 0, facts: 0, topics: [], archived: [], error: 'no model selected' }
    try {
      await model.validateRoute(route)
    } catch (error) {
      return { files: 0, facts: 0, topics: [], archived: [], error: model.explain(error), model: route }
    }

    // 先改名挪走再读：提炼期间 capture 追加到同名新文件，不会污染正在提炼的内容。
    const picked = []
    let total = 0
    for (const file of docs.slice(0, DISTILL_MAX_FILES)) {
      const name = relativeOf(folder, file)
      const temp = join(folder, `.processing-${name}`)
      try {
        await rename(file, temp)
      } catch {
        continue
      }
      // inbox 原文要完整读入：按字节截断会丢掉后半段，归档后无法再提炼
      const text = await readFile(temp, 'utf8')
      if (text.trim() === '') {
        await rename(temp, file).catch(() => {})
        continue
      }
      const remaining = DISTILL_TOTAL_CHARS - total
      if (remaining < 2000) {
        await rename(temp, file).catch(() => {})
        break
      }
      let used = text
      let rest = ''
      if (text.length > remaining) {
        let cut = text.lastIndexOf('\n', remaining)
        if (cut < remaining * 0.6) cut = remaining
        used = text.slice(0, cut)
        rest = text.slice(cut)
      }
      picked.push({ temp, text: used, name, rest })
      total += used.length
      if (rest !== '') break
    }
    if (picked.length === 0) return { files: 0, facts: 0, topics: [], archived: [] }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('distill timed out')), COMPACT_TIMEOUT_MS)
    try {
      const [soulText, priorIndex, digest] = await Promise.all([
        readText(soulPath, DOC_CAP),
        readText(memoryPath, DISTILL_TOTAL_CHARS),
        topicDigest(root)
      ])
      const head = [
        soulText.trim() === '' ? '' : `### 用户画像（soul.md）\n${soulText.trim()}`,
        priorIndex.trim() === '' ? '' : `### 现有索引（MEMORY.md）\n${priorIndex.trim().slice(0, 12 * 1024)}`,
        digest.trim() === '' ? '' : `### 已有主题\n${digest.trim().slice(0, 12 * 1024)}`
      ]
        .filter((part) => part !== '')
        .join('\n\n')
      const body = picked.map((item) => `### ${item.name}\n${item.text}`).join('\n\n')
      // 只截断提示词头部，绝不截断待提炼原文（截断原文会导致归档后丢内容）
      const room = Math.max(0, MAX_PROMPT_CHARS - body.length - 32)
      const input = `${head.slice(0, room)}${head === '' ? '' : '\n\n'}### 待提炼原文\n${body}`
      const raw = await model.askModelSafe(route, DISTILL_SYSTEM, input, controller.signal)
      const parsed = parseDistill(raw)
      const facts = indexLines(parsed.index)
      if (parsed.index.trim() === '' && parsed.files.length === 0) throw new Error('模型没有返回可用的记忆内容')

      const now = new Date()
      let added = 0
      let overBudget = false
      if (facts.length > 0) {
        const prior = await readText(memoryPath, DISTILL_TOTAL_CHARS)
        const merged = mergeIndex(prior, parsed.index, now)
        added = merged.added
        if (merged.added > 0) {
          await mkdir(dirname(memoryPath), { recursive: true })
          await writeFile(memoryPath, merged.text, 'utf8')
          invalidateText(memoryPath)
        }
        if (merged.text.length > config.maxMemoryBytes) {
          overBudget = true
          try {
            const rawIndex = await model.askModelSafe(route, COMPACT_SYSTEM, merged.text.slice(0, DISTILL_TOTAL_CHARS), controller.signal)
            const compacted = stripFence(rawIndex).trim()
            if (compacted.length >= 32 && compacted.length <= merged.text.length * 0.95) {
              await writeFile(memoryPath, `${compacted}\n`, 'utf8')
              invalidateText(memoryPath)
              overBudget = compacted.length > config.maxMemoryBytes
            }
          } catch {
            /* 压缩失败保留原索引，下一次整理再试 */
          }
        }
      }

      // 主题文件：统一 topics/ + frontmatter，跨文件按行去重
      const reserved = new Set([String(config.soulFile).toLowerCase(), String(config.memoryFile).toLowerCase(), 'inbox', 'archive', 'backups', 'trash', 'meta'])
      const knownLines = new Set()
      for (const file of await collectDocs(join(root, TOPIC_DIR), 500)) {
        const { body: priorBody } = parseFrontmatter(await readText(file, DOC_CAP))
        for (const line of priorBody.split('\n')) {
          const trimmed = line.trim()
          if (trimmed !== '') knownLines.add(trimmed)
        }
      }
      const topics = []
      const today = localDate(now)
      for (const item of parsed.files.slice(0, DISTILL_MAX_TOPIC_FILES)) {
        const normalized = safeTopicPath(item.path, reserved)
        if (normalized === undefined) continue
        try {
          const target = inside(root, normalized.path)
          const { data, body } = parseFrontmatter(item.content)
          const prior = await readFile(target, 'utf8').catch(() => '')
          const priorParts = parseFrontmatter(prior)
          const fresh = []
          for (const line of body.split('\n')) {
            const trimmed = line.trim()
            if (trimmed === '' || knownLines.has(trimmed)) continue
            knownLines.add(trimmed)
            fresh.push(line)
          }
          if (fresh.length === 0) continue
          const fileName = normalized.path.slice(normalized.path.lastIndexOf('/') + 1)
          const declared = String(data.type ?? '').toLowerCase()
          const type = MEMORY_TYPES.includes(declared) ? declared : normalized.type
          const name = data.name || priorParts.data.name || fileName.replace(/\.md$/i, '')
          const description = data.description || priorParts.data.description || ''
          const merged = stringifyFrontmatter(
            { ...priorParts.data, name, description, type, updated: today },
            mergeBody(priorParts.body, fresh.join('\n'))
          )
          if (merged.length > DOC_CAP || merged === prior) continue
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, merged, 'utf8')
          invalidateText(target)
          topics.push({ path: normalized.path, name, type, added: fresh.length })
        } catch {
          /* 单个主题文件失败不影响整体提炼 */
        }
      }

      // 归档已处理原文；大文件剩余部分回写 inbox，下次继续
      const archive = join(folder, 'archive')
      const archived = []
      const warnings = []
      for (const item of picked) {
        if (item.rest.trim() !== '') {
          const restName = `${item.name.replace(/\.md$/i, '')}-rest-${stamp(now)}.md`
          try {
            const restPath = await uniquePath(folder, restName)
            await writeFile(restPath, `## ${clock(now)} · 续（上次提炼剩余）\n\n${item.rest.trim()}\n`, 'utf8')
          } catch (error) {
            warnings.push(`剩余原文回写失败：${String(error?.message ?? error)}`)
          }
        }
        const target = await archivePath(folder, item.name)
        await rename(item.temp, target).catch(() => {})
        archived.push(relativeOf(archive, target))
      }
      if (typeof settings.trash?.keepDays === 'number') await pruneTrash(root, settings.trash.keepDays)
      await pruneArchive(folder)
      return {
        files: picked.length,
        facts: added,
        topics,
        archived,
        model: route,
        ...(overBudget ? { overBudget: true } : {}),
        ...(warnings.length > 0 ? { warnings } : {})
      }
    } catch (error) {
      // 失败：把挪走的文件放回 inbox（同名就换名），原文不丢
      for (const item of picked) {
        const target = await uniquePath(folder, item.name)
        await rename(item.temp, target).catch(() => {})
      }
      return { files: 0, facts: 0, topics: [], archived: [], error: model.explain(error), model: route }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 跑一次压缩：先移除完全相同的文件（进回收站），再让模型压缩大文件；返回摘要，不抛错。 */
  const compactOnce = async (reason) => {
    const settings = getSettings()
    const { root, soulPath } = paths()
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
    let files = []
    for (const file of await collectDocs(root, 500)) {
      if (file === soulPath) continue
      if (relativeOf(root, file).startsWith(INBOX_DIR + '/')) continue
      const st = await stat(file).catch(() => undefined)
      if (st === undefined) continue
      files.push({ file, bytes: st.size })
      result.bytesBefore += st.size
    }
    result.scanned = files.length

    let backup = null
    const ensureBackup = async () => {
      if (backup !== null || settings.compact.backupBeforeRun === false) return
      backup = await createBackup(root, paths())
      result.backup = backup
    }

    // 1) 完全相同的文件：保留一个，其余进回收站（可恢复），MEMORY.md 优先保留。
    if (settings.compact.removeExactDuplicates) {
      const { memoryPath } = paths()
      const seen = new Map()
      const trashed = new Set()
      for (const entry of files) {
        if (entry.bytes > DOC_CAP) continue
        const text = await readText(entry.file, DOC_CAP)
        if (text === '') continue
        const hash = createHash('sha1').update(text).digest('hex')
        const prior = seen.get(hash)
        if (entry.file === memoryPath) {
          seen.set(hash, entry.file)
          if (prior !== undefined && prior !== entry.file) {
            try {
              await ensureBackup()
              await moveToTrash(root, relativeOf(root, prior))
              invalidateText(prior)
              trashed.add(prior)
              result.removed.push({ path: relativeOf(root, prior), duplicateOf: relativeOf(root, entry.file), trashed: true })
            } catch (error) {
              result.skipped.push({ path: relativeOf(root, prior), why: `dedupe failed: ${String(error?.message ?? error)}` })
            }
          }
          continue
        }
        if (prior === undefined) {
          seen.set(hash, entry.file)
          continue
        }
        try {
          await ensureBackup()
          await moveToTrash(root, relativeOf(root, entry.file))
          invalidateText(entry.file)
          trashed.add(entry.file)
          result.removed.push({ path: relativeOf(root, entry.file), duplicateOf: relativeOf(root, prior), trashed: true })
        } catch (error) {
          result.skipped.push({ path: relativeOf(root, entry.file), why: `dedupe failed: ${String(error?.message ?? error)}` })
        }
      }
      files = files.filter((entry) => !trashed.has(entry.file))
    }

    // 2) 大文件交给模型压缩；只接受明显变小的结果。
    const route = await model.resolveRoute(settings.compact)
    if (route === undefined) {
      result.skipped.push({ path: '*', why: 'no model selected (set one in Settings → Local Memory)' })
    } else {
      try {
        await model.validateRoute(route)
      } catch (error) {
        result.skipped.push({ path: '*', why: model.explain(error) })
      }
      result.model = route
      let done = 0
      for (const entry of files) {
        if (result.skipped.some((item) => item.path === '*')) break
        if (done >= settings.compact.maxFilesPerRun) break
        if (entry.bytes < settings.compact.minFileBytes) continue
        const rel = relativeOf(root, entry.file)
        if (entry.bytes > settings.compact.maxInputBytes) {
          result.skipped.push({ path: rel, why: 'larger than maxInputBytes' })
          continue
        }
        const exists = await stat(entry.file).catch(() => undefined)
        if (exists === undefined) continue
        const before = await readFile(entry.file, 'utf8')
        const typed = rel.startsWith(TOPIC_DIR + '/') || Object.keys(TYPE_NAME).some((dir) => rel.startsWith(dir + '/'))
        const parts = typed ? parseFrontmatter(before) : undefined
        const bodyText = parts === undefined ? before : parts.body
        const input = bodyText.slice(0, settings.compact.maxInputBytes)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(new Error('compaction timed out')), COMPACT_TIMEOUT_MS)
        try {
          const raw = await model.askModelSafe(route, COMPACT_SYSTEM, input, controller.signal)
          const after = stripFence(raw)
          if (after === '' || after.length < 8) {
            result.skipped.push({ path: rel, why: 'model returned nothing usable' })
          } else if (after.length > bodyText.length * 0.95) {
            result.skipped.push({ path: rel, why: 'model did not shrink the file' })
          } else {
            await ensureBackup()
            const nextText =
              parts === undefined ? `${after}\n` : stringifyFrontmatter({ ...parts.data, updated: localDate() }, after)
            await writeFile(entry.file, nextText, 'utf8')
            invalidateText(entry.file)
            result.rewritten.push({ path: rel, before: before.length, after: after.length })
            done += 1
          }
        } catch (error) {
          result.skipped.push({ path: rel, why: model.explain(error) })
        } finally {
          clearTimeout(timer)
        }
      }
    }

    // 3) 清理过期归档/回收站/备份，汇总体积。
    if (typeof settings.trash?.keepDays === 'number') await pruneTrash(root, settings.trash.keepDays)
    await pruneArchive(join(root, INBOX_DIR))
    await pruneBackups(root)
    for (const entry of files) {
      const st = await stat(entry.file).catch(() => undefined)
      if (st !== undefined) result.bytesAfter += st.size
    }
    return result
  }

  return { distillInbox, compactOnce, pendingInbox }
}
