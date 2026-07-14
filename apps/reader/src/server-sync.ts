import { BookRecord } from './db'

// client for the self-hosted sync API (/api/sync/*). requests ride on the
// Authelia session cookie; the server only accepts the SYNC_USER account, so
// any other login gets 403 and sync silently turns itself off for the session.

export type SyncStatus = 'unknown' | 'on' | 'off' | 'disabled'

const ENABLED_KEY = 'serverSyncEnabled'

let status: SyncStatus = 'unknown'
const listeners = new Set<() => void>()

export function getSyncStatus(): SyncStatus {
  if (!userEnabled()) return 'disabled'
  return status
}

export function subscribeSyncStatus(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function setStatus(s: SyncStatus) {
  if (status === s) return
  status = s
  listeners.forEach((fn) => fn())
}

export function userEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0'
  } catch {
    return true
  }
}

export function setUserEnabled(v: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, v ? '1' : '0')
  } catch {}
  listeners.forEach((fn) => fn())
}

export function syncActive() {
  return userEnabled() && status !== 'off'
}

async function request(path: string, init?: RequestInit) {
  if (!syncActive()) return null
  try {
    const res = await fetch(path, init)
    if (res.status === 403) {
      // not the allowed account (or sync not configured server-side)
      setStatus('off')
      return null
    }
    if (!res.ok) return null
    setStatus('on')
    return res
  } catch {
    return null
  }
}

// ---- settings ----

export interface SettingsSnapshot {
  data: Record<string, unknown> | null
  updatedAt: number
}

export async function pullSettings(): Promise<SettingsSnapshot | null> {
  const res = await request('/api/sync/settings')
  return res ? res.json() : null
}

export async function pushSettings(data: Record<string, unknown>) {
  return request('/api/sync/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, updatedAt: Date.now() }),
  })
}

// ---- library metadata ----

export interface LibrarySnapshot {
  books: BookRecord[]
  tombstones: Record<string, number>
  updatedAt: number
}

export async function pullData(): Promise<LibrarySnapshot | null> {
  const res = await request('/api/sync/data')
  return res ? res.json() : null
}

export async function pushData(
  books: BookRecord[],
  tombstones: Record<string, number>,
) {
  return request('/api/sync/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ books, tombstones, updatedAt: Date.now() }),
  })
}

// ---- covers ----

export async function pullCovers(): Promise<Record<string, string | null> | null> {
  const res = await request('/api/sync/covers')
  return res ? res.json() : null
}

export async function pushCovers(covers: Record<string, string | null>) {
  return request('/api/sync/covers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(covers),
  })
}

// ---- epub files ----

export async function listRemoteFiles(): Promise<
  { id: string; size: number }[] | null
> {
  const res = await request('/api/sync/files')
  return res ? res.json() : null
}

export async function downloadFile(id: string): Promise<Blob | null> {
  const res = await request(`/api/sync/files/${id}`)
  return res ? res.blob() : null
}

export async function uploadFile(id: string, file: File) {
  return request(`/api/sync/files/${id}`, { method: 'PUT', body: file })
}

export async function deleteRemoteFile(id: string) {
  return request(`/api/sync/files/${id}`, { method: 'DELETE' })
}

// ---- deletion tombstones (kept locally, merged into pushes) ----

const TOMBSTONE_KEY = 'syncTombstones'

export function localTombstones(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(TOMBSTONE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function addTombstone(id: string) {
  const t = localTombstones()
  t[id] = Date.now()
  try {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(t))
  } catch {}
}

export function mergeTombstones(
  remote: Record<string, number>,
): Record<string, number> {
  const merged = { ...remote, ...localTombstones() }
  // drop entries older than 90 days to keep the payload bounded
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000
  for (const id of Object.keys(merged)) {
    if (merged[id]! < cutoff) delete merged[id]
  }
  try {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(merged))
  } catch {}
  return merged
}
