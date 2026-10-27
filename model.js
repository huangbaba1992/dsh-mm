// dsh-local-memory — 模型调用：路由解析、目录校验、重试与降级（Host 半内部模块）
import { randomUUID } from 'node:crypto'

export const MAX_OUTPUT_TOKENS = 4096
export const COMPACT_TIMEOUT_MS = 120 * 1000

/** 提炼：原文 → 索引 + 主题文件。 */
export const DISTILL_SYSTEM =
  'You extract durable memories from raw conversation logs. Return exactly two Markdown sections:\n\n' +
  '## INDEX\n' +
  '- one line per durable fact: `- [title](topics/slug.md) — one-line description (updated YYYY-MM-DD)` for topic-backed facts, or `- plain fact` otherwise. At most 200 characters per line, absolute dates.\n\n' +
  '## FILES\n' +
  '=== topics/li.md\n' +
  '---\n' +
  'name: 李工\n' +
  'description: 后端负责人\n' +
  'type: person\n' +
  'updated: 2026-10-27\n' +
  '---\n' +
  '- facts belonging to that topic, one per line\n\n' +
  'All topic files live under topics/ (one directory level, .md). type must be one of person, project, decision, preference, lesson, note. ' +
  'One file per person, project, decision, preference, lesson or note. ' +
  'Use the existing index and topic list to avoid repeating facts that are already stored; only add new or corrected facts. ' +
  'Never use soul.md, MEMORY.md, inbox/, backups/, .trash/, absolute paths or ... Omit FILES when nothing belongs to a topic. No code fences, no commentary.'

/** 压缩：单个文件 → 更短的同义文件。 */
export const COMPACT_SYSTEM =
  'You compress one Markdown memory file. Keep every distinct fact, name, date, preference and decision. ' +
  'Merge duplicated or repeated statements into one. Remove greetings, filler and chit-chat. ' +
  'Keep the original language and Markdown structure. Output only the new file content, no code fences, no commentary.'

const RETRY_DELAYS = [800, 2500]

const errorText = (error) => String(error?.message ?? error)

const isTransient = (error) =>
  /(429|rate.?limit|too many requests|timeout|timed out|ECONNRESET|ECONNREFUSED|socket|fetch failed|network|temporar)/i.test(errorText(error))
const isContext = (error) => /(context.?(length|window)|maximum context|too long|exceed\w*.*token|token\w*.*exceed|input\w*.*too large)/i.test(errorText(error))
const isSystemUnsupported = (error) => /(system\w*.*(not supported|unsupported|invalid)|does not support system)/i.test(errorText(error))

/**
 * 创建模型调用器。
 * @param {{get: (name: string) => any}} ctx Host 上下文
 */
export function createModel(ctx) {
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

  /** 已选模型优先，否则跟随当前默认模型。 */
  const resolveRoute = async (compact) => {
    if (compact.provider !== '' && compact.model !== '') return { provider: compact.provider, model: compact.model }
    return fallbackRoute()
  }

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

  const askModel = async (route, system, fileText, signal) => {
    const llm = ctx.get('llm')
    if (!llm?.prepareCall) throw new Error('llm service is unavailable')
    const call = await llm.prepareCall({ provider: route.provider, model: route.model, maxTokens: MAX_OUTPUT_TOKENS }, signal)
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
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error?.message ?? errorText(chunk.error))
      }
    }
    return text
  }

  /** 限流/网络抖动的小步重试。 */
  const askWithRetry = async (route, system, text, signal) => {
    let last
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
      if (signal?.aborted) throw new Error('aborted')
      try {
        return await askModel(route, system, text, signal)
      } catch (error) {
        last = error
        if (!isTransient(error) || attempt >= RETRY_DELAYS.length) throw error
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]))
      }
    }
    throw last
  }

  /** 在换行处切成两半（尽量不切断句子）。 */
  const splitAt = (text) => {
    const mid = Math.floor(text.length / 2)
    const found = text.lastIndexOf('\n', mid)
    return found > text.length * 0.25 ? found : mid
  }

  /** 限流重试 → 上下文超限对半拆 → system 不被支持则并进用户消息。 */
  const askModelSafe = async (route, system, text, signal) => {
    try {
      return await askWithRetry(route, system, text, signal)
    } catch (error) {
      if (isSystemUnsupported(error)) return askWithRetry(route, '', `${system}\n\n${text}`, signal)
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

  return { catalog, resolveRoute, validateRoute, askModelSafe, explain }
}
