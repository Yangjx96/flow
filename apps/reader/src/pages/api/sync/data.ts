import type { NextApiRequest, NextApiResponse } from 'next'

import { authorize, readJson, writeJson } from '../../../server/sync-store'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

// library metadata: { books: BookRecord[], tombstones: {id: deletedAt}, updatedAt }
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authorize(req, res)) return

  if (req.method === 'GET') {
    return res.json(
      readJson('data.json') ?? { books: [], tombstones: {}, updatedAt: 0 },
    )
  }

  if (req.method === 'PUT') {
    const { books, tombstones, updatedAt } = req.body ?? {}
    if (!Array.isArray(books) || typeof updatedAt !== 'number')
      return res.status(400).end()
    writeJson('data.json', { books, tombstones: tombstones ?? {}, updatedAt })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
