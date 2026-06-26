import http from 'http'
import https from 'https'

import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { text, voice, speed } = req.body
  // fall back to server-side env so the key never has to live in the browser
  const apiUrl = req.body.apiUrl || process.env.TTS_API_URL
  const apiKey = req.body.apiKey || process.env.TTS_API_KEY
  const model = req.body.model || process.env.TTS_MODEL || 'tts-1'
  if (!text || !apiUrl || !apiKey) return res.status(400).end()

  const url = new URL(apiUrl)
  const client = url.protocol === 'https:' ? https : http
  const payload = JSON.stringify({
    model,
    input: text,
    voice: voice || 'alloy',
    speed: speed || 1.0,
  })

  const upstream = client.request(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    (upstreamRes) => {
      if (upstreamRes.statusCode !== 200) {
        res.status(upstreamRes.statusCode || 502).end()
        return
      }
      res.setHeader(
        'Content-Type',
        upstreamRes.headers['content-type'] || 'audio/mpeg',
      )
      upstreamRes.pipe(res)
    },
  )

  upstream.on('error', () => res.status(502).end())
  upstream.write(payload)
  upstream.end()
}
