import http from 'http'
import https from 'https'

import type { NextApiRequest, NextApiResponse } from 'next'

import { DEFAULT_TTS_MODEL, TTS_FALLBACK_MODELS } from '../../api-defaults'

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

const UPSTREAM_TIMEOUT = 30_000

// relays retire models without notice; recognize their "no channel" reply so
// we can retry the same request with a sibling model instead of failing
function isModelGone(status: number, body: string) {
  if (status === 404 || status === 503) {
    return /no available channel|model_not_found|does not exist/i.test(body)
  }
  return false
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { text, voice, speed } = req.body
  // fall back to server-side env so the key never has to live in the browser
  const apiUrl = req.body.apiUrl || process.env.TTS_API_URL
  const apiKey = req.body.apiKey || process.env.TTS_API_KEY
  const model = req.body.model || process.env.TTS_MODEL || DEFAULT_TTS_MODEL
  if (!text || !apiUrl || !apiKey) return res.status(400).end()

  const url = new URL(apiUrl)
  const client = url.protocol === 'https:' ? https : http
  const candidates = [
    model,
    ...TTS_FALLBACK_MODELS.filter((m) => m !== model),
  ]

  const attempt = (index: number) => {
    const payload = JSON.stringify({
      model: candidates[index],
      input: text,
      voice: voice || 'alloy',
      speed: speed || 1.0,
    })

    const upstream = client.request(
      url,
      {
        method: 'POST',
        timeout: UPSTREAM_TIMEOUT,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (upstreamRes) => {
        const status = upstreamRes.statusCode || 502
        if (status !== 200) {
          // buffer the (small) error body to decide whether to retry
          const chunks: Buffer[] = []
          upstreamRes.on('data', (c: Buffer) => chunks.push(c))
          upstreamRes.on('end', () => {
            const body = Buffer.concat(chunks).toString()
            if (index + 1 < candidates.length && isModelGone(status, body)) {
              attempt(index + 1)
            } else {
              res.status(status).end()
            }
          })
          upstreamRes.on('error', () => res.status(status).end())
          return
        }
        res.setHeader(
          'Content-Type',
          upstreamRes.headers['content-type'] || 'audio/mpeg',
        )
        upstreamRes.pipe(res)
        upstreamRes.on('error', () => res.end())
      },
    )

    upstream.on('timeout', () => upstream.destroy(new Error('timeout')))
    upstream.on('error', () => {
      if (!res.headersSent) res.status(502).end()
    })
    upstream.write(payload)
    upstream.end()
  }

  attempt(0)
}
