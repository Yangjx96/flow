import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'

import { db } from '@flow/reader/db'
import {
  getSyncStatus,
  listRemoteFiles,
  localTombstones,
  mergeTombstones,
  pullCovers,
  pullData,
  pullSettings,
  pushCovers,
  pushData,
  pushSettings,
  subscribeSyncStatus,
  syncActive,
  SyncStatus,
  uploadFile,
} from '@flow/reader/server-sync'
import { Settings, TtsConfig, useSettings, useTtsConfig } from '@flow/reader/state'

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(getSyncStatus())
  useEffect(() => subscribeSyncStatus(() => setS(getSyncStatus())), [])
  return s
}

const STAMP_KEY = 'settingsSyncStamp'

function getStamp() {
  try {
    return Number(localStorage.getItem(STAMP_KEY)) || 0
  } catch {
    return 0
  }
}

function setStamp(ts: number) {
  try {
    localStorage.setItem(STAMP_KEY, String(ts))
  } catch {}
}

function readLocal(key: string) {
  try {
    const s = localStorage.getItem(key)
    return s ? JSON.parse(s) : undefined
  } catch {
    return undefined
  }
}

function buildSettingsPayload(cfg: TtsConfig, settings: Settings) {
  const payload: Record<string, unknown> = {
    ttsConfig3: cfg,
    settingsV2: settings,
  }
  const size = readLocal('popupSize')
  const offset = readLocal('popupOffset')
  if (size) payload.popupSize = size
  if (offset) payload.popupOffset = offset
  return payload
}

