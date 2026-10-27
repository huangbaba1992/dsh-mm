// dsh-local-memory — 纯本地 soul + 跨会话记忆（Host 半，无网络）
// Config.dir 里：soul.md（身份，注入靠前）、MEMORY.md（索引，注入靠后），其余 md/txt 为明细。
// 管理面（设置文件、Web 路由、定时合并去重）在 admin.js；前端在 client.js。
import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import {
  cachedReader,
  collectDocs,
  CONCURRENCY,
  DOC_CAP,
  inside,
  invalidateText,
  MAX_HITS,
  readBody,
  readText,
  SEARCH_CAP,
  SEARCH_FILES,
  SOUL_CAP,
  walkDocs,
  TYPE_NAME,
  TOPIC_DIR,
  stringifyFrontmatter
} from './core.js'
import { createAdmin } from './admin.js'

export const name = 'local-memory'
export const inject = ['systemPrompt', 'tools', 'commands']

// 零第三方 import：本地目录链接安装时 dsh 自带包解析不到（ERR_MODULE_NOT_FOUND），
// 因此 Config 手工归一化、工具直接注册原始 ToolDefinition。
const RESERVED_NAMES = new Set(['', '.', '..'])

/** 文件名只允许纯文件名，坏配置回退默认值。 */
function fileName(value, fallback) {
  const name = typeof value === 'string' ? value.trim() : ''
  return RESERVED_NAMES.has(name) || name.includes('/') || name.includes('\\') ? fallback : name
}

/** 归一化行配置：无 schema，全部字段自己做默认值与范围。 */
function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const max = Number(input.maxMemoryBytes)
  return {
    dir: typeof input.dir === 'string' ? input.dir : '',
    soulFile: fileName(input.soulFile, 'soul.md'),
    memoryFile: fileName(input.memoryFile, 'MEMORY.md'),
    maxMemoryBytes: Number.isFinite(max) ? Math.min(Math.max(max, 256), 1 << 20) : 4096
  }
}

/** 追加走 appendFile（不读旧内容），替换走 writeFile；都同步失效读缓存。 */
async function writeMemory(target, content, append) {
  if (!append) {
    await writeFile(target, content, 'utf8')
  } else {
    const size = await stat(target).then((st) => st.size, () => 0)
    await appendFile(target, size > 0 ? '\n\n' + content : content, 'utf8')
  }
  invalidateText(target)
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const admin = createAdmin(ctx, config)
  const readSoul = cachedReader(SOUL_CAP)
  const readMemory = cachedReader(config.maxMemoryBytes)
  const order = (n) => ctx.systemPrompt.getSectionOrder(n)
  const madeDirs = new Set()

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

  // 3) 单个工具：search / read / write
  ctx.tools.register({
      name: 'memory',
      description:
        'Local long-term memory folder (Markdown). op=search finds text, op=read loads one file, op=write stores or updates a fact. Save durable facts, preferences, and decisions as you learn them; do not wait to be asked.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['op'],
        properties: {
          op: { type: 'string', enum: ['search', 'read', 'write'], description: 'Operation to run.' },
          query: { type: 'string', description: 'search: case-insensitive substring.' },
          path: { type: 'string', description: 'read/write: path relative to the memory root, e.g. "people/li.md".' },
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
            for (let k = 0; k < files.length && hits.length < MAX_HITS; k++) {
              const lines = texts[k].split('\n')
              for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
                if (lines[i].toLowerCase().includes(query)) hits.push(`${relative(root, files[k])}:${i + 1}: ${lines[i].slice(0, 200)}`)
              }
            }
          }
          for await (const file of walkDocs(root)) {
            if (exec?.signal?.aborted) break
            // 原始对话日志（inbox/）不参与检索：它们是提炼原料，不是记忆本身。
            if (relative(root, file).startsWith('inbox/')) continue
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
          const st = await stat(target).catch((err) => {
            if (err?.code === 'ENOENT') throw new Error(`memory: no such file: ${args.path}`)
            throw err
          })
          const text = await readBody(target, st, DOC_CAP)
          return { text: st.size > DOC_CAP ? text + '\n[truncated]' : text }
        }
        if (op === 'write') {
          if (!args.path) throw new Error('memory: write needs a path')
          // 主题文件统一落到 topics/：旧路径 people/x.md 会归一化，类型写进 frontmatter
          const asked = String(args.path)
          const matched = /^(?:(people|projects|decisions|preferences|lessons)|(topics))\/([^/]+)\.md$/i.exec(asked)
          const relPath = matched === null ? asked : `${TOPIC_DIR}/${matched[3]}.md`
          const type = matched === null ? undefined : matched[1] === undefined ? 'note' : TYPE_NAME[matched[1].toLowerCase()]
          const target = inside(root, relPath)
          let content = String(args.content ?? '')
          if (type !== undefined && !/^---\n/.test(content)) {
            const exists = await stat(target).then(() => true, () => false)
            if (!exists) {
              const firstLine = content.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? ''
              content = stringifyFrontmatter(
                {
                  name: matched[3].replace(/\.md$/i, ''),
                  description: firstLine.replace(/^[-#*\s]+/, '').slice(0, 80),
                  type,
                  updated: new Date().toISOString().slice(0, 10)
                },
                content
              )
            }
          }
          const folder = dirname(target)
          if (!madeDirs.has(folder)) {
            await mkdir(folder, { recursive: true })
            madeDirs.add(folder)
          }
          await writeMemory(target, content, args.append !== false)
          return {
            text: `${args.append === false ? 'Replaced' : 'Appended to'} ${args.path} (${content.length} chars).`
          }
        }
        throw new Error(`memory: unknown op ${JSON.stringify(op)}`)
      }
  })

  // 4) /memory：查看自定义目录、文件与整理状态
  ctx.commands.register({
    name: 'memory',
    description: 'Show the local memory folder, its files, and the last compaction run',
    async handler() {
      try {
        return await showMemory()
      } catch (error) {
        return { kind: 'error', text: `memory: ${String(error?.message ?? error)}` }
      }
    }
  })

  async function showMemory() {
    const { root, soulPath, memoryPath } = admin.paths()
    const lines = [`Memory root: ${root}`, `soul: ${soulPath} (${readSoul(soulPath).length})`, `index: ${memoryPath} (${readMemory(memoryPath).length})`]
    for (const file of await collectDocs(root)) lines.push(`  ${relative(root, file)}`)
    const last = admin.settings.compact.lastResult
    if (last !== undefined && last !== null) {
      const summary = last.error !== undefined ? `error: ${last.error}` : `${last.rewritten?.length ?? 0} rewritten, ${last.removed?.length ?? 0} removed`
      lines.push('', `Last compaction: ${summary}`)
    }
    return { kind: 'success', text: lines.join('\n') }
  }
}
