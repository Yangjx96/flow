import fs from 'fs'
import path from 'path'

import type { NextApiRequest, NextApiResponse } from 'next'

// self-hosted sync storage. every /api/sync/* route must pass `authorize`:
// the reverse proxy strips any client-sent Remote-User header and re-injects
// the authenticated username from Authelia, so this check cannot be spoofed
// from the outside. SYNC_USER unset = sync disabled entirely (safe default
// for other deployments of this fork).
export function authorize(req: NextApiRequest, res: NextApiResponse): boolean {
  const allowed = process.env.SYNC_USER
  const user = req.headers['remote-user']
  if (!allowed || user !== allowed) {
    res.status(403).json({ error: 'sync not authorized' })
    return false
  }
  return true
}

export function syncDir() {
  return process.env.SYNC_DIR || '/data/sync'
}

export function filesDir() {
  return path.join(syncDir(), 'files')
}

// book ids are uuids; reject anything that could escape the storage dir
export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(id)
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(syncDir(), file), 'utf8'))
  } catch {
    return null
  }
}

const HISTORY_KEEP = 30

export function writeJson(file: string, data: unknown, keepHistory = true) {
  const dir = syncDir()
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, file)
  // snapshot the previous version so a bad overwrite (stale tab pushing old
  // state, a sync bug, an accidental wipe) can always be rolled back
  if (keepHistory) {
    try {
      if (fs.existsSync(target)) {
        const histDir = path.join(dir, 'history')
        fs.mkdirSync(histDir, { recursive: true })
        fs.copyFileSync(target, path.join(histDir, `${file}.${Date.now()}`))
        const old = fs
          .readdirSync(histDir)
          .filter((f) => f.startsWith(`${file}.`))
          .sort()
        while (old.length > HISTORY_KEEP) {
          fs.unlinkSync(path.join(histDir, old.shift()!))
        }
      }
    } catch {}
  }
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, target)
}
