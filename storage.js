// dsh-local-memory — 文件库维护：备份、回收站、归档与目录初始化（Host 半内部模块）
import { copyFile, mkdir, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  BACKUP_DIR,
  DOC_RE,
  INBOX_DIR,
  TOPIC_DIR,
  TRASH_DIR,
  collectDocs,
  inside,
  relativeOf,
  stamp,
  uniquePath
} from './core.js'

/** 备份保留份数。 */
export const BACKUP_KEEP = 10
/** inbox/archive 原文保留天数。 */
export const ARCHIVE_KEEP_DAYS = 30

/** 初始化记忆目录。 */
export async function ensureLayout(root) {
  await mkdir(root, { recursive: true })
  await mkdir(join(root, TOPIC_DIR), { recursive: true })
  await mkdir(join(root, INBOX_DIR), { recursive: true })
}

/** 目录是否为空（不存在也算空）。 */
async function isEmptyDir(dir) {
  const entries = await readdir(dir).catch(() => [])
  return entries.length === 0
}

/* ---------------- 备份 ---------------- */

async function uniqueDir(root, name) {
  const base = join(root, BACKUP_DIR, name)
  if (await stat(base).then(() => false, () => true)) return base
  for (let n = 2; n < 1000; n += 1) {
    const candidate = join(root, BACKUP_DIR, `${name}-${n}`)
    if (await stat(candidate).then(() => false, () => true)) return candidate
  }
  return join(root, BACKUP_DIR, `${name}-${Date.now()}`)
}

/**
 * 备份核心记忆（soul、MEMORY、topics），不备份 inbox 原文。
 * @param {string} root
 * @param {{soulPath: string, memoryPath: string}} paths
 * @returns {Promise<{id: string, at: number, files: number, bytes: number}>}
 */
export async function createBackup(root, paths, keep = BACKUP_KEEP) {
  const id = stamp()
  const dir = await uniqueDir(root, id)
  const files = [paths.soulPath, paths.memoryPath, ...(await collectDocs(join(root, TOPIC_DIR), 500))]
  let count = 0
  let bytes = 0
  for (const file of files) {
    const st = await stat(file).catch(() => undefined)
    if (st === undefined || !st.isFile()) continue
    const rel = relativeOf(root, file)
    const target = join(dir, rel)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(file, target)
    count += 1
    bytes += st.size
  }
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ at: Date.now(), files: count, bytes }, null, 2), 'utf8').catch(() => {})
  await pruneBackups(root, keep)
  return { id: relativeOf(join(root, BACKUP_DIR), dir), at: Date.now(), files: count, bytes }
}

