import fs from 'fs'
import path from 'path'

import type { NextApiRequest, NextApiResponse } from 'next'

import { authorize, filesDir } from '../../../../server/sync-store'

// list uploaded epub files: [{ id, size }]
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authorize(req, res)) return
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const dir = filesDir()
    if (!fs.existsSync(dir)) return res.json([])
    const entries = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.epub'))
      .map((f) => ({
        id: f.slice(0, -'.epub'.length),
        size: fs.statSync(path.join(dir, f)).size,
      }))
    res.json(entries)
  } catch {
    res.status(500).end()
  }
}