// sync all preferences (tts/translate config incl. API presets, typography,
// popup geometry) through the self-hosted backend
export function useServerSettingsSync() {
  const [cfg, setCfg] = useTtsConfig()
  const [settings, setSettings] = useSettings()
  const pulled = useRef(false)
  // bumped when the initial pull finishes so the push effect re-evaluates
  // (otherwise local-only state from before the pull would never be pushed)
  const [pullTick, setPullTick] = useState(0)
  const lastSynced = useRef('')
  const latest = useRef({ cfg, settings })
  latest.current = { cfg, settings }

  const pull = async () => {
    const snap = await pullSettings()
    if (snap?.data && snap.updatedAt > getStamp()) {
      const d = snap.data as Record<string, any>
      if (d.ttsConfig3) setCfg(d.ttsConfig3)
      if (d.settingsV2) setSettings(d.settingsV2)
      try {
        if (d.popupSize)
          localStorage.setItem('popupSize', JSON.stringify(d.popupSize))
        if (d.popupOffset)
          localStorage.setItem('popupOffset', JSON.stringify(d.popupOffset))
      } catch {}
      lastSynced.current = JSON.stringify(
        buildSettingsPayload(d.ttsConfig3 ?? latest.current.cfg, d.settingsV2 ?? latest.current.settings),
      )
      setStamp(snap.updatedAt)
    }
    pulled.current = true
    setPullTick((t) => t + 1)
  }

  useEffect(() => {
    pull()
    // refresh when coming back to the app after using another device
    let lastPull = Date.now()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastPull < 60_000) return
      lastPull = Date.now()
      pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // push local changes, debounced; skip echoes of what we just pulled
  useEffect(() => {
    if (!pulled.current || !syncActive()) return
    const payload = buildSettingsPayload(cfg, settings)
    const s = JSON.stringify(payload)
    if (s === lastSynced.current) return
    const t = setTimeout(() => {
      lastSynced.current = s
      pushSettings(payload).then((res) => {
        if (res) setStamp(Date.now())
      })
    }, 2000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, settings, pullTick])

  // flush pending changes (e.g. popup resize, which bypasses recoil) on leave
  useEffect(() => {
    const flush = () => {
      if (!pulled.current || !syncActive()) return
      const payload = buildSettingsPayload(
        latest.current.cfg,
        latest.current.settings,
      )
      const s = JSON.stringify(payload)
      if (s === lastSynced.current) return
      lastSynced.current = s
      try {
        navigator.sendBeacon(
          '/api/sync/settings',
          new Blob([JSON.stringify({ data: payload, updatedAt: Date.now() })], {
            type: 'application/json',
          }),
        )
        setStamp(Date.now())
      } catch {}
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])
}

// sync the library metadata (progress, annotations, book list) and
// auto-upload epubs that only exist locally. epub *downloads* stay manual
// (tap a cloud book) to save bandwidth on light devices.
export function useServerLibrarySync() {
  const ready = useRef(false)
  // see useServerSettingsSync: re-arm the push/upload effects once the
  // initial pull completes, since the live queries fired before it
  const [pullTick, setPullTick] = useState(0)
  const lastPushed = useRef('')
  const uploading = useRef(new Set<string>())

  const pull = async () => {
    const snap = await pullData()
    if (!snap || !db) {
      ready.current = true
      return
    }
    try {
      const tombs = mergeTombstones(snap.tombstones ?? {})

      // apply deletions from other devices
      const local = await db.books.toArray()
      for (const b of local) {
        const ts = tombs[b.id]
        if (ts && (b.updatedAt ?? b.createdAt ?? 0) < ts) {
          await db.books.delete(b.id)
          await db.files.delete(b.id)
          await db.covers.delete(b.id)
        }
      }

      // merge remote records, newest updatedAt wins
      const map = new Map((await db.books.toArray()).map((b) => [b.id, b]))
      const puts = snap.books.filter((r) => {
        const ts = tombs[r.id]
        if (ts && (r.updatedAt ?? 0) < ts) return false
        const l = map.get(r.id)
        return !l || (r.updatedAt ?? 0) > (l.updatedAt ?? 0)
      })
      if (puts.length) await db.books.bulkPut(puts)

      // fetch covers we don't have yet (cloud-only books still get a cover)
      const coverIds = new Set(await db.covers.toCollection().primaryKeys())
      const missing = (await db.books.toArray()).filter(
        (b) => !coverIds.has(b.id),
      )
      if (missing.length) {
        const covers = await pullCovers()
        if (covers) {
          const cputs = missing
            .filter((b) => covers[b.id] !== undefined)
            .map((b) => ({ id: b.id, cover: covers[b.id]! }))
          if (cputs.length) await db.covers.bulkPut(cputs)
        }
      }
    } catch (e) {
      console.error('library sync pull failed', e)
    }
    ready.current = true
    setPullTick((t) => t + 1)
  }

  useEffect(() => {
    pull()
    let lastPull = Date.now()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastPull < 60_000) return
      lastPull = Date.now()
      pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // push metadata whenever the local library changes (reading progress,
  // annotations, imports, deletions, ...)
  const books = useLiveQuery(() => db?.books.toArray() ?? [])
  useEffect(() => {
    if (!ready.current || !books || !syncActive()) return
    const s = JSON.stringify(books)
    if (s === lastPushed.current) return
    const t = setTimeout(() => {
      lastPushed.current = s
      pushData(books, mergeTombstones(localTombstones()))
    }, 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, pullTick])

  // auto-upload epub files that exist locally but not on the server
  const fileIds = useLiveQuery(
    () => db?.files.toCollection().primaryKeys() ?? [],
  )
  useEffect(() => {
    if (!ready.current || !fileIds?.length || !syncActive()) return
    ;(async () => {
      const remote = await listRemoteFiles()
      if (!remote || !db) return
      const remoteIds = new Set(remote.map((f) => f.id))
      let uploaded = false
      for (const id of fileIds as string[]) {
        if (remoteIds.has(id) || uploading.current.has(id)) continue
        const rec = await db.files.get(id)
        if (!rec) continue
        uploading.current.add(id)
        try {
          await uploadFile(id, rec.file)
          uploaded = true
        } finally {
          uploading.current.delete(id)
        }
      }
      if (uploaded) {
        // keep the server cover set complete for other devices
        const remoteCovers = (await pullCovers()) ?? {}
        const locals = await db.covers.toArray()
        locals.forEach((c) => {
          remoteCovers[c.id] = c.cover
        })
        await pushCovers(remoteCovers)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIds, pullTick])
}
