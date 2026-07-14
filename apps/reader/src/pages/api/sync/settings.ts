import type { NextApiRequest, NextApiResponse } from 'next'

import { authorize, readJson, writeJson } from '../../../server/sync-store'

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

// settings snapshot: { data: <localStorage payload>, updatedAt: number }
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authorize(req, res)) return

  if (req.method === 'GET') {
    return res.json(readJson('settings.json') ?? { data: null, updatedAt: 0 })
  }

  if (req.method === 'PUT') {
    const { data, updatedAt } = req.body ?? {}
    if (!data || typeof updatedAt !== 'number') return res.status(400).end()
    writeJson('settings.json', { data, updatedAt })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
