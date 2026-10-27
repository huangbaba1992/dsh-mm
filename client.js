// dsh-local-memory — Web 前端：设置页（路径 / 文件编辑 / 自动合并去重）
// 加载格式：window.__ModuleLoader__.load 注册懒工厂；React 由浏览器模块表提供。
window.__ModuleLoader__.load({
  id: 'dsh-local-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'local-memory'
    const API = 'api/local-memory'

    const zh = {
      title: '本地记忆',
      desc: 'soul 与跨会话记忆存在你选择的文件夹里，纯本地、不联网。',
      path: '记忆文件夹',
      choose: '选择文件夹…',
      refresh: '刷新',
      coreTitle: 'soul.md 与 MEMORY.md',
      coreHint: '直接编辑并保存；文件不存在时保存即创建。模型也会通过 memory 工具向 MEMORY.md 追加内容。',
      soulPlaceholder: '身份与风格，例如：你是老黄的技术搭档，先给结论，少废话。',
      memoryPlaceholder: '长期记忆索引，例如：- 偏好纯本地方案\n- 项目 X 的部署方式……',
      save: '保存',
      saved: '已保存',
      captureTitle: '对话记录',
      captureDesc: '每轮结束把你的话和我的回复原文追加到 inbox/日期.md；整理时不会压缩它。',
      captureEnabled: '记录每轮对话到 inbox/',
      distillNow: '立即提炼',
      facts: '条事实',
      topics: '个主题',
      noTopicFiles: '这个分类还没有文件；下次提炼会按分类自动写入。',
      lastDistill: '上次提炼',
      people: '人物',
      projects: '项目',
      decisions: '决策',
      preferences: '偏好',
      lessons: '教训',
      other: '其他',
      pendingLabel: '待提炼',
      nextAuto: '下次自动',
      autoHint: '积压 ≥ 16 KB 且距上次 ≥ 1 小时、会话全部关闭、或空闲 30 分钟都会自动提炼；兜底每 12/24 小时一次。',
      compactTitle: '定时合并去重',
      compactDesc: '按间隔把过大的记忆文件交给所选模型压缩去重，并移除内容完全相同的重复文件。整理结果直接覆盖原文件。',
      compactEnabled: '启用定时整理',
      compactHours: '间隔（小时）',
      compactModel: '整理使用的模型',
      compactDefault: '默认模型（跟随当前设置）',
      runNow: '立即整理',
      running: '整理中…',
      lastRun: '上次整理',
      never: '还没整理过',
      loadFailed: '读取失败',
      saveFailed: '保存失败',
      runFailed: '整理失败',
      rewritten: '重写',
      removed: '去重移除',
      bytes: '字节'
    }

    const en = {
      title: 'Local Memory',
      desc: 'Soul and cross-session memory live in a folder you choose. Purely local.',
      path: 'Memory folder',
      choose: 'Choose folder…',
      refresh: 'Refresh',
      coreTitle: 'soul.md and MEMORY.md',
      coreHint: 'Edit and save; a missing file is created on save. The agent also appends to MEMORY.md through the memory tool.',
      soulPlaceholder: 'Identity and style, e.g. You are a terse systems engineer.',
      memoryPlaceholder: 'Long-term memory index, e.g. - prefers local-only tools',
      save: 'Save',
      saved: 'Saved',
      captureTitle: 'Conversation log',
      captureDesc: 'Each turn appends your message and my reply verbatim to inbox/<date>.md; compaction leaves it alone.',
      captureEnabled: 'Log every turn to inbox/',
      distillNow: 'Distill now',
      facts: 'facts',
      topics: 'topics',
      noTopicFiles: 'No files in this category yet; the next distillation creates them.',
      lastDistill: 'Last distill',
      people: 'People',
      projects: 'Projects',
      decisions: 'Decisions',
      preferences: 'Preferences',
      lessons: 'Lessons',
      other: 'Other',
      pendingLabel: 'Pending',
      nextAuto: 'Next auto run',
      autoHint: 'Auto-distills when pending reaches 16 KB (and 1 hour passed), when every session closes, or after 30 idle minutes; the interval is the fallback.',
      compactTitle: 'Scheduled merge & dedupe',
      compactDesc: 'Periodically compress oversized memory files with the selected model and remove byte-identical duplicates. Results overwrite the original files in place.',
      compactEnabled: 'Enable scheduled compaction',
      compactHours: 'Interval (hours)',
      compactModel: 'Model for compaction',
      compactDefault: 'Default model (follow settings)',
      runNow: 'Compact now',
      running: 'Compacting…',
      lastRun: 'Last run',
      never: 'Never ran',
      loadFailed: 'Load failed',
      saveFailed: 'Save failed',
      runFailed: 'Compaction failed',
      rewritten: 'rewritten',
      removed: 'removed as duplicates',
      bytes: 'bytes'
    }

    const call = async (path, init) => {
      const res = await fetch(API + path, init)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    }
    const post = (path, body) =>
      call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 820, padding: '4px 2px 24px' },
      title: { fontSize: 16, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      desc: { fontSize: 13, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)', margin: 0 },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)'
      },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      value: { fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' },
      input: {
        fontSize: 13,
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)'
      },
      textarea: {
        fontSize: 12,
        lineHeight: 1.6,
        minHeight: 220,
        padding: '8px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        resize: 'vertical'
      },
      button: {
        fontSize: 12,
        padding: '5px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer'
      },
      primary: {
        fontSize: 12,
        padding: '5px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-bg-base)',
        cursor: 'pointer'
      },
      error: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
      ok: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' },
      status: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
    }

    const formatResult = (last, t) => {
      if (last === null || last === undefined) return t('never')
      const at = typeof last.at === 'number' ? new Date(last.at).toLocaleString() : ''
      if (typeof last.error === 'string') return `${at} · ${t('runFailed')}: ${last.error}`
      const rewritten = last.rewritten?.length ?? 0
      const removed = last.removed?.length ?? 0
      const before = last.bytesBefore ?? 0
      const after = last.bytesAfter ?? 0
      return `${at} · ${rewritten} ${t('rewritten')} · ${removed} ${t('removed')} · ${before} → ${after} ${t('bytes')}`
    }

    const formatDistill = (last, t) => {
      if (last === null || last === undefined) return t('never')
      const at = typeof last.at === 'number' ? new Date(last.at).toLocaleString() : ''
      if (typeof last.error === 'string') return `${at} · ${t('runFailed')}: ${last.error}`
      const topics = last.topics?.length ?? 0
      return `${at} · ${last.files ?? 0} → ${last.facts ?? 0} ${t('facts')}${topics > 0 ? ` · ${topics} ${t('topics')}` : ''}`
    }

    function MemorySection(props) {
      const t = props.t
      const pick = props.pick
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [soulText, setSoulText] = React.useState(null)
      const [memText, setMemText] = React.useState(null)
      const [category, setCategory] = React.useState('people')
      const [topicEdit, setTopicEdit] = React.useState(null)

      const load = React.useCallback(async () => {
        try {
          const next = await call('/state')
          setState(next)
          setError('')
          return next
        } catch (err) {
          setError(`${t('loadFailed')}: ${err.message || err}`)
          return null
        }
      }, [t])

      React.useEffect(() => {
        load()
      }, [load])

      React.useEffect(() => {
        if (state === null) return
        if (soulText === null) setSoulText(state.soul?.text ?? '')
        if (memText === null) setMemText(state.memory?.text ?? '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [state])

      const running = state?.running === true
      React.useEffect(() => {
        if (!running) return undefined
        const timer = setInterval(() => {
          load()
        }, 1500)
        return () => clearInterval(timer)
      }, [running, load])

      const saveSettings = async (patch) => {
        try {
          await post('/settings', patch)
          setStatus(t('saved'))
          setError('')
          await load()
        } catch (err) {
          setError(`${t('saveFailed')}: ${err.message || err}`)
        }
      }

      const chooseFolder = async () => {
        try {
          const dir = await pick()
          if (typeof dir === 'string' && dir !== '') await saveSettings({ dir })
        } catch (err) {
          setError(`${t('saveFailed')}: ${err.message || err}`)
        }
      }


      const openTopic = async (path) => {
        try {
          const data = await call('/file?path=' + encodeURIComponent(path))
          setTopicEdit({ path, text: typeof data.text === 'string' ? data.text : '' })
          setStatus('')
        } catch (err) {
          setError(`${t('loadFailed')}: ${err.message || err}`)
        }
      }

      const saveTopic = async () => {
        if (topicEdit === null) return
        try {
          await post('/file', { path: topicEdit.path, content: topicEdit.text })
          setStatus(t('saved'))
          setError('')
          await load()
        } catch (err) {
          setError(`${t('saveFailed')}: ${err.message || err}`)
        }
      }

      const saveCore = async (path, text) => {
        try {
          await post('/file', { path, content: text })
          setStatus(t('saved'))
          setError('')
          await load()
        } catch (err) {
          setError(`${t('saveFailed')}: ${err.message || err}`)
        }
      }



      const distillNow = async () => {
        try {
          await post('/distill')
          setStatus(t('running'))
          await load()
        } catch (err) {
          setError(`${t('runFailed')}: ${err.message || err}`)
        }
      }

      const compactNow = async () => {
        try {
          await post('/compact')
          setStatus(t('running'))
          await load()
        } catch (err) {
          setError(`${t('runFailed')}: ${err.message || err}`)
        }
      }

      if (error !== '' && state === null) return h('div', { style: styles.root }, h('div', { style: styles.error }, error))

      if (state === null) return h('div', { style: styles.root }, h('div', { style: styles.status }, '…'))

      const compact = state.settings?.compact ?? {}
      const groups = state.catalog?.groups ?? []
      const modelValue = compact.provider && compact.model ? `${compact.provider}::${compact.model}` : ''

      return h(
        'div',
        { style: styles.root },
        h('div', { style: styles.title }, t('title')),
        h('p', { style: styles.desc }, t('desc')),

        h(
          'div',
          { style: styles.card },
          h('div', { style: styles.label }, t('path')),
          h('div', { style: styles.row },
            h('span', { style: styles.value }, state.root),
            h('button', { style: styles.button, onClick: chooseFolder }, t('choose')),
            h('button', { style: styles.button, onClick: () => load() }, t('refresh'))
          ),
        ),

        h(
          'div',
          { style: styles.card },
          h('div', { style: styles.title }, t('coreTitle')),
          h('div', { style: styles.status }, t('coreHint')),

          // soul.md：始终可直接编辑，文件不存在时保存即创建
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: styles.row },
              h('span', { style: styles.value }, `${state.soulFile} · ${state.soul?.bytes ?? 0} ${t('bytes')}`),
              h('button', { style: styles.primary, onClick: () => saveCore(state.soulFile, soulText ?? '') }, t('save'))
            ),
            h('textarea', {
              style: styles.textarea,
              placeholder: t('soulPlaceholder'),
              value: soulText ?? '',
              onChange: (event) => setSoulText(event.target.value)
            })
          ),

          // 分类：按钮在 MEMORY.md 编辑器上方，点选后列出该分类的主题文件
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { style: styles.row },
              ...['people', 'projects', 'decisions', 'preferences', 'lessons', 'other'].map((type) =>
                h(
                  'button',
                  {
                    key: type,
                    style: category === type ? styles.primary : styles.button,
                    onClick: () => setCategory(type)
                  },
                  `${t(type)} ${state.topics?.[type] ?? 0}`
                )
              )
            ),
            (state.topicFiles?.[category] ?? []).length === 0
              ? h('div', { style: styles.status }, t('noTopicFiles'))
              : h(
                  'div',
                  { style: styles.row },
                  ...(state.topicFiles?.[category] ?? []).map((file) =>
                    h(
                      'button',
                      { key: file.path, style: styles.button, onClick: () => openTopic(file.path) },
                      `${file.name} · ${file.bytes} B`
                    )
                  )
                ),
            topicEdit !== null &&
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('div', { style: styles.row },
                  h('span', { style: styles.value }, topicEdit.path),
                  h('button', { style: styles.primary, onClick: saveTopic }, t('save'))
                ),
                h('textarea', {
                  style: styles.textarea,
                  value: topicEdit.text,
                  onChange: (event) => setTopicEdit({ path: topicEdit.path, text: event.target.value })
                })
              )
          ),

          // MEMORY.md：索引，模型也会往里追加
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: styles.row },
              h('span', { style: styles.value }, `${state.memoryFile} · ${state.memory?.bytes ?? 0} ${t('bytes')}`),
              h('button', { style: styles.primary, onClick: () => saveCore(state.memoryFile, memText ?? '') }, t('save'))
            ),
            h('textarea', {
              style: styles.textarea,
              placeholder: t('memoryPlaceholder'),
              value: memText ?? '',
              onChange: (event) => setMemText(event.target.value)
            })
          )
        ),

        h(
          'div',
          { style: styles.card },
          h('div', { style: styles.title }, t('captureTitle')),
          h('p', { style: styles.desc }, t('captureDesc')),
          h('label', { style: styles.row },
            h('input', {
              type: 'checkbox',
              checked: state.settings?.capture?.enabled !== false,
              onChange: (event) => saveSettings({ capture: { enabled: event.target.checked } })
            }),
            h('span', { style: styles.label }, t('captureEnabled'))
          ),
          h('div', { style: styles.row },
            h('button', { style: styles.button, disabled: running, onClick: distillNow }, running ? t('running') : t('distillNow'))
          ),
          h('div', { style: styles.status }, `${t('lastDistill')}: ${formatDistill(state.lastDistill, t)}`),
          h('div', { style: styles.status }, `${t('pendingLabel')}: ${state.pending?.files ?? 0} · ${state.pending?.bytes ?? 0} B`),
          h('div', { style: styles.status }, `${t('nextAuto')}: ${state.nextRunAt ? new Date(state.nextRunAt).toLocaleString() : '—'}`),
          h('div', { style: styles.status }, t('autoHint'))
        ),

        h(
          'div',
          { style: styles.card },
          h('div', { style: styles.title }, t('compactTitle')),
          h('p', { style: styles.desc }, t('compactDesc')),
          h('label', { style: styles.row },
            h('input', {
              type: 'checkbox',
              checked: compact.enabled === true,
              onChange: (event) => saveSettings({ compact: { enabled: event.target.checked } })
            }),
            h('span', { style: styles.label }, t('compactEnabled'))
          ),
          h('label', { style: styles.row },
            h('span', { style: styles.label }, t('compactHours')),
            h('input', {
              type: 'number',
              min: 1,
              max: 720,
              style: { ...styles.input, width: 90 },
              value: compact.everyHours ?? 24,
              onChange: (event) => saveSettings({ compact: { everyHours: Number(event.target.value) } })
            })
          ),
          h('label', { style: styles.row },
            h('span', { style: styles.label }, t('compactModel')),
            h(
              'select',
              {
                style: { ...styles.input, minWidth: 260 },
                value: modelValue,
                onChange: (event) => {
                  const value = event.target.value
                  if (value === '') saveSettings({ compact: { provider: '', model: '' } })
                  else {
                    const at = value.indexOf('::')
                    saveSettings({ compact: { provider: value.slice(0, at), model: value.slice(at + 2) } })
                  }
                }
              },
              h('option', { value: '' }, t('compactDefault')),
              ...groups.flatMap((group) =>
                (group.models ?? []).map((model) =>
                  h('option', { key: `${group.id}::${model.id}`, value: `${group.id}::${model.id}` }, `${group.name ?? group.id} · ${model.name ?? model.id}`)
                )
              )
            )
          ),
          h('div', { style: styles.row },
            h('button', { style: styles.primary, disabled: running, onClick: compactNow }, running ? t('running') : t('runNow'))
          ),
          h('div', { style: styles.status }, `${t('lastRun')}: ${formatResult(state.lastResult, t)}`)
        ),

        error !== '' ? h('div', { style: styles.error }, error) : null,
        status !== '' ? h('div', { style: styles.ok }, status) : null
      )
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        try {
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-memory: dictionaries')
          const t = ctx.locale.bind(NS)
          const injected = () => ({ t, pick: () => ctx.uiWorkspace.pickDirectory() })
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'local-memory',
                order: 80,
                label: () => t('title'),
                locale: NS,
                inject: injected
              },
              MemorySection
            )
          )
        } catch (error) {
          console.warn('[local-memory] UI registration failed:', error)
        }
      }
    }
  }
})
