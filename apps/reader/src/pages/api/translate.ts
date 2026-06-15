import type { NextApiRequest, NextApiResponse } from 'next'
import https from 'https'
import http from 'http'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') return res.status(405).end()

  const { text, method, apiUrl, apiKey } = req.body
  if (!text) return res.status(400).end()

  if (method === 'llm' && apiUrl && apiKey) {
    return llmTranslate(text, apiUrl, apiKey, res)
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
      https
        .get(url, (r) => {
          const chunks: Buffer[] = []
          r.on('data', (c: Buffer) => chunks.push(c))
          r.on('end', () => resolve(Buffer.concat(chunks).toString()))
          r.on('error', reject)
        })
        .on('error', reject)
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
) {
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
