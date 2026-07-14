import type { NextApiRequest, NextApiResponse } from 'next'

import { authorize, readJson, writeJson } from '../../../server/sync-store'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

// covers: { [bookId]: dataUrl | null } — small, synced as one blob
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authorize(req, res)) return

  if (req.method === 'GET') {
    return res.json(readJson('covers.json') ?? {})
  }

  if (req.method === 'PUT') {
    if (!req.body || typeof req.body !== 'object')
      return res.status(400).end()
    // covers are large and regenerable — no history snapshots
    writeJson('covers.json', req.body, false)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
