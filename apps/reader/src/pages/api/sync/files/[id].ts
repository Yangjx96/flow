import fs from 'fs'
import path from 'path'

import type { NextApiRequest, NextApiResponse } from 'next'

import {
  authorize,
  filesDir,
  isSafeId,
} from '../../../../server/sync-store'

// epub binary up/download; streamed, so no JSON body parsing
export const config = { api: { bodyParser: false } }

const MAX_SIZE = 300 * 1024 * 1024

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authorize(req, res)) return

  const { id } = req.query
  if (!isSafeId(id)) return res.status(400).end()
  const file = path.join(filesDir(), `${id}.epub`)

  if (req.method === 'GET') {
    if (!fs.existsSync(file)) return res.status(404).end()
    res.setHeader('Content-Type', 'application/epub+zip')
    res.setHeader('Content-Length', fs.statSync(file).size)
    fs.createReadStream(file).pipe(res)
    return
  }

  if (req.method === 'PUT') {
    fs.mkdirSync(filesDir(), { recursive: true })
    const tmp = `${file}.tmp`
    const out = fs.createWriteStream(tmp)
    let received = 0
    let aborted = false

    const fail = (code: number) => {
      if (aborted) return
      aborted = true
      out.destroy()
      fs.rm(tmp, { force: true }, () => {})
      res.status(code).end()
    }

    req.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > MAX_SIZE) {
        req.destroy()
        fail(413)
      }
    })
    req.on('error', () => fail(500))
    out.on('error', () => fail(500))
    out.on('finish', () => {
      if (aborted) return
      try {
        fs.renameSync(tmp, file)
        res.json({ ok: true, size: received })
      } catch {
        fail(500)
      }
    })
    req.pipe(out)
    return
  }

  if (req.method === 'DELETE') {
    fs.rm(file, { force: true }, (err) => {
      if (err) return res.status(500).end()
      res.json({ ok: true })
    })
    return
  }

  res.status(405).end()
}
