// dsh-local-memory — 纯本地 soul + 跨会话记忆（Host 半入口，无网络）
// Config.dir 里：soul.md（身份，注入靠前）、MEMORY.md（索引，注入靠后），主题在 topics/。
// 管理面（设置文件、Web 路由、定时任务）在 admin.js；模型调用在 model.js；前端在 client.js。
import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import {
  cachedReader,
  CONCURRENCY,
  DOC_CAP,
  inside,
  invalidateText,
  isUnder,
  MAX_HITS,
  mergeBody,
  normalizeConfig,
  parseFrontmatter,
  readBody,
  readText,
  SEARCH_CAP,
  SEARCH_FILES,
  SOUL_CAP,
  stringifyFrontmatter,
  TOPIC_DIR,
  TYPE_GROUP,
  walkDocs,
  writablePath
} from './core.js'
import { createAdmin } from './admin.js'
import { moveToTrash } from './storage.js'

export const name = 'local-memory'
export const inject = ['systemPrompt', 'tools', 'commands']

const MAX_TOOL_LIST = 200
const TOOL_DESCRIPTION =
  'Local long-term memory folder (Markdown). op=search finds text, op=read loads one file, op=write stores or updates a fact, op=list lists topic files, op=delete moves a topic file to the trash. Save durable facts, preferences, and decisions as you learn them; do not wait to be asked.'

/** 追加走 appendFile（不读旧内容），替换走 writeFile；都同步失效读缓存。 */
async function writeMemory(target, content, append) {
  if (!append) {
    await writeFile(target, content, 'utf8')
  } else {
    const size = await stat(target).then((st) => st.size, () => 0)
    await appendFile(target, size > 0 ? `\n\n${content}` : content, 'utf8')
  }
  invalidateText(target)
}

