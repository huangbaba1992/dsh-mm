/**
 * dsh-local-memory — Host 端到端测试。
 * 不依赖运行中的 Harness：用桩 ctx 收集真实路由，再用本机 HTTP 服务分发请求；
 * 模型调用用桩 llm 按 system prompt 返回预置文本。
 * 运行：node test/host.test.mjs
 */
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

import { apply } from '../index.js'
import { sanitizeSettings, parseFrontmatter, parseDistill, safeTopicPath, writablePath } from '../core.js'
import { mergeIndex } from '../jobs.js'

/* ---------------- 工具 ---------------- */

let passed = 0
function ok(name) {
  passed += 1
  console.log(`ok   ${name}`)
}

async function waitFor(check, timeout = 8000, label = 'condition') {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error(`timeout waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

const tmp = (name) => fs.mkdtemp(path.join(os.tmpdir(), `dsh-local-memory-${name}-`))

/* ---------------- 桩 ctx ---------------- */

function makeCtx({ answer = () => '', catalog = true } = {}) {
  const routes = new Map()
  const tools = new Map()
  const commands = new Map()
  const handlers = new Map()
  const sections = []
  const effects = []
  const calls = []

  const ctx = {
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
      return dispose
    },
    on(type, handler) {
      const list = handlers.get(type) ?? []
      list.push(handler)
      handlers.set(type, list)
      return () => {}
    },
    get(service) {
      if (service === 'llm') {
        return {
          async prepareCall() {
            return {
              config: {},
              async *stream(payload) {
                calls.push({ system: payload.system ?? '', text: payload.messages?.[0]?.content?.[0]?.text ?? '' })
                const text = answer(payload.system ?? '', payload.messages?.[0]?.content?.[0]?.text ?? '')
                yield { type: 'text-delta', text }
                yield { type: 'finish', reason: { kind: 'stop' } }
              }
            }
          }
        }
      }
      if (service === 'sessionController') {
        return catalog
          ? {
              async modelCatalog() {
                return {
                  default: { provider: 'test', model: 'm' },
                  groups: [{ id: 'test', name: 'Test', models: [{ id: 'm', name: 'M' }] }],
                  failures: []
                }
              }
            }
          : undefined
      }
      if (service === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'test', model: 'm' }) }
      }
      if (service === 'agents') return { list: () => [] }
      return undefined
    },
    inject(_deps, fn) {
      fn(ctx)
    },
    systemPrompt: {
      getSectionOrder: () => 0,
      section(spec) {
        sections.push(spec)
        return () => {}
      }
    },
    tools: { register(definition) { tools.set(definition.name, definition) } },
    commands: { register(definition) { commands.set(definition.name, definition) } },
    webServer: {
      register(spec) {
        routes.set(spec.path, spec.handler)
        return () => routes.delete(spec.path)
      }
    }
  }

  const emit = (type, ...args) => {
    for (const handler of handlers.get(type) ?? []) handler(...args)
  }
  return { ctx, routes, tools, commands, sections, effects, calls, emit }
}

async function listen(handler) {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(String(request.url ?? '/'), 'http://x').pathname
    const route = handler.get(pathname)
    if (route === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('no route')
      return
    }
    try {
      await route(request, response)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end(String(error?.stack ?? error))
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port }
}

async function callApi(port, route, { method = 'GET', body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/local-memory${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, data })
  return data
}

/* ---------------- 纯函数 ---------------- */

{
  const settings = sanitizeSettings({
    compact: { enabled: true, everyHours: 0, maxFilesPerRun: 999, lastDistill: { at: 123, facts: 2 } },
    capture: { idleMinutes: 45 },
    distill: { minPendingKB: -3 }
  })
  assert.equal(settings.compact.everyHours, 1)
  assert.equal(settings.compact.maxFilesPerRun, 50)
  assert.equal(settings.distill.idleMinutes, 45)
  assert.equal(settings.distill.minPendingKB, 1)
  assert.equal(settings.distill.lastResult.facts, 2)
  ok('sanitizeSettings clamps and migrates 0.2 fields')

  const parsed = parseDistill('## INDEX\n- a\n## FILES\n=== topics/x.md\n---\nname: X\ntype: note\n---\n- b')
  assert.deepEqual(parsed.files, [{ path: 'topics/x.md', content: '---\nname: X\ntype: note\n---\n- b' }])
  assert.equal(parsed.index, '- a')
  ok('parseDistill splits INDEX and FILES')

  const merged = mergeIndex('# 长期记忆\n\n- 已有一条\n', '- 已有一条\n- 新事实', new Date('2026-10-27T10:00:00'))
  assert.equal(merged.added, 1)
  assert.match(merged.text, /新事实/)
  assert.equal((merged.text.match(/已有一条/g) ?? []).length, 1)
  ok('mergeIndex dedupes existing facts')

  const reserved = new Set(['soul.md', 'memory.md', 'inbox'])
  assert.deepEqual(safeTopicPath('people/wang.md', reserved), { path: 'topics/wang.md', type: 'person' })
  assert.deepEqual(safeTopicPath('王工.md', reserved), { path: 'topics/王工.md', type: 'note' })
  assert.equal(safeTopicPath('../x.md', reserved), undefined)
  assert.equal(safeTopicPath('inbox/x.md', reserved), undefined)
  assert.throws(() => writablePath('inbox/x.md', { soulFile: 'soul.md', memoryFile: 'MEMORY.md' }), /only topics/)
  ok('path whitelists reject escapes and protected dirs')
}

/* ---------------- 主流程 ---------------- */

const home = await tmp('home')
process.env.DSH_HOME = home
const dir = await tmp('memory')
await fs.mkdir(path.join(dir, 'topics'), { recursive: true })
await fs.writeFile(path.join(dir, 'soul.md'), '你是老黄的技术搭档。\n', 'utf8')
await fs.writeFile(path.join(dir, 'MEMORY.md'), '# 长期记忆\n\n- 偏好纯本地工具\n', 'utf8')
await fs.writeFile(
  path.join(dir, 'topics', 'food.md'),
  '---\nname: 饮食\ndescription: 不吃香菜\ntype: preference\nupdated: 2026-10-20\n---\n\n- 不吃香菜\n',
  'utf8'
)

const distillAnswer =
  '## INDEX\n- [王工](topics/wang.md) — 后端负责人（更新 2026-10-27）\n## FILES\n=== topics/wang.md\n---\nname: 王工\ndescription: 后端负责人\ntype: person\nupdated: 2026-10-27\n---\n- 负责后端上线\n- 偏好 async/await'
let distillMode = true

const { ctx, routes, tools, sections, calls, emit } = makeCtx({
  answer(system) {
    if (system.includes('compress one Markdown memory file')) return '- 负责后端上线\n- 偏好 async/await\n'
    if (system.includes('durable memories')) return distillMode ? distillAnswer : '## INDEX\n- 纯本地工具\n'
    return ''
  }
})

const api = apply(ctx, { dir, soulFile: 'soul.md', memoryFile: 'MEMORY.md', maxMemoryBytes: 4096 })
const admin = api.admin
await admin.ready
const { server, port } = await listen(routes)

// 初始状态
{
  const state = await callApi(port, '/state')
  assert.equal(state.root, dir)
  assert.equal(state.topics.people, 0)
  assert.equal(state.topics.preferences, 1)
  assert.equal(state.memory.cap, 4096)
  assert.equal(state.soul.bytes > 0, true)
  assert.equal(state.warnings.some((warning) => warning.code === 'no-model'), false)
  ok('state reports paths, budget, topics and model catalog')
}

// 会话捕获 → inbox
{
  emit('session/event', { id: 's1' }, { type: 'user/message', data: { content: [{ type: 'text', text: '我在做本地记忆插件' }] } })
  emit('session/event', { id: 's1' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '收到，先给结论。' }] } } })
  emit('agent/turn-stopping', { agent: { session: { id: 's1' } }, turn: 3 })
  await waitFor(async () => {
    const entries = await fs.readdir(path.join(dir, 'inbox'))
    return entries.some((name) => name.endsWith('.md'))
  })
  const files = await fs.readdir(path.join(dir, 'inbox'))
  const text = await fs.readFile(path.join(dir, 'inbox', files[0]), 'utf8')
  assert.match(text, /\*\*你\*\*：我在做本地记忆插件/)
  assert.match(text, /\*\*我\*\*：收到/)
  assert.match(text, /turn 3/)
  ok('capture appends user and assistant text to inbox')
}

// memory 工具：write / list / search / delete
{
  const write = await tools.get('memory').execute({ op: 'write', path: 'people/wang.md', content: '- 负责后端上线' }, {})
  assert.match(write.text, /topics\/wang\.md/)
  const file = await fs.readFile(path.join(dir, 'topics', 'wang.md'), 'utf8')
  const parsed = parseFrontmatter(file)
  assert.equal(parsed.data.type, 'person')
  assert.equal(parsed.data.name, 'wang')
  assert.match(parsed.body, /负责后端上线/)

  const list = await tools.get('memory').execute({ op: 'list' }, {})
  assert.match(list.text, /topics\/wang\.md/)
  assert.match(list.text, /people/)

  const search = await tools.get('memory').execute({ op: 'search', query: '香菜' }, {})
  assert.match(search.text, /topics\/food\.md/)

  const removed = await tools.get('memory').execute({ op: 'delete', path: 'topics/wang.md' }, {})
  assert.match(removed.text, /trash/)
  await assert.rejects(fs.stat(path.join(dir, 'topics', 'wang.md')))
  ok('memory tool writes, lists, searches and trashes topic files')
}

// 追加写：保留 frontmatter，正文按行合并
{
  await tools.get('memory').execute({ op: 'write', path: 'topics/food.md', content: '- 喜欢喝乌龙茶' }, {})
  const text = await fs.readFile(path.join(dir, 'topics', 'food.md'), 'utf8')
  const parts = parseFrontmatter(text)
  assert.equal(parts.data.type, 'preference')
  assert.equal((text.match(/^---$/gm) ?? []).length, 2)
  assert.match(parts.body, /不吃香菜/)
  assert.match(parts.body, /乌龙茶/)
  ok('memory tool append keeps one frontmatter block and merges facts')
}

// 路径穿越不能删除 MEMORY.md
{
  const indexBefore = await fs.readFile(path.join(dir, 'MEMORY.md'), 'utf8')
  await assert.rejects(
    tools.get('memory').execute({ op: 'delete', path: 'topics/../MEMORY.md' }, {}),
    /invalid|only topics/i
  )
  assert.equal(await fs.readFile(path.join(dir, 'MEMORY.md'), 'utf8'), indexBefore)
  ok('path traversal cannot move MEMORY.md to trash')
}

// 新建 / 编辑 / 保存设置
{
  const created = await callApi(port, '/topic', { method: 'POST', body: { name: '项目 Alpha', type: 'project', description: '本地记忆优化' } })
  assert.equal(created.path, 'topics/项目-Alpha.md')
  const text = await fs.readFile(path.join(dir, created.path), 'utf8')
  assert.match(text, /type: project/)

  const file = await callApi(port, `/file?path=${encodeURIComponent(created.path)}`)
  assert.match(file.text, /本地记忆优化/)
  await callApi(port, '/file', { method: 'POST', body: { path: created.path, content: `${file.text.trim()}\n\n- 新增一条事实\n` } })
  const updated = await fs.readFile(path.join(dir, created.path), 'utf8')
  assert.match(updated, /新增一条事实/)

  await assert.rejects(callApi(port, '/file', { method: 'POST', body: { path: 'inbox/evil.md', content: 'x' } }), /only topics|invalid/i)
  ok('topic/file endpoints create, read and update; inbox is not writable')
}

// 提炼：归档、索引去重、主题合并
{
  await fs.writeFile(
    path.join(dir, 'inbox', '2026-10-27.md'),
    '\n## 10:00 · turn 1\n\n**你**：王工负责后端上线，偏好 async/await。\n',
    'utf8'
  )
  const before = await callApi(port, '/state')
  await callApi(port, '/distill', { method: 'POST' })
  await waitFor(async () => {
    const state = await callApi(port, '/state')
    return state.running === false && state.lastDistill?.at !== before.lastDistill?.at
  }, 10000, 'distill finish')
  const state = await callApi(port, '/state')
  assert.equal(state.pending.files, 0)
  assert.equal(state.lastDistill.facts, 1)
  const index = await fs.readFile(path.join(dir, 'MEMORY.md'), 'utf8')
  assert.match(index, /王工/)
  assert.match(index, /从对话提炼/)
  const wang = await fs.readFile(path.join(dir, 'topics', 'wang.md'), 'utf8')
  assert.match(wang, /负责后端上线/)
  assert.match(wang, /偏好 async\/await/)
  const archives = await fs.readdir(path.join(dir, 'inbox', 'archive'))
  assert.equal(archives.length, 1)
  ok('distill merges index/topic, archives inbox, and reports facts')

  // 第二次同样的输出：索引与主题不重复
  await fs.writeFile(path.join(dir, 'inbox', '2026-10-27.md'), '\n## 11:00 · turn 2\n\n再记一次。\n', 'utf8')
  const before2 = await callApi(port, '/state')
  await callApi(port, '/distill', { method: 'POST' })
  await waitFor(async () => {
    const next = await callApi(port, '/state')
    return next.running === false && next.lastDistill?.at !== before2.lastDistill?.at
  })
  const index2 = await fs.readFile(path.join(dir, 'MEMORY.md'), 'utf8')
  assert.equal((index2.match(/王工/g) ?? []).length, 1)
  const wang2 = await fs.readFile(path.join(dir, 'topics', 'wang.md'), 'utf8')
  assert.equal((wang2.match(/负责后端上线/g) ?? []).length, 1)
  ok('second distill does not duplicate index lines or topic facts')
}

// 大 inbox：超过 48KB 也会处理，并回写剩余
{
  const big = `\n## 12:00 · turn 9\n\n${'这一行是用于测试大文件的记忆内容。\n'.repeat(3000)}`
  await fs.writeFile(path.join(dir, 'inbox', '2026-10-28.md'), big.slice(0, 60 * 1024), 'utf8')
  const before = await callApi(port, '/state')
  await callApi(port, '/distill', { method: 'POST' })
  await waitFor(async () => {
    const next = await callApi(port, '/state')
    return next.running === false && next.lastDistill?.at !== before.lastDistill?.at
  }, 10000, 'big distill')
  const state = await callApi(port, '/state')
  const names = await fs.readdir(path.join(dir, 'inbox'))
  assert.ok(state.pending.files > 0, '剩余原文应留在 inbox')
  assert.ok(names.some((name) => name.includes('-rest-')), '应生成续写文件')
  ok('oversized inbox file is partially distilled and remainder is kept')
}

// 备份 + 回收站恢复
{
  const backup = await callApi(port, '/backup', { method: 'POST', body: { action: 'create' } })
  assert.ok(backup.backup.id)
  assert.ok(backup.backup.files >= 2)
  const state = await callApi(port, '/state')
  assert.ok(state.backups.some((item) => item.id === backup.backup.id))

  const created = await callApi(port, '/topic', { method: 'POST', body: { name: '临时', type: 'note', body: '- 待删除' } })
  const deleted = await callApi(port, '/delete', { method: 'POST', body: { path: created.path } })
  assert.ok(deleted.id)
  const afterDelete = await callApi(port, '/state')
  assert.ok(afterDelete.trash.length >= 1)
  const restored = await callApi(port, '/trash', { method: 'POST', body: { action: 'restore', id: deleted.id, path: created.path } })
  assert.equal(restored.path, created.path)
  assert.match(await fs.readFile(path.join(dir, created.path), 'utf8'), /待删除/)

  const restoredBackup = await callApi(port, '/backup', { method: 'POST', body: { action: 'restore', id: backup.backup.id } })
  assert.ok(restoredBackup.files > 0)
  ok('backup create/restore and trash restore work')
}

// 压缩：去重进回收站 + 备份 + 模型改写
{
  const dup = '---\nname: 重复\ntype: note\n---\n\n- 同一内容\n'
  await fs.writeFile(path.join(dir, 'topics', 'dup-a.md'), dup, 'utf8')
  await fs.writeFile(path.join(dir, 'topics', 'dup-b.md'), dup, 'utf8')
  await fs.writeFile(path.join(dir, 'topics', 'long.md'), `---\nname: 长文\ntype: note\n---\n\n${'- 重复的长句内容\n'.repeat(200)}`, 'utf8')
  await callApi(port, '/settings', {
    method: 'POST',
    body: { compact: { enabled: true, everyHours: 24, minFileBytes: 256, maxInputBytes: 32768, maxFilesPerRun: 5, backupBeforeRun: true } }
  })
  const before = await callApi(port, '/state')
  await callApi(port, '/compact', { method: 'POST' })
  await waitFor(async () => {
    const next = await callApi(port, '/state')
    return next.running === false && next.lastResult?.at !== before.lastResult?.at
  }, 15000, 'compact finish')
  const state = await callApi(port, '/state')
  assert.equal(state.lastResult.error, undefined)
  assert.ok(state.lastResult.removed.length >= 1)
  assert.ok(state.lastResult.rewritten.some((item) => item.path === 'topics/long.md'))
  assert.ok(state.backups.length >= 1)
  assert.ok(state.trash.length >= 1)
  const long = await fs.readFile(path.join(dir, 'topics', 'long.md'), 'utf8')
  assert.ok(long.length < 4000)
  ok('compact trashes duplicates, rewrites large files and creates a backup')
}

// 无模型：提炼跳过且不归档
{
  const before = await callApi(port, '/state')
  await fs.writeFile(path.join(dir, 'inbox', '2026-10-29.md'), '\n## 09:00 · turn 1\n\n待提炼\n', 'utf8')
  await callApi(port, '/settings', { method: 'POST', body: { compact: { provider: 'nope', model: 'nope' } } })
  await callApi(port, '/distill', { method: 'POST' })
  await waitFor(async () => {
    const state = await callApi(port, '/state')
    return state.running === false && state.lastDistill?.at !== before.lastDistill?.at
  })
  const state = await callApi(port, '/state')
  assert.match(state.lastDistill.error ?? '', /not available/)
  assert.ok(state.pending.files >= 1)
  assert.ok((await fs.readdir(path.join(dir, 'inbox'))).includes('2026-10-29.md'))
  ok('distill failure keeps inbox and reports actionable error')
}

server.close()
await fs.rm(home, { recursive: true, force: true })
await fs.rm(dir, { recursive: true, force: true })
console.log(`\n${passed} host test groups passed`)
