import type { NextApiRequest, NextApiResponse } from 'next'
import https from 'https'
import http from 'http'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { text, apiUrl, apiKey } = req.body
  if (!text || !apiUrl || !apiKey) return res.status(400).end()

  const url = new URL(apiUrl)
  const client = url.protocol === 'https:' ? https : http
  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a concise English-Chinese dictionary. For single words: give pronunciation (IPA), part of speech, and main Chinese meanings. For phrases/sentences: give only the Chinese translation. Keep it very short.',
      },
      { role: 'user', content: text },
    ],
    max_tokens: 150,
    temperature: 0.3,
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
      const chunks: Buffer[] = []
      upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      upstreamRes.on('end', () => {
        if (upstreamRes.statusCode !== 200) {
          res.status(upstreamRes.statusCode || 502).end()
          return
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString())
          const translation = data.choices?.[0]?.message?.content || ''
          res.json({ translation })
        } catch {
          res.status(502).end()
        }
      })
    },
  )

  upstream.on('error', () => res.status(502).end())
  upstream.write(payload)
  upstream.end()
}