/** 列出备份（新的在前）。 */
export async function listBackups(root) {
  let entries = []
  try {
    entries = await readdir(join(root, BACKUP_DIR), { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(root, BACKUP_DIR, entry.name)
    let files = []
    try {
      files = await collectDocs(dir, 500)
    } catch {
      files = []
    }
    let bytes = 0
    for (const file of files) bytes += (await stat(file).catch(() => ({ size: 0 }))).size
    out.push({ id: entry.name, at: (await stat(dir).catch(() => ({ mtimeMs: 0 }))).mtimeMs, files: files.length, bytes })
  }
  // 新的在前：按目录 mtime，避免同一秒内 -10 与 -9 的字符串排序错位
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/** 删除一份备份。 */
export async function deleteBackup(root, id) {
  if (!/^[0-9][0-9A-Za-z-]*$/.test(String(id))) throw new Error('invalid backup id')
  const dir = join(root, BACKUP_DIR, String(id))
  const st = await stat(dir).catch(() => undefined)
  if (st === undefined || !st.isDirectory()) throw new Error(`backup not found: ${id}`)
  await rm(dir, { recursive: true, force: true })
  return { ok: true, id: String(id) }
}

/** 只保留最近 keep 份备份。 */
export async function pruneBackups(root, keep = BACKUP_KEEP) {
  const backups = await listBackups(root)
  for (const item of backups.slice(keep)) {
    await rm(join(root, BACKUP_DIR, item.id), { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * 从备份恢复：把备份里的 soul/MEMORY/topics 写回记忆目录（覆盖同名文件）。
 * @param {string} root
 * @param {string} id 备份 id
 * @returns {Promise<{files: number, paths: string[]}>}
 */
export async function restoreBackup(root, id) {
  if (!/^[0-9][0-9A-Za-z-]*$/.test(String(id))) throw new Error('invalid backup id')
  const dir = join(root, BACKUP_DIR, String(id))
  const st = await stat(dir).catch(() => undefined)
  if (st === undefined || !st.isDirectory()) throw new Error(`backup not found: ${id}`)
  const files = await collectDocs(dir, 500)
  const restored = []
  for (const file of files) {
    const rel = relativeOf(dir, file)
    if (!rel.startsWith(TOPIC_DIR + '/') && !/^[^/]+\.(md|txt)$/i.test(rel)) continue
    const target = inside(root, rel)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(file, target)
    restored.push(rel)
  }
  return { files: restored.length, paths: restored }
}

/* ---------------- 回收站 ---------------- */

/** 把根目录下的相对路径移动到 .trash/<id>/<rel>。 */
export async function moveToTrash(root, rel) {
  const parts = String(rel).split('/')
  if (rel === '' || String(rel).startsWith('/') || String(rel).includes('\\') || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`invalid trash path: ${rel}`)
  }
  const source = inside(root, rel)
  const st = await stat(source).catch(() => undefined)
  if (st === undefined) throw new Error(`not found: ${rel}`)
  if (!st.isFile()) throw new Error(`not a file: ${rel}`)
  const id = `${stamp()}-${String(Date.now() % 1000).padStart(3, '0')}`
  const folder = join(root, TRASH_DIR, id)
  const target = join(folder, rel)
  await mkdir(dirname(target), { recursive: true })
  await rename(source, target)
  return { id, path: rel }
}

/** 列出回收站内容。 */
export async function listTrash(root) {
  let entries = []
  try {
    entries = await readdir(join(root, TRASH_DIR), { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(root, TRASH_DIR, entry.name)
    const deletedAt = (await stat(dir).catch(() => ({ mtimeMs: 0 }))).mtimeMs
    for (const file of await collectDocs(dir, 500)) {
      const rel = relativeOf(dir, file)
      const st = await stat(file).catch(() => undefined)
      out.push({ id: entry.name, path: rel, name: rel.slice(rel.lastIndexOf('/') + 1), bytes: st?.size ?? 0, deletedAt })
    }
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt)
}

/** 恢复回收站文件；同名目标自动加 -2 后缀，绝不覆盖。 */
export async function restoreTrash(root, id, rel) {
  if (!/^[0-9][0-9A-Za-z-]*$/.test(String(id))) throw new Error('invalid trash id')
  if (typeof rel !== 'string' || rel.trim() === '') throw new Error('path is required')
  const folder = join(root, TRASH_DIR, String(id))
  const source = inside(folder, rel)
  const st = await stat(source).catch(() => undefined)
  if (st === undefined || !st.isFile()) throw new Error(`trash item not found: ${rel}`)
  const target = await uniquePath(dirname(inside(root, rel)), rel.slice(rel.lastIndexOf('/') + 1))
  await mkdir(dirname(target), { recursive: true })
  await rename(source, target)
  await removeEmptyDirs(root, folder)
  return { path: relativeOf(root, target) }
}

/** 从回收站永久删除一项。 */
export async function purgeTrash(root, id, rel) {
  const folder = join(root, TRASH_DIR, String(id))
  const source = inside(folder, rel)
  await rm(source, { force: true })
  await removeEmptyDirs(root, folder)
  return { ok: true }
}

/** 清空回收站。 */
export async function emptyTrash(root) {
  await rm(join(root, TRASH_DIR), { recursive: true, force: true })
  await mkdir(join(root, TRASH_DIR), { recursive: true })
  return { ok: true }
}

/** 清理超过保留天数的回收站内容。 */
export async function pruneTrash(root, keepDays) {
  const cutoff = Date.now() - keepDays * 24 * 3600 * 1000
  let entries = []
  try {
    entries = await readdir(join(root, TRASH_DIR), { withFileTypes: true })
  } catch {
    return []
  }
  const removed = []
  for (const entry of entries) {
    const dir = join(root, TRASH_DIR, entry.name)
    const st = await stat(dir).catch(() => undefined)
    if (st !== undefined && st.isDirectory() && st.mtimeMs < cutoff) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      removed.push(entry.name)
    }
  }
  return removed
}

/** 从 folder 向上删除空目录，直到 root（不含 root）。 */
async function removeEmptyDirs(root, folder) {
  let dir = folder
  while (dir.startsWith(root + '/') && dir !== root) {
    if (!(await isEmptyDir(dir))) break
    await rmdir(dir).catch(() => {})
    dir = dirname(dir)
  }
}

/* ---------------- inbox 归档 ---------------- */

/** 归档路径：同名文件已存在时加时间戳后缀，绝不覆盖（也绝不覆盖正在写入的新文件）。 */
export async function archivePath(folder, name) {
  const archive = join(folder, 'archive')
  await mkdir(archive, { recursive: true })
  const base = join(archive, name)
  if (await stat(base).then(() => false, () => true)) return base
  const stampText = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19)
  const dot = name.lastIndexOf('.')
  const alt = dot > 0 ? `${name.slice(0, dot)}-${stampText}${name.slice(dot)}` : `${name}-${stampText}`
  return uniquePath(archive, alt)
}

/** 上次提炼中途崩溃留下的 .processing-* 文件：恢复到 inbox 或归档。 */
export async function recoverProcessing(folder) {
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
    const base = original.replace(/\.md$/i, '')
    // 当天已有新的 capture 文件时，给恢复内容换一个 inbox 文件名，绝不归档掉未提炼的内容
    const dest = exists ? await uniquePath(folder, `${base}-recovered-${stamp()}.md`) : target
    await rename(temp, dest).catch(() => {})
  }
}

/** 删除 archive 里超过保留期的原文，避免无限增长。 */
export async function pruneArchive(folder, keepDays = ARCHIVE_KEEP_DAYS) {
  const archive = join(folder, 'archive')
  let entries = []
  try {
    entries = await readdir(archive, { withFileTypes: true })
  } catch {
    return
  }
  const cutoff = Date.now() - keepDays * 24 * 3600 * 1000
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const file = join(archive, entry.name)
    const st = await stat(file).catch(() => undefined)
    if (st !== undefined && st.mtimeMs < cutoff) await rm(file).catch(() => {})
  }
}

/** 递归统计目录里的文档数与字节数。 */
export async function dirStats(dir) {
  const files = await collectDocs(dir, 2000)
  let bytes = 0
  for (const file of files) bytes += (await stat(file).catch(() => ({ size: 0 }))).size
  return { files: files.length, bytes }
}
