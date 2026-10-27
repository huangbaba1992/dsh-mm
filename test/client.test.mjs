/**
 * dsh-mm — Client 端到端测试（真实 Host + 最小 React 垫片）。
 * 运行：node test/client.test.mjs
 */
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'

import { apply } from '../index.js'

const SRC = await fs.readFile(new URL('../client.js', import.meta.url), 'utf8')

/* ---------------- React 垫片 ---------------- */

let current = null
let dirty = false
const instances = new Map()

function sameDeps(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false
  return true
}
function slotAt(index) {
  if (!(index in current.hooks)) current.hooks[index] = {}
  return current.hooks[index]
}
const React = {
  createElement(type, config, ...children) {
    const props = {}
    if (config) for (const key of Object.keys(config)) if (config[key] !== undefined && key !== 'key') props[key] = config[key]
    const flat = []
    const push = (value) => {
      if (value === null || value === undefined || typeof value === 'boolean') return
      if (Array.isArray(value)) return value.forEach(push)
      flat.push(value)
    }
    children.forEach(push)
    if (flat.length > 0) props.children = flat.length === 1 ? flat[0] : flat
    return { type, props }
  },
  useState(initial) {
    const slot = slotAt(current.index++)
    if (!('value' in slot)) slot.value = typeof initial === 'function' ? initial() : initial
    const set = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next
      if (Object.is(value, slot.value)) return
      slot.value = value
      dirty = true
    }
    return [slot.value, set]
  },
  useRef(initial) {
    const slot = slotAt(current.index++)
    if (!('current' in slot)) slot.current = initial
    return slot
  },
  useMemo(factory, deps) {
    const slot = slotAt(current.index++)
    if (!('deps' in slot) || !sameDeps(slot.deps, deps)) {
      slot.deps = deps
      slot.value = factory()
    }
    return slot.value
  },
  useCallback(fn, deps) {
    const slot = slotAt(current.index++)
    if (!('deps' in slot) || !sameDeps(slot.deps, deps)) {
      slot.deps = deps
      slot.fn = fn
    }
    return slot.fn
  },
  useEffect(fn, deps) {
    const slot = slotAt(current.index++)
    current.pending.push({ slot, fn, deps })
  }
}

function expand(node, path) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}.${index}`))
  if (typeof node.type === 'function') return renderComponent(`${path}>${node.type.name || 'component'}`, node.type, node.props)
  if (!node.props) return node
  return { type: node.type, props: { ...node.props, children: expand(node.props.children, path) } }
}

function renderComponent(id, fn, props) {
  let instance = instances.get(id)
  if (!instance) {
    instance = { hooks: [], index: 0, pending: [] }
    instances.set(id, instance)
  }
  const previous = current
  current = instance
  instance.index = 0
  instance.pending = []
  const output = fn(props)
  current = previous
  const expanded = expand(output, id)
  for (const entry of instance.pending) {
    if (Array.isArray(entry.slot.deps) && sameDeps(entry.slot.deps, entry.deps)) continue
    if (typeof entry.slot.cleanup === 'function') entry.slot.cleanup()
    entry.slot.deps = entry.deps
    const cleanup = entry.fn()
    entry.slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
  }
  return expanded
}

/* ---------------- 浏览器桩 ---------------- */

const intervals = new Set()
const windowListeners = []
const windowStub = {
  __ModuleLoader__: { load: (definition) => (globalThis.__clientDefinition = definition) },
  setInterval: (fn, ms) => {
    const handle = setInterval(fn, ms)
    if (handle && typeof handle.unref === 'function') handle.unref()
    intervals.add(handle)
    return handle
  },
  clearInterval: (handle) => {
    intervals.delete(handle)
    return clearInterval(handle)
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  addEventListener: (type, fn) => windowListeners.push({ type, fn }),
  removeEventListener: (type, fn) => {
    const at = windowListeners.findIndex((entry) => entry.type === type && entry.fn === fn)
    if (at !== -1) windowListeners.splice(at, 1)
  },
  confirm: () => true
}
const documentStub = { visibilityState: 'visible' }

/* ---------------- Host ---------------- */

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mm-client-home-'))
process.env.DSH_HOME = home
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mm-client-dir-'))
await fs.mkdir(path.join(dir, 'topics'), { recursive: true })
await fs.writeFile(path.join(dir, 'soul.md'), 'You are terse.\n', 'utf8')
await fs.writeFile(path.join(dir, 'MEMORY.md'), '# Long-term memory\n\n- prefers local tools\n', 'utf8')
await fs.writeFile(
  path.join(dir, 'topics', 'food.md'),
  '---\nname: Food\ndescription: no cilantro\ntype: preference\nupdated: 2026-10-20\n---\n\n- no cilantro\n',
  'utf8'
)
await fs.mkdir(path.join(dir, 'inbox'), { recursive: true })

const routes = new Map()
const hostCtx = {
  effect(fn) {
    const dispose = fn()
    return dispose
  },
  on() {
    return () => {}
  },
  get(service) {
    if (service === 'llm') return { async prepareCall() { return { config: {}, async *stream() { yield { type: 'text-delta', text: '' }; yield { type: 'finish', reason: { kind: 'stop' } } } } } }
    if (service === 'sessionController') return { async modelCatalog() { return { default: { provider: 'test', model: 'm' }, groups: [{ id: 'test', name: 'Test', models: [{ id: 'm', name: 'M' }] }], failures: [] } } }
    if (service === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'm' }) }
  },
  inject(_deps, fn) {
    fn(hostCtx)
  },
  systemPrompt: { getSectionOrder: () => 0, section() { return () => {} } },
  tools: { register() {} },
  commands: { register() {} },
  webServer: {
    register(spec) {
      routes.set(spec.path, spec.handler)
      return () => routes.delete(spec.path)
    }
  }
}
const api = apply(hostCtx, { dir, soulFile: 'soul.md', memoryFile: 'MEMORY.md', maxMemoryBytes: 4096 })
await api.admin.ready

const hostServer = http.createServer(async (request, response) => {
  const pathname = new URL(String(request.url ?? '/'), 'http://x').pathname
  const route = routes.get(pathname)
  if (route === undefined) {
    response.writeHead(404)
    response.end()
    return
  }
  await route(request, response)
})
await new Promise((resolve) => hostServer.listen(0, '127.0.0.1', resolve))
const hostPort = hostServer.address().port
const requests = []
async function realFetch(input, init) {
  const url = String(input)
  requests.push({ url, method: init?.method ?? 'GET' })
  return fetch(url.startsWith('http') ? url : `http://127.0.0.1:${hostPort}/${url}`, init)
}