/** 当天本地日期。 */
function today() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 新主题文件的 frontmatter。 */
function topicFrontmatter(name, type, body) {
  const firstLine = String(body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? ''
  return {
    name,
    description: firstLine.replace(/^[-#*\s]+/, '').slice(0, 80),
    type,
    updated: today()
  }
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const admin = createAdmin(ctx, config)
  const readSoul = cachedReader(SOUL_CAP)
  const readMemory = cachedReader(config.maxMemoryBytes)
  const order = (n) => ctx.systemPrompt.getSectionOrder(n)

  // 1) soul：靠前的身份段
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'local-memory:soul',
        order: order('DEPLOYMENT_PERSONA_PREFIX') + 1,
        interpolate: false,
        text: () => {
          try {
            return readSoul(admin.paths().soulPath).trim()
          } catch {
            return ''
          }
        }
      }),
    'local-memory:soul'
  )

  // 2) 长期记忆：靠后的段，改写只影响提示词尾部
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'local-memory:facts',
        order: order('DEPLOYMENT_PERSONA_SUFFIX') - 100,
        interpolate: false,
        text: () => {
          try {
            const { memoryPath } = admin.paths()
            const facts = readMemory(memoryPath).trim()
            return facts === '' ? '' : `Long-term memory (${memoryPath}):\n${facts}`
          } catch {
            return ''
          }
        }
      }),
    'local-memory:facts'
  )

  // 3) 单个工具：search / read / write / list / delete
  ctx.tools.register({
    name: 'memory',
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['op'],
      properties: {
        op: { type: 'string', enum: ['search', 'read', 'write', 'list', 'delete'], description: 'Operation to run.' },
        query: { type: 'string', description: 'search: case-insensitive substring.' },
        path: { type: 'string', description: 'read/write/delete: path relative to the memory root, e.g. "topics/li.md". list: optional path prefix.' },
        content: { type: 'string', description: 'write: exact text; Markdown allowed.' },
        append: { type: 'boolean', description: 'write: append instead of replacing the file (default true).' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: { text: { type: 'string' } }
      },
      render: (_args, value) => [{ type: 'text', text: value.text }]
    },
    async execute(args, exec) {
      const op = args.op
      const { root } = admin.paths()

      if (op === 'search') {
        const query = String(args.query ?? '').trim().toLowerCase()
        if (query === '') throw new Error('memory: search needs a query')
        const hits = []
        const batch = []
        let scanned = 0
        // 一批并发读 CONCURRENCY 个文件，结果仍按遍历顺序追加，命中顺序稳定。
        const flush = async () => {
          const files = batch.splice(0)
          const texts = await Promise.all(files.map((file) => readText(file, SEARCH_CAP)))
          for (let k = 0; k < files.length && hits.length < MAX_HITS; k += 1) {
            const lines = texts[k].split('\n')
            for (let i = 0; i < lines.length && hits.length < MAX_HITS; i += 1) {
              if (lines[i].toLowerCase().includes(query)) hits.push(`${relative(root, files[k])}:${i + 1}: ${lines[i].slice(0, 200)}`)
            }
          }
        }
        for await (const file of walkDocs(root)) {
          if (exec?.signal?.aborted) break
          // 原始对话日志（inbox/）不参与检索：它们是提炼原料，不是记忆本身。
          if (isUnder(relative(root, file), 'inbox')) continue
          if (++scanned > SEARCH_FILES) break
          batch.push(file)
          if (batch.length < CONCURRENCY) continue
          await flush()
          if (hits.length >= MAX_HITS) break
        }
        if (hits.length < MAX_HITS && batch.length > 0) await flush()
        return { text: hits.length === 0 ? `No memory matched "${args.query}".` : hits.join('\n') }
      }

      if (op === 'read') {
        if (!args.path) throw new Error('memory: read needs a path')
        const target = inside(root, String(args.path))
        const st = await stat(target).catch((error) => {
          if (error?.code === 'ENOENT') throw new Error(`memory: no such file: ${args.path}`)
          throw error
        })
        if (!st.isFile()) throw new Error(`memory: not a file: ${args.path}`)
        const text = await readBody(target, st, DOC_CAP)
        return { text: st.size > DOC_CAP ? `${text}\n[truncated]` : text }
      }

      if (op === 'write') {
        if (!args.path) throw new Error('memory: write needs a path')
        const allowed = writablePath(String(args.path), { soulFile: config.soulFile, memoryFile: config.memoryFile })
        const target = inside(root, allowed.path)
        const content = String(args.content ?? '')
        if (content.trim() === '') throw new Error('memory: write needs content')
        const append = args.append !== false
        const exists = await stat(target).then(() => true, () => false)
        let text = content
        let replace = !append
        if (allowed.isTopic) {
          const incoming = parseFrontmatter(content)
          if (exists && append) {
            // 追加时始终保留并合并 frontmatter，只往正文里添行
            const prior = parseFrontmatter(await readText(target, DOC_CAP))
            text = stringifyFrontmatter(
              { ...prior.data, ...incoming.data, updated: today() },
              mergeBody(prior.body, incoming.body)
            )
            replace = true
          } else if (exists) {
            const prior = parseFrontmatter(await readText(target, DOC_CAP))
            text = stringifyFrontmatter({ ...prior.data, ...incoming.data, updated: today() }, incoming.body)
          } else {
            const name = allowed.path.slice(allowed.path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
            const declared = String(incoming.data.type ?? '').toLowerCase()
            const type = ['person', 'project', 'decision', 'preference', 'lesson', 'note'].includes(declared) ? declared : allowed.type
            text = stringifyFrontmatter(
              { ...topicFrontmatter(name, type, incoming.body), ...incoming.data, name: incoming.data.name || name, type },
              incoming.body
            )
          }
        }
        await writeMemory(target, text, replace ? false : append)
        return { text: `${append ? 'Appended to' : 'Replaced'} ${allowed.path} (${text.length} chars).` }
      }

      if (op === 'list') {
        const prefix = args.path ? String(args.path).replace(/^\.\//, '') : ''
        const lines = []
        const core = [
          { path: config.soulFile, label: 'soul' },
          { path: config.memoryFile, label: 'index' }
        ]
        for (const item of core) {
          if (prefix !== '' && !item.path.startsWith(prefix)) continue
          const st = await stat(inside(root, item.path)).catch(() => undefined)
          lines.push(`${item.path} — ${item.label} — ${st?.size ?? 0} B`)
        }
        for await (const file of walkDocs(root)) {
          const rel = relative(root, file)
          if (isUnder(rel, 'inbox')) continue
          if (!isUnder(rel, TOPIC_DIR)) continue
          if (prefix !== '' && !rel.startsWith(prefix)) continue
          const st = await stat(file).catch(() => undefined)
          const { data } = parseFrontmatter(await readText(file, DOC_CAP))
          const group = TYPE_GROUP[String(data.type ?? '').toLowerCase()] ?? 'other'
          lines.push(`${rel} — ${data.name || rel.slice(rel.lastIndexOf('/') + 1)} — ${group} — ${st?.size ?? 0} B${data.description ? ` — ${data.description}` : ''}`)
          if (lines.length >= MAX_TOOL_LIST) break
        }
        return { text: lines.length === 0 ? 'No memory files matched.' : lines.join('\n') }
      }

      if (op === 'delete') {
        if (!args.path) throw new Error('memory: delete needs a path')
        const rel = String(args.path).replace(/^\.\//, '')
        if (!isUnder(rel, TOPIC_DIR)) throw new Error(`memory: only ${TOPIC_DIR}/ files can be deleted`)
        const moved = await moveToTrash(root, rel)
        invalidateText(inside(root, rel))
        return { text: `Moved ${rel} to trash (${moved.id}). Restore it from Settings → Local Memory → Trash.` }
      }

      throw new Error(`memory: unknown op ${JSON.stringify(op)}`)
    }
  })

  // 4) /memory：查看目录、文件与整理状态
  ctx.commands.register({
    name: 'memory',
    description: 'Show the local memory folder, its files, and the last distillation/compaction run',
    async handler() {
      try {
        return { kind: 'success', text: await admin.describe() }
      } catch (error) {
        return { kind: 'error', text: `memory: ${String(error?.message ?? error)}` }
      }
    }
  })

  return { admin, config }
}
