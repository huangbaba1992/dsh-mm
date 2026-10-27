// dsh-mm — Web 前端：设置页（概览 / 核心文件 / 主题 / 自动化 / 回收站）
// 加载格式：window.__ModuleLoader__.load 注册懒工厂；React 由浏览器模块表提供。
window.__ModuleLoader__.load({
  id: 'dsh-mm',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const NS = 'local-memory'
    const API = 'api/local-memory'
    const GROUPS = ['people', 'projects', 'decisions', 'preferences', 'lessons', 'notes', 'other']
    const TYPES = ['person', 'project', 'decision', 'preference', 'lesson', 'note']
    const TYPE_FOR_GROUP = {
      people: 'person',
      projects: 'project',
      decisions: 'decision',
      preferences: 'preference',
      lessons: 'lesson',
      notes: 'note'
    }

    const DICT = {
      zh: {
        title: '本地记忆',
        subtitle: 'soul 与跨会话记忆存在你选择的文件夹里，纯本地、不联网。',
        root: '记忆文件夹',
        choose: '选择文件夹…',
        refresh: '刷新',
        refreshState: '刷新状态',
        tabOverview: '概览',
        tabCore: '核心文件',
        tabTopics: '主题',
        tabAutomation: '自动化',
        tabBackup: '备份',
        tabTrash: '回收站',
        never: '还没有记录',
        notScheduled: '未启用',
        none: '无',
        bytes: '字节',
        statTopics: '主题文件',
        statPending: '待提炼',
        statMemory: 'MEMORY.md',
        statSoul: 'soul.md',
        statLastDistill: '上次提炼',
        statNextRun: '下次整理',
        statBackups: '备份',
        budget: '预算',
        overBudget: '超出预算，注入会被截断',
        truncated: '编辑内容已截断，仅显示前 256 KB',
        warnings: '需要处理',
        quickActions: '快捷操作',
        distillNow: '立即提炼',
        compactNow: '立即整理',
        backupNow: '立即备份',
        running: '运行中…',
        inboxTitle: 'inbox 原始对话',
        inboxDesc: '每轮对话原文按日期存在这里；提炼后原文移到 inbox/archive/。',
        inboxEmpty: 'inbox 里还没有原文。',
        archivedCount: '归档 {n} 个文件',
        view: '查看',
        close: '关闭',
        coreTitle: 'soul.md 与 MEMORY.md',
        coreHint: '直接编辑并保存；soul 与 MEMORY 会注入 system prompt，超预算会截断。',
        soulLabel: 'soul.md · 人格与风格',
        memoryLabel: 'MEMORY.md · 长期记忆索引',
        soulPlaceholder: '身份与风格，例如：你是老黄的技术搭档，先给结论，少废话。',
        memoryPlaceholder: '长期记忆索引，例如：- 偏好纯本地方案\n- 项目 X 的部署方式……',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        unsaved: '有未保存修改',
        saveHint: '⌘S / Ctrl+S 保存当前编辑器',
        saveFailed: '保存失败',
        loadFailed: '读取失败',
        byteBudget: '{bytes} / {cap} 字节',
        topicsTitle: '主题文件',
        topicsDesc: '所有人物、项目、决策、偏好、教训与笔记都在 topics/，按 frontmatter 的 type 分类。',
        searchPlaceholder: '搜索名称、描述或路径',
        allTypes: '全部',
        newTopic: '新建主题',
        noTopics: '这个分类还没有文件；提炼或手动新建后会出现在这里。',
        noMatches: '没有匹配的主题文件。',
        typePeople: '人物',
        typeProjects: '项目',
        typeDecisions: '决策',
        typePreferences: '偏好',
        typeLessons: '教训',
        typeNotes: '笔记',
        typeOther: '其他',
        updated: '更新',
        editTopic: '编辑主题',
        fieldName: '名称',
        fieldType: '类型',
        fieldDescription: '一句话描述',
        fieldBody: '正文（一行一条事实，可留空）',
        namePlaceholder: '例如：王工 / 项目 Alpha',
        descriptionPlaceholder: '可选，用于索引和搜索',
        bodyPlaceholder: '- 负责后端上线\n- 偏好 async/await',
        create: '创建',
        creating: '创建中…',
        cancel: '取消',
        createFailed: '创建失败',
        delete: '移入回收站',
        deleteConfirm: '确认把 {name} 移入回收站？',
        deleteDone: '已移入回收站',
        confirmDelete: '确认移入回收站',
        restore: '恢复',
        restoreDone: '已恢复',
        purge: '彻底删除',
        purgeConfirm: '彻底删除后不可恢复，确认删除 {name}？',
        purgeDone: '已彻底删除',
        emptyTrash: '清空回收站',
        emptyConfirm: '确认清空回收站？所有条目会永久删除。',
        emptyDone: '回收站已清空',
        trashTitle: '回收站',
        trashDesc: '删除的主题文件先放这里，默认保留 {days} 天；恢复时绝不覆盖同名文件。',
        trashEmpty: '回收站是空的。',
        trashKeepDays: '保留天数',
        deletedAt: '删除于',
        automationTitle: '自动化',
        captureTitle: '对话记录',
        captureDesc: '每轮结束把你的话和我的回复原文追加到 inbox/日期.md；inbox 不参与注入和压缩。',
        captureEnabled: '记录每轮对话到 inbox/',
        captureMaxChars: '每条消息最多记录字符数',
        distillTitle: '提炼',
        distillDesc: '把 inbox 原文交给模型提炼成 MEMORY.md 索引与 topics/ 主题文件。',
        distillEnabled: '启用自动提炼',
        distillMinPending: '积压阈值（KB）',
        distillIdle: '空闲触发（分钟）',
        distillHint: '达到积压阈值且距上次 1 小时、空闲指定分钟、会话全部关闭或定时整理时触发。',
        lastDistill: '上次提炼',
        compactTitle: '合并去重',
        compactDesc: '按间隔把过大的记忆文件交给模型压缩，并移除完全相同的重复文件；删除项进回收站，压缩前默认自动备份。',
        compactEnabled: '启用定时整理',
        compactHours: '间隔（小时）',
        compactModel: '整理使用的模型',
        compactDefault: '默认模型（跟随当前设置）',
        compactMinBytes: '最小处理字节数',
        compactMaxInput: '单文件输入上限（字节）',
        compactMaxFiles: '每次最多压缩文件数',
        compactDedupe: '移除完全相同的重复文件（进回收站）',
        compactBackup: '压缩前自动备份',
        lastRun: '上次整理',
        skipped: '跳过/失败项',
        rewritten: '重写',
        removed: '去重',
        backupTitle: '备份',
        backupDesc: '把 soul、MEMORY 与 topics 快照到 backups/，压缩前会自动备份；默认保留最近 10 份。',
        backupEmpty: '还没有备份。',
        backupRestore: '恢复此备份',
        backupRestoreConfirm: '用备份 {id} 覆盖当前 soul / MEMORY / topics？覆盖后无法撤销。',
        backupDelete: '删除备份',
        confirmDeleteBackup: '确认删除',
        backupDeleteConfirm: '永久删除备份 {id}？此操作不可恢复。',
        backupDeleted: '备份已删除',
        backupKeep: '保留份数',
        backupHint: '恢复会覆盖当前 soul / MEMORY / topics；删除备份不可恢复。',
        backupDone: '备份完成',
        backupRestoreDone: '备份已恢复',
        backupFiles: '{n} 个文件',
        modelMissing: '未选择整理模型，自动提炼与压缩会被跳过。',
        modelsFailed: '部分模型目录加载失败。',
        settingsSaved: '设置已保存',
        resultNever: '还没有运行记录',
        resultError: '失败',
        resultFacts: '{facts} 条事实',
        resultFiles: '{files} 个文件',
        resultTopics: '{topics} 个主题',
        resultRewritten: '{n} 个文件被压缩',
        resultRemoved: '{n} 个文件进回收站',
        resultBackup: '已备份',
        toastCreated: '主题已创建',
        toastSaved: '已保存',
        toastSettings: '设置已保存',
        closeError: '关闭',
        unsavedLeave: '当前编辑有未保存修改。',
        noModelOption: '没有可用模型',
        backupCount: '{n} 份备份',
        deletedFile: '文件',
        bytesUnit: 'B'
      },
      en: {
        title: 'Local Memory',
        subtitle: 'Soul and cross-session memory live in a folder you choose. Purely local.',
        root: 'Memory folder',
        choose: 'Choose folder…',
        refresh: 'Refresh',
        refreshState: 'Refresh',
        tabOverview: 'Overview',
        tabCore: 'Core files',
        tabTopics: 'Topics',
        tabAutomation: 'Automation',
        tabBackup: 'Backups',
        tabTrash: 'Trash',
        never: 'Never',
        notScheduled: 'Disabled',
        none: 'None',
        bytes: 'bytes',
        statTopics: 'Topic files',
        statPending: 'Pending inbox',
        statMemory: 'MEMORY.md',
        statSoul: 'soul.md',
        statLastDistill: 'Last distill',
        statNextRun: 'Next compact',
        statBackups: 'Backups',
        budget: 'Budget',
        overBudget: 'Over budget; injected content will be truncated',
        truncated: 'Editor is truncated to the first 256 KB',
        warnings: 'Needs attention',
        quickActions: 'Quick actions',
        distillNow: 'Distill now',
        compactNow: 'Compact now',
        backupNow: 'Back up now',
        running: 'Running…',
        inboxTitle: 'Raw conversation inbox',
        inboxDesc: 'Each turn is appended to inbox/<date>.md; after distillation the source moves to inbox/archive/.',
        inboxEmpty: 'The inbox is empty.',
        archivedCount: '{n} archived files',
        view: 'View',
        close: 'Close',
        coreTitle: 'soul.md and MEMORY.md',
        coreHint: 'Edit and save directly. soul and MEMORY are injected into the system prompt; over-budget content is truncated.',
        soulLabel: 'soul.md · Persona and style',
        memoryLabel: 'MEMORY.md · Long-term index',
        soulPlaceholder: 'Identity and style, e.g. You are a terse systems engineer.',
        memoryPlaceholder: 'Long-term index, e.g. - prefers local-only tools',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        unsaved: 'Unsaved changes',
        saveHint: '⌘S / Ctrl+S saves the active editor',
        saveFailed: 'Save failed',
        loadFailed: 'Load failed',
        byteBudget: '{bytes} / {cap} bytes',
        topicsTitle: 'Topic files',
        topicsDesc: 'People, projects, decisions, preferences, lessons and notes live in topics/, grouped by frontmatter type.',
        searchPlaceholder: 'Search name, description or path',
        allTypes: 'All',
        newTopic: 'New topic',
        noTopics: 'No files in this category yet.',
        noMatches: 'No matching topic files.',
        typePeople: 'People',
        typeProjects: 'Projects',
        typeDecisions: 'Decisions',
        typePreferences: 'Preferences',
        typeLessons: 'Lessons',
        typeNotes: 'Notes',
        typeOther: 'Other',
        updated: 'Updated',
        editTopic: 'Edit topic',
        fieldName: 'Name',
        fieldType: 'Type',
        fieldDescription: 'One-line description',
        fieldBody: 'Body (one fact per line; optional)',
        namePlaceholder: 'e.g. Wang / Project Alpha',
        descriptionPlaceholder: 'Optional; used for index and search',
        bodyPlaceholder: '- Owns backend releases\n- Prefers async/await',
        create: 'Create',
        creating: 'Creating…',
        cancel: 'Cancel',
        createFailed: 'Create failed',
        delete: 'Move to trash',
        deleteConfirm: 'Move {name} to trash?',
        deleteDone: 'Moved to trash',
        confirmDelete: 'Move to trash',
        restore: 'Restore',
        restoreDone: 'Restored',
        purge: 'Delete forever',
        purgeConfirm: 'This cannot be undone. Delete {name} forever?',
        purgeDone: 'Deleted forever',
        emptyTrash: 'Empty trash',
        emptyConfirm: 'Empty the trash? Every item is deleted permanently.',
        emptyDone: 'Trash emptied',
        trashTitle: 'Trash',
        trashDesc: 'Deleted topic files stay here for {days} days; restoring never overwrites an existing file.',
        trashEmpty: 'The trash is empty.',
        trashKeepDays: 'Keep days',
        deletedAt: 'Deleted',
        automationTitle: 'Automation',
        captureTitle: 'Conversation log',
        captureDesc: 'Each turn appends your message and my reply verbatim to inbox/<date>.md; compaction leaves it alone.',
        captureEnabled: 'Log every turn to inbox/',
        captureMaxChars: 'Max characters per message',
        distillTitle: 'Distillation',
        distillDesc: 'Turns raw inbox logs into MEMORY.md index lines and topics/ files.',
        distillEnabled: 'Enable automatic distillation',
        distillMinPending: 'Pending threshold (KB)',
        distillIdle: 'Idle trigger (minutes)',
        distillHint: 'Runs when pending reaches the threshold and an hour passed, after the idle interval, when every session closes, or on a scheduled compact.',
        lastDistill: 'Last distill',
        compactTitle: 'Merge & dedupe',
        compactDesc: 'Compresses oversized memory files on schedule and moves byte-identical duplicates to the trash; a backup is taken before writes.',
        compactEnabled: 'Enable scheduled compaction',
        compactHours: 'Interval (hours)',
        compactModel: 'Model for compaction',
        compactDefault: 'Default model (follow settings)',
        compactMinBytes: 'Minimum file size (bytes)',
        compactMaxInput: 'Max input per file (bytes)',
        compactMaxFiles: 'Max files per run',
        compactDedupe: 'Remove identical duplicates (to trash)',
        compactBackup: 'Back up before writing',
        lastRun: 'Last run',
        skipped: 'Skipped / failed',
        rewritten: 'rewritten',
        removed: 'deduped',
        backupTitle: 'Backups',
        backupDesc: 'Snapshots soul, MEMORY and topics into backups/. Compaction takes one automatically; the latest 10 are kept.',
        backupEmpty: 'No backups yet.',
        backupRestore: 'Restore this backup',
        backupRestoreConfirm: 'Overwrite current soul / MEMORY / topics with backup {id}? This cannot be undone.',
        backupDelete: 'Delete backup',
        confirmDeleteBackup: 'Delete now',
        backupDeleteConfirm: 'Delete backup {id} permanently? This cannot be undone.',
        backupDeleted: 'Backup deleted',
        backupKeep: 'Keep count',
        backupHint: 'Restoring overwrites current soul / MEMORY / topics; deleting a backup is permanent.',
        backupDone: 'Backup created',
        backupRestoreDone: 'Backup restored',
        backupFiles: '{n} files',
        modelMissing: 'No compaction model selected; automatic distillation and compaction will be skipped.',
        modelsFailed: 'Some model catalogs failed to load.',
        settingsSaved: 'Settings saved',
        resultNever: 'No run yet',
        resultError: 'Failed',
        resultFacts: '{facts} facts',
        resultFiles: '{files} files',
        resultTopics: '{topics} topics',
        resultRewritten: '{n} files compressed',
        resultRemoved: '{n} files trashed',
        resultBackup: 'Backed up',
        toastCreated: 'Topic created',
        toastSaved: 'Saved',
        toastSettings: 'Settings saved',
        closeError: 'Dismiss',
        unsavedLeave: 'The open editor has unsaved changes.',
        noModelOption: 'No models available',
        backupCount: '{n} backups',
        deletedFile: 'File',
        bytesUnit: 'B'
      }
    }

    const byteLen = (text) => {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text ?? '')).length
      return String(text ?? '').length
    }
    const formatBytes = (value) => {
      const n = Number(value) || 0
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    }
    const percent = (value, cap) => {
      if (!cap) return 0
      return Math.min(100, Math.round((Number(value) / Number(cap)) * 100))
    }
    const formatTime = (value) => {
      if (typeof value !== 'number' || value <= 0) return ''
      return new Date(value).toLocaleString()
    }

    const call = async (path, init) => {
      const response = await fetch(API + path, init)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      return data
    }
    const post = (path, body) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

    function NumberField(props) {
      const [draft, setDraft] = useState(String(props.value ?? ''))
      useEffect(() => {
        setDraft(String(props.value ?? ''))
      }, [props.value])
      const commit = () => {
        const n = Number(draft)
        if (!Number.isFinite(n)) {
          setDraft(String(props.value ?? ''))
          return
        }
        const clamped = Math.min(Math.max(n, props.min ?? 0), props.max ?? 999999)
        setDraft(String(clamped))
        if (clamped !== props.value) props.onCommit(clamped)
      }
      return h('input', {
        type: 'number',
        className: 'lm-input lm-number',
        style: props.width ? { width: props.width } : undefined,
        min: props.min,
        max: props.max,
        value: draft,
        disabled: props.disabled,
        'aria-label': props.label,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }
      })
    }

    function BudgetBar(props) {
      const t = props.t
      const pct = percent(props.bytes, props.cap)
      const over = props.bytes > props.cap
      return h(
        'div',
        { className: 'lm-budget' },
        h(
          'div',
          { className: 'lm-budget-head' },
          h('span', null, props.label),
          h('span', { className: over ? 'lm-danger-text' : 'lm-muted' }, t('byteBudget', { bytes: formatBytes(props.bytes), cap: formatBytes(props.cap) }))
        ),
        h('div', { className: 'lm-bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { className: over ? 'lm-bar-fill is-over' : 'lm-bar-fill', style: { width: `${pct}%` } })),
        over ? h('div', { className: 'lm-hint lm-danger-text' }, t('overBudget')) : null
      )
    }

    function ConfirmBar(props) {
      const t = props.t
      return h(
        'div',
        { className: 'lm-confirm', role: 'alertdialog' },
        h('span', null, props.text),
        h(
          'span',
          { className: 'lm-row' },
          h('button', { type: 'button', className: props.danger === false ? 'lm-btn' : 'lm-btn lm-danger', onClick: props.onConfirm, disabled: props.disabled }, props.confirmLabel ?? t('delete')),
          h('button', { type: 'button', className: 'lm-btn', onClick: props.onCancel, disabled: props.disabled }, t('cancel'))
        )
      )
    }

    function MemorySection(props) {
      const t = props.t
      const pick = props.pick
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [toast, setToast] = useState(null)
      const [tab, setTab] = useState('overview')
      const [soulText, setSoulText] = useState(null)
      const [memText, setMemText] = useState(null)
      const [editor, setEditor] = useState(null)
      const [creating, setCreating] = useState(false)
      const [form, setForm] = useState({ name: '', type: 'note', description: '', body: '' })
      const [query, setQuery] = useState('')
      const [group, setGroup] = useState('all')
      const [confirm, setConfirm] = useState(null)
      const [busy, setBusy] = useState('')
      const [inboxPreview, setInboxPreview] = useState(null)
      const saveRef = useRef(() => {})

      const load = useCallback(async () => {
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

      useEffect(() => {
        void load()
        const interval = setInterval(() => void load(), state?.running ? 1500 : 20000)
        return () => clearInterval(interval)
      }, [load, state?.running])

      useEffect(() => {
        if (state === null) return
        setSoulText((current) => (current === null || current === state.soul?.text ? state.soul?.text ?? '' : current))
        setMemText((current) => (current === null || current === state.memory?.text ? state.memory?.text ?? '' : current))
      }, [state?.soul?.text, state?.memory?.text])

      useEffect(() => {
        if (toast === null) return undefined
        const timer = setTimeout(() => setToast(null), 2800)
        return () => clearTimeout(timer)
      }, [toast])

      const soulDirty = state !== null && soulText !== null && soulText !== (state.soul?.text ?? '')
      const memDirty = state !== null && memText !== null && memText !== (state.memory?.text ?? '')
      const editorDirty = editor !== null && editor.text !== editor.original

      const notify = (message) => setToast({ text: message, at: Date.now() })
      const run = async (key, task) => {
        if (busy !== '') return
        setBusy(key)
        setError('')
        try {
          await task()
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setBusy('')
        }
      }

      const saveSettings = async (patch) => {
        try {
          await post('/settings', patch)
          if (Object.prototype.hasOwnProperty.call(patch, 'dir')) {
            setSoulText(null)
            setMemText(null)
            setEditor(null)
          }
          await load()
          notify(t('settingsSaved'))
        } catch (err) {
          setError(String(err?.message ?? err))
        }
      }

      const chooseFolder = () =>
        run('folder', async () => {
          const dir = await pick()
          if (typeof dir === 'string' && dir !== '') await saveSettings({ dir })
        })

      const saveCore = (which) =>
        run(`save-${which}`, async () => {
          const path = which === 'soul' ? state.soulFile : state.memoryFile
          const info = which === 'soul' ? state.soul : state.memory
          if (info?.truncated) throw new Error(t('truncated'))
          const text = which === 'soul' ? soulText ?? '' : memText ?? ''
          await post('/file', { path, content: text })
          await load()
          notify(t('toastSaved'))
        })

      const distillNow = () =>
        run('distill', async () => {
          await post('/distill')
          await load()
          notify(t('running'))
        })

      const compactNow = () =>
        run('compact', async () => {
          await post('/compact')
          await load()
          notify(t('running'))
        })

      const backupNow = () =>
        run('backup', async () => {
          await post('/backup', { action: 'create' })
          await load()
          notify(t('backupDone'))
        })

      const openTopic = (file) =>
        run('open', async () => {
          const data = await call(`/file?path=${encodeURIComponent(file.path)}`)
          setEditor({ path: file.path, name: file.name, text: data.text ?? '', original: data.text ?? '', truncated: data.truncated === true })
          setCreating(false)
          setConfirm(null)
        })

      const saveTopic = () =>
        run('save-topic', async () => {
          if (editor === null || editor.truncated) return
          await post('/file', { path: editor.path, content: editor.text })
          setEditor({ ...editor, original: editor.text })
          await load()
          notify(t('toastSaved'))
        })

      const createTopic = () =>
        run('create', async () => {
          if (String(form.name).trim() === '') return
          const created = await post('/topic', form)
          setForm({ name: '', type: 'note', description: '', body: '' })
          setCreating(false)
          await load()
          notify(t('toastCreated'))
          if (created?.path) {
            const data = await call(`/file?path=${encodeURIComponent(created.path)}`)
            setEditor({ path: created.path, name: String(form.name).trim(), text: data.text ?? '', original: data.text ?? '' })
          }
        })

      const deleteTopic = (file) =>
        run('delete-topic', async () => {
          await post('/delete', { path: file.path })
          setConfirm(null)
          if (editor !== null && editor.path === file.path) setEditor(null)
          await load()
          notify(t('deleteDone'))
        })

      const restoreTrash = (item) =>
        run('restore-trash', async () => {
          await post('/trash', { action: 'restore', id: item.id, path: item.path })
          await load()
          notify(t('restoreDone'))
        })

      const purgeTrash = (item) =>
        run('purge-trash', async () => {
          await post('/trash', { action: 'purge', id: item.id, path: item.path })
          setConfirm(null)
          await load()
          notify(t('purgeDone'))
        })

      const emptyTrash = () =>
        run('empty-trash', async () => {
          await post('/trash', { action: 'empty' })
          setConfirm(null)
          await load()
          notify(t('emptyDone'))
        })

      const restoreBackup = (item) =>
        run('restore-backup', async () => {
          await post('/backup', { action: 'restore', id: item.id })
          setConfirm(null)
          setEditor(null)
          setSoulText(null)
          setMemText(null)
          await load()
          notify(t('backupRestoreDone'))
        })

      const deleteBackupItem = (item) =>
        run('delete-backup', async () => {
          await post('/backup', { action: 'delete', id: item.id })
          setConfirm(null)
          await load()
          notify(t('backupDeleted'))
        })

      const viewInbox = (file) =>
        run('view-inbox', async () => {
          const data = await call(`/file?path=${encodeURIComponent('inbox/' + file.name)}`)
          setInboxPreview({ name: file.name, text: data.text ?? '' })
        })

      saveRef.current = () => {
        if (tab === 'core' && soulDirty) void saveCore('soul')
        else if (tab === 'core' && memDirty) void saveCore('memory')
        else if (tab === 'topics' && editorDirty) void saveTopic()
        else if (tab === 'topics' && creating && String(form.name).trim() !== '') void createTopic()
      }

      useEffect(() => {
        const onKeyDown = (event) => {
          if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 's') {
            event.preventDefault()
            saveRef.current()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [])

      const allTopics = useMemo(() => GROUPS.flatMap((key) => (state?.topicFiles?.[key] ?? []).map((file) => ({ ...file, group: key }))), [state?.topicFiles])
      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return allTopics.filter((file) => {
          if (group !== 'all' && file.group !== group) return false
          if (needle === '') return true
          return `${file.name} ${file.description} ${file.path}`.toLowerCase().includes(needle)
        })
      }, [allTopics, group, query])

      if (state === null) {
        return h(
          'div',
          { className: 'lm-root' },
          h('div', { className: 'lm-title' }, t('title')),
          h('div', { className: 'lm-muted' }, error !== '' ? error : '…')
        )
      }

      const settings = state.settings ?? {}
      const compact = settings.compact ?? {}
      const distill = settings.distill ?? {}
      const capture = settings.capture ?? {}
      const backupSettings = settings.backup ?? {}
      const trashDays = settings.trash?.keepDays ?? 30
      const groups = state.catalog?.groups ?? []
      const modelValue = compact.provider && compact.model ? `${compact.provider}::${compact.model}` : ''
      const topicTotal = GROUPS.reduce((sum, key) => sum + (state.topics?.[key] ?? 0), 0)
      const lastDistill = state.lastDistill
      const lastResult = state.lastResult

      const tabs = [
        ['overview', t('tabOverview')],
        ['core', t('tabCore')],
        ['topics', t('tabTopics')],
        ['automation', t('tabAutomation')],
        ['backup', t('tabBackup') + (state.backups?.length ? ` ${state.backups.length}` : '')],
        ['trash', t('tabTrash') + (state.trash?.length ? ` ${state.trash.length}` : '')]
      ]

      const renderResult = (result, kind) => {
        if (result === null || result === undefined) return h('span', { className: 'lm-muted' }, t('resultNever'))
        const at = formatTime(result.at)
        if (typeof result.error === 'string') return h('span', { className: 'lm-danger-text' }, `${at} · ${t('resultError')}: ${result.error}`)
        if (kind === 'distill') {
          return h(
            'span',
            null,
            `${at} · ${t('resultFiles', { files: result.files ?? 0 })} · ${t('resultFacts', { facts: result.facts ?? 0 })}${result.topics?.length ? ` · ${t('resultTopics', { topics: result.topics.length })}` : ''}`
          )
        }
        return h(
          'span',
          null,
          `${at} · ${t('resultRewritten', { n: result.rewritten?.length ?? 0 })} · ${t('resultRemoved', { n: result.removed?.length ?? 0 })}${result.backup ? ` · ${t('resultBackup')}` : ''}`
        )
      }

      const renderSkipped = (result) => {
        if (!result?.skipped?.length) return null
        return h(
          'details',
          { className: 'lm-details' },
          h('summary', null, `${t('skipped')} (${result.skipped.length})`),
          h(
            'ul',
            { className: 'lm-list' },
            result.skipped.slice(0, 20).map((item) => h('li', { key: `${item.path}-${item.why}` }, `${item.path}: ${item.why}`))
          )
        )
      }

      const activeTopic = editor !== null
      const showEditor = tab === 'topics' && activeTopic

      return h(
        'div',
        { className: 'lm-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'lm-head' },
          h('div', null, h('div', { className: 'lm-title' }, t('title')), h('p', { className: 'lm-desc' }, t('subtitle'))),
          h(
            'div',
            { className: 'lm-root-row' },
            h('span', { className: 'lm-label' }, t('root')),
            h('code', { className: 'lm-path', title: state.root }, state.root),
            h('button', { type: 'button', className: 'lm-btn', onClick: chooseFolder, disabled: busy !== '' }, t('choose')),
            h('button', { type: 'button', className: 'lm-btn', onClick: () => void load(), disabled: busy !== '' }, t('refresh'))
          )
        ),
        error !== '' ? h('div', { className: 'lm-banner lm-banner-error', role: 'alert' }, h('span', null, error), h('button', { type: 'button', className: 'lm-link', onClick: () => setError('') }, t('close'))) : null,
        (state.warnings ?? []).length > 0
          ? h(
              'div',
              { className: 'lm-banner lm-banner-warn' },
              h('strong', null, t('warnings')),
              h('ul', { className: 'lm-list' }, state.warnings.map((warning) => h('li', { key: warning.code }, warning.text)))
            )
          : null,
        h(
          'div',
          { className: 'lm-tabs', role: 'tablist' },
          tabs.map(([key, label]) =>
            h(
              'button',
              {
                key,
                type: 'button',
                role: 'tab',
                'aria-selected': tab === key,
                className: tab === key ? 'lm-tab is-active' : 'lm-tab',
                onClick: () => {
                  if ((soulDirty || memDirty || editorDirty) && key !== tab && typeof window !== 'undefined' && window.confirm) {
                    if (!window.confirm(t('unsavedLeave'))) return
                  }
                  setTab(key)
                  if (key !== 'topics') setCreating(false)
                  setConfirm(null)
                }
              },
              label
            )
          )
        ),

        tab === 'overview'
          ? h(
              'div',
              { className: 'lm-stack' },
              h(
                'div',
                { className: 'lm-stats' },
                [
                  [t('statTopics'), String(topicTotal), t('tabTopics')],
                  [t('statPending'), `${state.pending?.files ?? 0} / ${formatBytes(state.pending?.bytes ?? 0)}`, t('inboxTitle')],
                  [t('statMemory'), formatBytes(state.memory?.fileBytes ?? 0), state.memoryFile],
                  [t('statSoul'), formatBytes(state.soul?.fileBytes ?? 0), state.soulFile],
                  [t('statLastDistill'), lastDistill?.at ? formatTime(lastDistill.at) : t('never'), t('resultNever')],
                  [t('statNextRun'), state.nextRunAt ? formatTime(state.nextRunAt) : t('notScheduled'), compact.enabled ? t('compactEnabled') : t('notScheduled')],
                  [t('statBackups'), String(state.backups?.length ?? 0), t('backupTitle')]
                ].map(([label, value, hint]) =>
                  h('div', { className: 'lm-stat', key: label }, h('div', { className: 'lm-stat-label' }, label), h('div', { className: 'lm-stat-value' }, value), h('div', { className: 'lm-stat-hint' }, hint))
                )
              ),
              h(
                'div',
                { className: 'lm-card' },
                h('div', { className: 'lm-card-title' }, t('quickActions')),
                h(
                  'div',
                  { className: 'lm-row' },
                  h('button', { type: 'button', className: 'lm-btn lm-primary', onClick: distillNow, disabled: busy !== '' || state.running }, state.running && busy === '' ? t('running') : t('distillNow')),
                  h('button', { type: 'button', className: 'lm-btn', onClick: compactNow, disabled: busy !== '' || state.running }, t('compactNow')),
                  h('button', { type: 'button', className: 'lm-btn', onClick: backupNow, disabled: busy !== '' }, t('backupNow')),
                  h('button', { type: 'button', className: 'lm-btn', onClick: () => void load(), disabled: busy !== '' }, t('refreshState'))
                ),
                h('div', { className: 'lm-hint' }, `${t('lastDistill')}: `, renderResult(lastDistill, 'distill')),
                h('div', { className: 'lm-hint' }, `${t('lastRun')}: `, renderResult(lastResult, 'compact'))
              ),
              h(
                'div',
                { className: 'lm-card' },
                h('div', { className: 'lm-card-title' }, t('budget')),
                h(BudgetBar, { t, label: state.soulFile, bytes: state.soul?.fileBytes ?? 0, cap: state.caps?.soul ?? 4096 }),
                h(BudgetBar, { t, label: state.memoryFile, bytes: state.memory?.fileBytes ?? 0, cap: state.caps?.memory ?? 4096 })
              ),
              h(
                'div',
                { className: 'lm-card' },
                h('div', { className: 'lm-card-title' }, t('inboxTitle')),
                h('div', { className: 'lm-hint' }, t('inboxDesc')),
                h('div', { className: 'lm-hint' }, t('archivedCount', { n: state.inbox?.archived ?? 0 })),
                (state.inbox?.files ?? []).length === 0
                  ? h('div', { className: 'lm-empty' }, t('inboxEmpty'))
                  : h(
                      'div',
                      { className: 'lm-file-list' },
                      state.inbox.files.map((file) =>
                        h(
                          'div',
                          { className: 'lm-file-row', key: file.name },
                          h('span', { className: 'lm-file-name' }, file.name),
                          h('span', { className: 'lm-muted' }, formatBytes(file.bytes)),
                          h('button', { type: 'button', className: 'lm-link', onClick: () => viewInbox(file) }, t('view'))
                        )
                      )
                    ),
                inboxPreview !== null
                  ? h(
                      'div',
                      { className: 'lm-preview' },
                      h('div', { className: 'lm-row lm-between' }, h('strong', null, inboxPreview.name), h('button', { type: 'button', className: 'lm-link', onClick: () => setInboxPreview(null) }, t('close'))),
                      h('textarea', { className: 'lm-textarea lm-preview-text', readOnly: true, value: inboxPreview.text })
                    )
                  : null
              )
            )
          : null,

        tab === 'core'
          ? h(
              'div',
              { className: 'lm-stack' },
              h('div', { className: 'lm-card-title' }, t('coreTitle')),
              h('div', { className: 'lm-hint' }, t('coreHint')),
              [
                ['soul', state.soulFile, soulText, setSoulText, soulDirty, state.soul],
                ['memory', state.memoryFile, memText, setMemText, memDirty, state.memory]
              ].map(([which, file, text, setText, dirty, info]) =>
                h(
                  'div',
                  { className: 'lm-card', key: which },
                  h(
                    'div',
                    { className: 'lm-row lm-between' },
                    h('div', null, h('div', { className: 'lm-card-title' }, which === 'soul' ? t('soulLabel') : t('memoryLabel')), h('div', { className: 'lm-muted' }, t('byteBudget', { bytes: formatBytes(byteLen(text ?? '')), cap: formatBytes(info?.cap ?? 4096) }))),
                    h(
                      'div',
                      { className: 'lm-row' },
                      dirty ? h('span', { className: 'lm-pill lm-pill-warn' }, t('unsaved')) : null,
                      h('button', { type: 'button', className: 'lm-btn lm-primary', onClick: () => saveCore(which), disabled: busy !== '' || !dirty || info?.truncated === true }, busy === `save-${which}` ? t('saving') : t('save'))
                    )
                  ),
                  h('textarea', {
                    className: 'lm-textarea',
                    placeholder: which === 'soul' ? t('soulPlaceholder') : t('memoryPlaceholder'),
                    value: text ?? '',
                    onChange: (event) => setText(event.target.value),
                    spellCheck: false
                  }),
                  info?.truncated ? h('div', { className: 'lm-hint lm-danger-text' }, t('truncated')) : null
                )
              ),
              h('div', { className: 'lm-hint' }, t('saveHint'))
            )
          : null,

        tab === 'topics'
          ? h(
              'div',
              { className: 'lm-stack' },
              h('div', { className: 'lm-card-title' }, t('topicsTitle')),
              h('div', { className: 'lm-hint' }, t('topicsDesc')),
              h(
                'div',
                { className: 'lm-toolbar' },
                h('input', { className: 'lm-input lm-search', type: 'search', placeholder: t('searchPlaceholder'), value: query, onChange: (event) => setQuery(event.target.value), 'aria-label': t('searchPlaceholder') }),
                h('button', { type: 'button', className: 'lm-btn lm-primary', onClick: () => { setCreating(true); setEditor(null); setConfirm(null) } }, t('newTopic')),
                h('button', { type: 'button', className: 'lm-btn', onClick: () => { setCreating(false); setEditor(null); setConfirm(null) } }, t('cancel'))
              ),
              h(
                'div',
                { className: 'lm-chips' },
                h('button', { type: 'button', className: group === 'all' ? 'lm-chip is-active' : 'lm-chip', onClick: () => setGroup('all') }, `${t('allTypes')} ${topicTotal}`),
                GROUPS.map((key) =>
                  h('button', { type: 'button', key, className: group === key ? 'lm-chip is-active' : 'lm-chip', onClick: () => setGroup(key) }, `${groupLabel(t, key)} ${state.topics?.[key] ?? 0}`)
                )
              ),
              creating
                ? h(
                    'div',
                    { className: 'lm-card lm-create' },
                    h('div', { className: 'lm-card-title' }, t('newTopic')),
                    h('label', { className: 'lm-field' }, h('span', { className: 'lm-label' }, t('fieldName')), h('input', { className: 'lm-input', value: form.name, placeholder: t('namePlaceholder'), onChange: (event) => setForm({ ...form, name: event.target.value }) })),
                    h(
                      'label',
                      { className: 'lm-field' },
                      h('span', { className: 'lm-label' }, t('fieldType')),
                      h(
                        'select',
                        { className: 'lm-input', value: form.type, onChange: (event) => setForm({ ...form, type: event.target.value }) },
                        TYPES.map((type) => h('option', { key: type, value: type }, typeLabel(t, type)))
                      )
                    ),
                    h('label', { className: 'lm-field' }, h('span', { className: 'lm-label' }, t('fieldDescription')), h('input', { className: 'lm-input', value: form.description, placeholder: t('descriptionPlaceholder'), onChange: (event) => setForm({ ...form, description: event.target.value }) })),
                    h('label', { className: 'lm-field' }, h('span', { className: 'lm-label' }, t('fieldBody')), h('textarea', { className: 'lm-textarea', rows: 6, value: form.body, placeholder: t('bodyPlaceholder'), onChange: (event) => setForm({ ...form, body: event.target.value }) })),
                    h(
                      'div',
                      { className: 'lm-row' },
                      h('button', { type: 'button', className: 'lm-btn lm-primary', onClick: createTopic, disabled: busy !== '' || String(form.name).trim() === '' }, busy === 'create' ? t('creating') : t('create')),
                      h('button', { type: 'button', className: 'lm-btn', onClick: () => setCreating(false) }, t('cancel'))
                    )
                  )
                : null,
              filtered.length === 0
                ? h('div', { className: 'lm-empty' }, query !== '' || group !== 'all' ? t('noMatches') : t('noTopics'))
                : h(
                    'div',
                    { className: 'lm-topic-list' },
                    filtered.map((file) =>
                      h(
                        'div',
                        { key: file.path, className: editor?.path === file.path ? 'lm-topic is-active' : 'lm-topic' },
                        h(
                          'button',
                          { type: 'button', className: 'lm-topic-main', onClick: () => openTopic(file) },
                          h('span', { className: 'lm-topic-name' }, file.name),
                          h('span', { className: 'lm-pill' }, typeLabel(t, file.type)),
                          h('span', { className: 'lm-topic-desc' }, file.description || file.path),
                          h('span', { className: 'lm-topic-meta' }, `${formatBytes(file.bytes)}${file.updated ? ` · ${t('updated')} ${file.updated}` : ''}`)
                        ),
                        h('button', { type: 'button', className: 'lm-btn lm-danger-ghost', onClick: () => setConfirm({ kind: 'delete-topic', file }) }, t('delete'))
                      )
                    )
                  ),
              confirm?.kind === 'delete-topic'
                ? h(ConfirmBar, { t, text: t('deleteConfirm', { name: confirm.file.name }), confirmLabel: t('confirmDelete'), onCancel: () => setConfirm(null), onConfirm: () => deleteTopic(confirm.file), disabled: busy !== '' })
                : null,
              showEditor
                ? h(
                    'div',
                    { className: 'lm-card' },
                    h(
                      'div',
                      { className: 'lm-row lm-between' },
                      h('div', null, h('div', { className: 'lm-card-title' }, t('editTopic')), h('code', { className: 'lm-path' }, editor.path)),
                      h(
                        'div',
                        { className: 'lm-row' },
                        editorDirty ? h('span', { className: 'lm-pill lm-pill-warn' }, t('unsaved')) : null,
                        h('button', { type: 'button', className: 'lm-btn lm-primary', onClick: saveTopic, disabled: busy !== '' || !editorDirty || editor.truncated === true }, busy === 'save-topic' ? t('saving') : t('save')),
                        h('button', { type: 'button', className: 'lm-btn', onClick: () => setEditor(null), disabled: busy !== '' }, t('close'))
                      )
                    ),
                    editor.truncated ? h('div', { className: 'lm-hint lm-danger-text' }, t('truncated')) : null,
                    h('textarea', { className: 'lm-textarea lm-tall', value: editor.text, onChange: (event) => setEditor({ ...editor, text: event.target.value }), spellCheck: false })
                  )
                : null
            )
          : null,

        tab === 'automation'
          ? h(
              'div',
              { className: 'lm-stack' },
              h('div', { className: 'lm-card-title' }, t('automationTitle')),

              h(
                'div',
                { className: 'lm-card' },
                h('div', { className: 'lm-card-title' }, t('captureTitle')),
                h('div', { className: 'lm-hint' }, t('captureDesc')),
                h(
                  'label',
                  { className: 'lm-check' },
                  h('input', { type: 'checkbox', checked: capture.enabled !== false, onChange: (event) => void saveSettings({ capture: { enabled: event.target.checked } }) }),
                  h('span', null, t('captureEnabled'))
                ),
                h(
                  'label',
                  { className: 'lm-field lm-field-inline' },
                  h('span', { className: 'lm-label' }, t('captureMaxChars')),
                  h(NumberField, { value: capture.maxChars ?? 1500, min: 200, max: 8000, label: t('captureMaxChars'), disabled: busy !== '', onCommit: (value) => void saveSettings({ capture: { maxChars: value } }) })
                )
              ),

              h(
                'div',
                { className: 'lm-card' },
                h('div', { className: 'lm-card-title' }, t('distillTitle')),
                h('div', { className: 'lm-hint' }, t('distillDesc')),
                h(
                  'label',
                  { className: 'lm-check' },
                  h('input', { type: 'checkbox', checked: distill.enabled !== false, onChange: (event) => void saveSettings({ distill: { enabled: event.target.checked } }) }),
                  h('span', null, t('distillEnabled'))
                ),
                h(
                  'div',
                  { className: 'lm-field-grid' },
                  h('label', { className: 'lm-field' }, h('span', { className: 'lm-label' }, t('distillMinPending')), h(NumberField, { value: distill.minPendingKB ?? 16, min: 1, max: 1024, label: t('distillMinPending'), disabled: busy !== '', onCommit: (value) => void saveSettings({ distill: { minPendingKB: value } }) })),
                  h('label', { className: 'lm-field' }, h('span', { className: 'lm-label' }, t('distillIdle')), h(NumberField, { value: distill.idleMinutes ?? 30, min: 5, max: 1440, label: t('distillIdle'), disabled: busy !== '', onCommit: (value) => void saveSettings({ distill: { idleMinutes: value } }) }))
                ),
                h('div', { className: 'lm-hint' }, t('distillHint')),
                h('div', { className: 'lm-hint' }, `${t('lastDistill')}: `, renderResult(lastDistill, 'distill')),
                h(
                  'div',
                  { className: 'lm-row' },
                  h('button', { type: 'button', className: 'lm-btn lm-primary', onClick: distillNow, disabled: busy !== '' || state.running }, state.running && busy === '' ? t('running') : t('distillNow'))
                )
              ),

              h(
                'div',
                { className: 'lm-card' },
                h('div', { className: 'lm-card-title' }, t('compactTitle')),
                h('div', { className: 'lm-hint' }, t('compactDesc')),
                h(
                  'label',
                  { className: 'lm-check' },
                  h('input', { type: 'checkbox', checked: compact.enabled === true, onChange: (event) => void saveSettings({ compact: { enabled: event.target.checked } }) }),
                  h('span', null, t('compactEnabled'))
                ),
                h(
                  'div',
                  { className: 'lm-field-grid' },
                  h('label', { className: 'lm-field' }, h('span', { className: 'lm-label' }, t('compactHours')), h(NumberField, { value: compact.everyHours ?? 24, min: 1, max: 720, label: t('compactHours'), disabled: busy !== '', onCommit: (value) => void saveSettings({ compact: { everyHours: value } }) })),
                  h('label', { className: 'lm-field' }, h('span', { className: 'lm-label' }, t('compactMinBytes')), h(NumberField, { value: compact.minFileBytes ?? 2048, min: 256, max: 1048576, label: t('compactMinBytes'), disabled: busy !== '', onCommit: (value) => void saveSettings({ compact: { minFileBytes: value } }) })),
                  h('label', { className: 'lm-field' }, h('span', { className: 'lm-label' }, t('compactMaxInput')), h(NumberField, { value: compact.maxInputBytes ?? 32768, min: 1024, max: 524288, label: t('compactMaxInput'), disabled: busy !== '', onCommit: (value) => void saveSettings({ compact: { maxInputBytes: value } }) })),
                  h('label', { className: 'lm-field' }, h('span', { className: 'lm-label' }, t('compactMaxFiles')), h(NumberField, { value: compact.maxFilesPerRun ?? 5, min: 1, max: 50, label: t('compactMaxFiles'), disabled: busy !== '', onCommit: (value) => void saveSettings({ compact: { maxFilesPerRun: value } }) }))
                ),
                h(
                  'label',
                  { className: 'lm-field' },
                  h('span', { className: 'lm-label' }, t('compactModel')),
                  h(
                    'select',
                    {
                      className: 'lm-input',
                      value: modelValue,
                      onChange: (event) => {
                        const value = event.target.value
                        if (value === '') void saveSettings({ compact: { provider: '', model: '' } })
                        else {
                          const at = value.indexOf('::')
                          void saveSettings({ compact: { provider: value.slice(0, at), model: value.slice(at + 2) } })
                        }
                      }
                    },
                    h('option', { value: '' }, t('compactDefault')),
                    groups.flatMap((entry) => (entry.models ?? []).map((model) => h('option', { key: `${entry.id}::${model.id}`, value: `${entry.id}::${model.id}` }, `${entry.name ?? entry.id} · ${model.name ?? model.id}`)))
                  )
                ),
                h(
                  'label',
                  { className: 'lm-check' },
                  h('input', { type: 'checkbox', checked: compact.removeExactDuplicates !== false, onChange: (event) => void saveSettings({ compact: { removeExactDuplicates: event.target.checked } }) }),
                  h('span', null, t('compactDedupe'))
                ),
                h(
                  'label',
                  { className: 'lm-check' },
                  h('input', { type: 'checkbox', checked: compact.backupBeforeRun !== false, onChange: (event) => void saveSettings({ compact: { backupBeforeRun: event.target.checked } }) }),
                  h('span', null, t('compactBackup'))
                ),
                (state.catalog?.failures ?? []).length > 0 ? h('div', { className: 'lm-hint lm-danger-text' }, t('modelsFailed')) : null,
                h('div', { className: 'lm-hint' }, `${t('lastRun')}: `, renderResult(lastResult, 'compact')),
                renderSkipped(lastResult),
                h(
                  'div',
                  { className: 'lm-row' },
                  h('button', { type: 'button', className: 'lm-btn lm-primary', onClick: compactNow, disabled: busy !== '' || state.running }, state.running && busy === '' ? t('running') : t('compactNow'))
                )
              )
            )
          : null,

        tab === 'backup'
          ? h(
              'div',
              { className: 'lm-stack' },
              h('div', { className: 'lm-card-title' }, t('backupTitle')),
              h('div', { className: 'lm-hint' }, t('backupDesc')),
              h('div', { className: 'lm-hint' }, t('backupHint')),
              h(
                'div',
                { className: 'lm-row' },
                h('button', { type: 'button', className: 'lm-btn lm-primary', onClick: backupNow, disabled: busy !== '' }, t('backupNow')),
                h(
                  'label',
                  { className: 'lm-field lm-field-inline' },
                  h('span', { className: 'lm-label' }, t('backupKeep')),
                  h(NumberField, { value: backupSettings.keep ?? 10, min: 1, max: 50, label: t('backupKeep'), disabled: busy !== '', onCommit: (value) => void saveSettings({ backup: { keep: value } }) })
                )
              ),
              h('div', { className: 'lm-hint' }, t('backupCount', { n: state.backups?.length ?? 0 })),
              (state.backups ?? []).length === 0
                ? h('div', { className: 'lm-empty' }, t('backupEmpty'))
                : h(
                    'div',
                    { className: 'lm-file-list' },
                    state.backups.map((item) =>
                      h(
                        'div',
                        { className: 'lm-file-row', key: item.id },
                        h('span', { className: 'lm-file-name' }, item.id),
                        h('span', { className: 'lm-muted' }, `${t('backupFiles', { n: item.files })} · ${formatBytes(item.bytes)} · ${formatTime(item.at)}`),
                        h('button', { type: 'button', className: 'lm-link', onClick: () => setConfirm({ kind: 'restore-backup', item }), disabled: busy !== '' }, t('backupRestore')),
                        h('button', { type: 'button', className: 'lm-link lm-danger-text', onClick: () => setConfirm({ kind: 'delete-backup', item }), disabled: busy !== '' }, t('backupDelete'))
                      )
                    )
                  ),
              confirm?.kind === 'restore-backup'
                ? h(ConfirmBar, { t, text: t('backupRestoreConfirm', { id: confirm.item.id }), confirmLabel: t('backupRestore'), danger: true, onCancel: () => setConfirm(null), onConfirm: () => restoreBackup(confirm.item), disabled: busy !== '' })
                : null,
              confirm?.kind === 'delete-backup'
                ? h(ConfirmBar, { t, text: t('backupDeleteConfirm', { id: confirm.item.id }), confirmLabel: t('confirmDeleteBackup'), onCancel: () => setConfirm(null), onConfirm: () => deleteBackupItem(confirm.item), disabled: busy !== '' })
                : null
            )
          : null,

        tab === 'trash'
          ? h(
              'div',
              { className: 'lm-stack' },
              h('div', { className: 'lm-card-title' }, t('trashTitle')),
              h('div', { className: 'lm-hint' }, t('trashDesc', { days: trashDays })),
              h(
                'label',
                { className: 'lm-field lm-field-inline' },
                h('span', { className: 'lm-label' }, t('trashKeepDays')),
                h(NumberField, { value: trashDays, min: 1, max: 365, label: t('trashKeepDays'), disabled: busy !== '', onCommit: (value) => void saveSettings({ trash: { keepDays: value } }) })
              ),
              (state.trash ?? []).length === 0
                ? h('div', { className: 'lm-empty' }, t('trashEmpty'))
                : h(
                    'div',
                    { className: 'lm-file-list' },
                    state.trash.map((item) =>
                      h(
                        'div',
                        { className: 'lm-file-row', key: `${item.id}/${item.path}` },
                        h('span', { className: 'lm-file-name', title: item.path }, item.path),
                        h('span', { className: 'lm-muted' }, `${formatBytes(item.bytes)} · ${t('deletedAt')} ${formatTime(item.deletedAt)}`),
                        h('button', { type: 'button', className: 'lm-link', onClick: () => restoreTrash(item), disabled: busy !== '' }, t('restore')),
                        h('button', { type: 'button', className: 'lm-link lm-danger-text', onClick: () => setConfirm({ kind: 'purge-trash', item }) }, t('purge'))
                      )
                    )
                  ),
              confirm?.kind === 'purge-trash'
                ? h(ConfirmBar, { t, text: t('purgeConfirm', { name: confirm.item.path }), confirmLabel: t('purge'), onCancel: () => setConfirm(null), onConfirm: () => purgeTrash(confirm.item), disabled: busy !== '' })
                : null,
              (state.trash ?? []).length > 0
                ? h(
                    'div',
                    { className: 'lm-row' },
                    confirm?.kind === 'empty-trash'
                      ? h(ConfirmBar, { t, text: t('emptyConfirm'), confirmLabel: t('emptyTrash'), onCancel: () => setConfirm(null), onConfirm: emptyTrash, disabled: busy !== '' })
                      : h('button', { type: 'button', className: 'lm-btn lm-danger', onClick: () => setConfirm({ kind: 'empty-trash' }), disabled: busy !== '' }, t('emptyTrash'))
                  )
                : null
            )
          : null,

        h('div', { className: 'lm-hint lm-save-hint' }, t('saveHint')),
        toast !== null ? h('div', { className: 'lm-toast', role: 'status' }, toast.text) : null
      )
    }

    const groupLabel = (t, key) => t(`type${key.slice(0, 1).toUpperCase()}${key.slice(1)}`)
    const typeLabel = (t, type) => {
      const group = Object.keys(TYPE_FOR_GROUP).find((key) => TYPE_FOR_GROUP[key] === type)
      return group ? groupLabel(t, group) : t('typeOther')
    }

    const CSS = `
      .lm-root { display: flex; flex-direction: column; gap: 14px; max-width: 980px; padding: 4px 2px 28px; color: var(--dsw-alias-label-primary, #ececec); font-size: 13px; }
      .lm-head { display: flex; flex-direction: column; gap: 10px; }
      .lm-title { font-size: 16px; font-weight: 600; }
      .lm-desc { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #9a9a9a); }
      .lm-root-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .lm-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-primary, #ececec); word-break: break-all; }
      .lm-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--dsw-alias-border-l1, #333); overflow-x: auto; }
      .lm-tab { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #9a9a9a); font-size: 13px; padding: 8px 10px; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; }
      .lm-tab:hover { color: var(--dsw-alias-label-primary, #ececec); }
      .lm-tab.is-active { color: var(--dsw-alias-label-primary, #ececec); border-bottom-color: var(--dsw-alias-brand-primary, #4d9fff); font-weight: 600; }
      .lm-stack { display: flex; flex-direction: column; gap: 12px; }
      .lm-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--dsw-alias-border-l1, #333); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #1b1b1b); }
      .lm-card-title { font-size: 13px; font-weight: 600; }
      .lm-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
      .lm-stat { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1, #333); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #1b1b1b); }
      .lm-stat-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #9a9a9a); }
      .lm-stat-value { font-size: 17px; font-weight: 600; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; }
      .lm-stat-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary, #757575); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lm-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .lm-between { justify-content: space-between; }
      .lm-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #9a9a9a); }
      .lm-muted { font-size: 12px; color: var(--dsw-alias-label-secondary, #9a9a9a); }
      .lm-hint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary, #9a9a9a); }
      .lm-danger-text { color: var(--dsw-alias-state-error-primary, #ff6b6b); }
      .lm-btn { appearance: none; font-size: 12px; padding: 6px 10px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2, #444); background: var(--dsw-alias-bg-layer-2, #252525); color: var(--dsw-alias-label-primary, #ececec); cursor: pointer; }
      .lm-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary, #4d9fff); }
      .lm-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .lm-primary { border-color: var(--dsw-alias-brand-primary, #4d9fff); background: var(--dsw-alias-brand-primary, #4d9fff); color: var(--dsw-alias-bg-base, #111); font-weight: 600; }
      .lm-danger { border-color: var(--dsw-alias-state-error-primary, #ff6b6b); color: var(--dsw-alias-state-error-primary, #ff6b6b); background: transparent; }
      .lm-danger-ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-state-error-primary, #ff6b6b); }
      .lm-link { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-brand-primary, #4d9fff); font-size: 12px; cursor: pointer; padding: 0; }
      .lm-input { box-sizing: border-box; width: 100%; font-size: 13px; padding: 7px 9px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1, #333); background: var(--dsw-alias-bg-base, #111); color: var(--dsw-alias-label-primary, #ececec); }
      .lm-number { max-width: 130px; }
      .lm-search { flex: 1 1 220px; }
      .lm-textarea { box-sizing: border-box; width: 100%; min-height: 190px; resize: vertical; font-size: 12px; line-height: 1.65; padding: 9px 11px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1, #333); background: var(--dsw-alias-bg-base, #111); color: var(--dsw-alias-label-primary, #ececec); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .lm-tall { min-height: 300px; }
      .lm-preview-text { min-height: 160px; margin-top: 8px; }
      .lm-field { display: flex; flex-direction: column; gap: 4px; }
      .lm-field-inline { flex-direction: row; align-items: center; gap: 10px; }
      .lm-field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
      .lm-check { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 1.5; cursor: pointer; }
      .lm-budget { display: flex; flex-direction: column; gap: 5px; }
      .lm-budget-head { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
      .lm-bar { height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2, #252525); overflow: hidden; }
      .lm-bar-fill { display: block; height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary, #4d9fff); transition: width 0.2s ease; }
      .lm-bar-fill.is-over { background: var(--dsw-alias-state-error-primary, #ff6b6b); }
      .lm-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .lm-chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .lm-chip { appearance: none; font-size: 12px; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1, #333); background: transparent; color: var(--dsw-alias-label-secondary, #9a9a9a); cursor: pointer; }
      .lm-chip.is-active { border-color: var(--dsw-alias-brand-primary, #4d9fff); color: var(--dsw-alias-label-primary, #ececec); background: var(--dsw-alias-bg-layer-2, #252525); }
      .lm-topic-list, .lm-file-list { display: flex; flex-direction: column; gap: 6px; }
      .lm-topic { display: flex; align-items: stretch; gap: 6px; border: 1px solid var(--dsw-alias-border-l1, #333); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #1b1b1b); }
      .lm-topic.is-active { border-color: var(--dsw-alias-brand-primary, #4d9fff); }
      .lm-topic-main { flex: 1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; text-align: left; appearance: none; border: 0; background: transparent; color: inherit; padding: 9px 12px; cursor: pointer; }
      .lm-topic-name { font-weight: 600; }
      .lm-topic-desc { flex: 1 1 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary, #9a9a9a); font-size: 12px; }
      .lm-topic-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary, #757575); white-space: nowrap; }
      .lm-topic .lm-danger-ghost { padding: 0 10px; }
      .lm-file-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1, #333); border-radius: 8px; background: var(--dsw-alias-bg-base, #111); }
      .lm-file-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; flex: 1 1 220px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .lm-banner { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, #333); font-size: 12px; line-height: 1.55; display: flex; flex-direction: column; gap: 6px; }
      .lm-banner-error { border-color: var(--dsw-alias-state-error-primary, #ff6b6b); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff6b6b) 8%, transparent); }
      .lm-banner-warn { border-color: var(--dsw-alias-state-warn-primary, #f5a623); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f5a623) 8%, transparent); }
      .lm-banner ul { margin: 0; padding-left: 18px; }
      .lm-list { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #9a9a9a); }
      .lm-pill { display: inline-block; font-size: 11px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1, #333); color: var(--dsw-alias-label-secondary, #9a9a9a); white-space: nowrap; }
      .lm-pill-warn { border-color: var(--dsw-alias-state-warn-primary, #f5a623); color: var(--dsw-alias-state-warn-primary, #f5a623); }
      .lm-empty { padding: 18px 12px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-secondary, #9a9a9a); border: 1px dashed var(--dsw-alias-border-l1, #333); border-radius: 8px; }
      .lm-confirm { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--dsw-alias-state-error-primary, #ff6b6b); border-radius: 8px; font-size: 12px; }
      .lm-details summary { cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-secondary, #9a9a9a); }
      .lm-preview { margin-top: 8px; padding-top: 10px; border-top: 1px dashed var(--dsw-alias-border-l1, #333); }
      .lm-toast { position: sticky; bottom: 12px; align-self: flex-start; padding: 8px 14px; border-radius: 999px; background: var(--dsw-alias-brand-primary, #4d9fff); color: var(--dsw-alias-bg-base, #111); font-size: 12px; font-weight: 600; box-shadow: 0 6px 20px rgba(0,0,0,0.25); }
      .lm-save-hint { margin-top: -4px; }
      @media (max-width: 640px) { .lm-topic-desc { display: none; } .lm-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    `

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        try {
          ctx.effect(() => ctx.locale.register(NS, DICT), 'local-memory: dictionaries')
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
          console.warn('[dsh-mm] UI registration failed:', error)
        }
      }
    }
  }
})