/* ---------------- 加载 client ---------------- */

const sandbox = {
  window: windowStub,
  document: documentStub,
  fetch: realFetch,
  require: (name) => {
    if (name === 'react') return React
    throw new Error(`unexpected import: ${name}`)
  },
  URL,
  URLSearchParams,
  TextEncoder,
  console,
  setTimeout,
  clearTimeout,
  setInterval: windowStub.setInterval,
  clearInterval: windowStub.clearInterval,
  Date,
  Math,
  JSON,
  Number,
  String,
  Object,
  Array,
  Set,
  Map,
  Error,
  Boolean,
  Promise,
  RegExp
}
sandbox.globalThis = sandbox
const context = vm.createContext(sandbox)
vm.runInContext(SRC, context, { filename: 'client.js' })
const definition = globalThis.__clientDefinition
assert.equal(definition.id, 'dsh-mm')

const dicts = {}
let registered
const picker = async () => dir
const clientCtx = {
  effect(fn) {
    return fn()
  },
  locale: {
    register(ns, dict) {
      dicts[ns] = dict
      return () => {}
    },
    bind(ns) {
      return (key, vars) => {
        let text = dicts[ns]?.zh?.[key] ?? key
        if (vars) for (const name of Object.keys(vars)) text = text.replaceAll(`{${name}}`, String(vars[name]))
        return text
      }
    }
  },
  slots: {
    inject(_slot, fn) {
      return fn()
    },
    register(config, component) {
      registered = { config, component }
      return () => {}
    }
  },
  uiWorkspace: { pickDirectory: picker }
}
const client = definition.factory(sandbox.require)
client.apply(clientCtx)
assert.ok(registered)
const Component = registered.component
const props = registered.config.inject()

/* ---------------- 渲染与查询 ---------------- */

function render() {
  return renderComponent('root', Component, props)
}
function settleSync() {
  dirty = false
  return render()
}
async function settle() {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    const out = settleSync()
    if (!dirty) {
      // 再等一轮，给 effect 里的异步 fetch 返回后的 setState 留时间
      await new Promise((resolve) => setTimeout(resolve, 15))
      const again = settleSync()
      if (!dirty) return again
    }
  }
  throw new Error('component did not settle')
}
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (node.type === 'style' || node.type === 'script') return ''
  return textOf(node.props?.children)
}
function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit))
  if (typeof node !== 'object') return
  visit(node)
  walk(node.props?.children, visit)
}
function byText(label, type) {
  let found = null
  walk(render(), (node) => {
    if (found || (type && node.type !== type)) return
    if (textOf(node).includes(label)) found = node
  })
  return found
}
function button(label) {
  let found = null
  walk(render(), (node) => {
    if (found || node.type !== 'button') return
    if (textOf(node).includes(label)) found = node
  })
  return found
}
function inputByLabel(label) {
  let found = null
  walk(render(), (node) => {
    if (found) return
    if (node.type !== 'input' && node.type !== 'textarea') return
    if (node.props?.['aria-label'] === label || node.props?.placeholder === label) found = node
  })
  return found
}
function tab(label) {
  let found = null
  walk(render(), (node) => {
    if (found || node.type !== 'button' || node.props?.role !== 'tab') return
    if (textOf(node).includes(label)) found = node
  })
  return found
}
async function click(node) {
  assert.ok(node, 'element should exist')
  await node.props.onClick({ preventDefault() {}, target: {} })
  return settle()
}
async function change(node, value) {
  assert.ok(node, 'input should exist')
  await node.props.onChange({ target: { value, checked: value } })
  return settle()
}

