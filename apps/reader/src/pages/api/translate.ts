import http from 'http'
import https from 'https'

import type { NextApiRequest, NextApiResponse } from 'next'

import {
  DEFAULT_TRANSLATE_PROMPT,
  TRANSLATE_MAX_TOKENS,
  translatePayloadExtras,
} from '../../api-defaults'

// google answers in ~100ms from this box; LLM relays can take a few seconds
// on long passages. Without these, a black-holed upstream pins the request
// (and the reader UI) for minutes.
const GOOGLE_TIMEOUT = 8_000
const LLM_TIMEOUT = 25_000

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') return res.status(405).end()

  const { text, method, model, systemPrompt } = req.body
  if (!text) return res.status(400).end()

  // fall back to server-side env so the key never has to live in the browser
  const apiUrl = req.body.apiUrl || process.env.LLM_API_URL
  const apiKey = req.body.apiKey || process.env.LLM_API_KEY

  if (method === 'llm' && apiUrl && apiKey) {
    return llmTranslate(text, apiUrl, apiKey, res, model, systemPrompt)
  }
  return googleTranslate(text, res)
}

async function googleTranslate(text: string, res: NextApiResponse) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'en',
    tl: 'zh-CN',
    dt: 't',
    q: text,
  })
  const url = `https://translate.googleapis.com/translate_a/single?${params}`

  try {
    const body = await new Promise<string>((resolve, reject) => {
      const req = https
        .get(url, { timeout: GOOGLE_TIMEOUT }, (r) => {
          const chunks: Buffer[] = []
          r.on('data', (c: Buffer) => chunks.push(c))
          r.on('end', () => resolve(Buffer.concat(chunks).toString()))
          r.on('error', reject)
        })
        .on('error', reject)
      req.on('timeout', () => req.destroy(new Error('timeout')))
    })

    const data = JSON.parse(body)
    const sentences = data?.[0]
    if (!Array.isArray(sentences)) {
      res.json({ translation: '' })
      return
    }
    const translation = sentences.map((s: any) => s?.[0] || '').join('')
    res.json({ translation })
  } catch {
    res.status(502).json({ translation: '' })
  }
}

function llmTranslate(
  text: string,
  apiUrl: string,
  apiKey: string,
  res: NextApiResponse,
  model?: string,
  systemPrompt?: string,
) {
  const url = new URL(apiUrl)
  const client = url.protocol === 'https:' ? https : http
  const payload = JSON.stringify({
    model: model || process.env.LLM_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt || DEFAULT_TRANSLATE_PROMPT },
      { role: 'user', content: text },
    ],
    max_tokens: TRANSLATE_MAX_TOKENS,
    temperature: 0.3,
    ...translatePayloadExtras(apiUrl),
  })

  const upstream = client.request(
    url,
    {
      method: 'POST',
      timeout: LLM_TIMEOUT,
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

  upstream.on('timeout', () => upstream.destroy(new Error('timeout')))
  upstream.on('error', () => res.status(502).end())
  upstream.write(payload)
  upstream.end()
}