/* ---------------- 断言场景 ---------------- */

let output = await settle()
assert.match(textOf(output), /本地记忆/)
assert.match(textOf(output), /主题文件/)
assert.match(textOf(output), /主题文件 1/)
ok('renders overview with root path, stats and topic counts')

async function ok(name) {
  console.log(`ok   ${name}`)
}

// 核心文件编辑并保存
await click(tab('核心文件'))
output = await settle()
const soulArea = inputByLabel('身份与风格，例如：你是老黄的技术搭档，先给结论，少废话。')
assert.ok(soulArea, 'soul textarea should exist')
await change(soulArea, '你是肥鱼，先给结论。')
await click(button('保存'))
await settle()
assert.match(await fs.readFile(path.join(dir, 'soul.md'), 'utf8'), /你是肥鱼/)
ok('edits and saves soul.md from the core tab')

// 主题搜索 + 编辑 + 删除 + 回收站恢复
await click(tab('主题'))
output = await settle()
const search = inputByLabel('搜索名称、描述或路径')
await change(search, 'Food')
assert.match(textOf(await settle()), /Food/)
await click(button('Food'))
output = await settle()
assert.match(textOf(output), /编辑主题/)
const topicArea = output.props.children
let editorTextarea = null
walk(output, (node) => {
  if (!editorTextarea && node.type === 'textarea' && node.props?.value?.includes('no cilantro')) editorTextarea = node
})
assert.ok(editorTextarea, 'topic editor textarea')
await change(editorTextarea, editorTextarea.props.value.replace('no cilantro', 'no cilantro, no scallion'))
await click(button('保存'))
await settle()
assert.match(await fs.readFile(path.join(dir, 'topics', 'food.md'), 'utf8'), /no scallion/)

await click(button('移入回收站'))
output = await settle()
assert.match(textOf(output), /确认把 Food 移入回收站/)
await click(button('确认移入回收站'))
await settle()
await assert.rejects(fs.stat(path.join(dir, 'topics', 'food.md')))
await click(tab('回收站'))
output = await settle()
assert.match(textOf(output), /topics\/food\.md/)
await click(button('恢复'))
await settle()
assert.match(await fs.readFile(path.join(dir, 'topics', 'food.md'), 'utf8'), /no scallion/)
ok('searches, edits, trashes and restores a topic')

// 新建主题
await click(tab('主题'))
await click(button('新建主题'))
await settle()
const nameInput = inputByLabel('例如：王工 / 项目 Alpha')
await change(nameInput, '项目 Alpha')
const description = inputByLabel('可选，用于索引和搜索')
await change(description, '本地记忆优化')
const body = inputByLabel('- 负责后端上线\n- 偏好 async/await')
await change(body, '- 一条事实')
await click(button('创建'))
await settle()
assert.match(await fs.readFile(path.join(dir, 'topics', '项目-Alpha.md'), 'utf8'), /type: note/)
ok('creates a topic from the topics tab')

// 自动化设置
await click(tab('自动化'))
output = await settle()
assert.match(textOf(output), /对话记录/)
assert.match(textOf(output), /启用自动提炼/)
const minPending = inputByLabel('积压阈值（KB）')
await change(minPending, '32')
const minPendingAfter = inputByLabel('积压阈值（KB）')
await minPendingAfter.props.onBlur({})
await settle()
await new Promise((resolve) => setTimeout(resolve, 100))
const stateAfter = await (await fetch(`http://127.0.0.1:${hostPort}/api/local-memory/state`)).json()
assert.equal(stateAfter.settings.distill.minPendingKB, 32)
ok('updates automation settings through the UI')

// 概览刷新与备份
await click(tab('概览'))
await click(button('立即备份'))
await settle()
const backups = await fs.readdir(path.join(dir, 'backups')).catch(() => [])
assert.ok(backups.length >= 1)
ok('creates a backup from the overview')

// 备份管理页：列表、保留份数、删除
await click(tab('备份'))
output = await settle()
assert.match(textOf(output), /保留份数/)
assert.match(textOf(output), /删除备份/)
await click(button('删除备份'))
output = await settle()
assert.match(textOf(output), /永久删除备份/)
await click(button('确认删除'))
output = await settle()
assert.match(textOf(output), /还没有备份/)
const stateAfterDelete = await (await fetch(`http://127.0.0.1:${hostPort}/api/local-memory/state`)).json()
assert.equal(stateAfterDelete.backups.length, 0)
ok('manages backups from a dedicated backup tab')

for (const handle of intervals) clearInterval(handle)
hostServer.close()
await fs.rm(home, { recursive: true, force: true })
await fs.rm(dir, { recursive: true, force: true })
console.log('\n7 client test groups passed')
process.exit(0)
