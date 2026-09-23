import express from 'express'
import dotenv from 'dotenv'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { inflateRawSync, inflateSync } from 'node:zlib'

dotenv.config({ path: new URL('./.env', import.meta.url) })

const app = express()
const port = process.env.PORT || 3004
const pdfTextCache = new Map()

app.use(express.json({ limit: '12mb' }))
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin

  if (requestOrigin) {
    try {
      const { hostname } = new URL(requestOrigin)
      const isAllowedHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname)
      const isPrivateNetworkHost = hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')

      if (isAllowedHost || isPrivateNetworkHost) {
        res.header('Access-Control-Allow-Origin', requestOrigin)
      }
    } catch {
      // Ignore malformed origins and continue without CORS for them.
    }
  }

  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204)
  }

  next()
})

const createLocalReply = (input) => {
  const text = input.trim()
  const lower = text.toLowerCase()

  if (!text) {
    return 'Ask me anything about your studies and I will help you break it down clearly.'
  }

  if (lower.includes('summary') || lower.includes('summarize')) {
    return 'Use this structure: 1) main idea, 2) 3 supporting points, 3) conclusion. Then rewrite it in 3 short bullet points and a 2-sentence summary.'
  }

  if (lower.includes('explain') || lower.includes('what is') || lower.includes('why')) {
    return 'Start with the definition, then explain the key idea, give one example, and finish with why it matters. I can turn that into a student-friendly explanation.'
  }

  if (lower.includes('math') || lower.includes('equation') || lower.includes('calculate') || lower.includes('solve')) {
    return 'For math: write the formula, substitute the values, simplify step by step, and check the final answer. If needed, I can walk you through each step.'
  }

  if (lower.includes('physics')) {
    return 'Physics is about relationships between force, motion, energy, and matter. Try to connect formulas to real-world examples and explain the cause-and-effect.'
  }

  if (lower.includes('history')) {
    return 'History is easier to learn by focusing on cause, event, consequence, and significance. Link dates to bigger themes and compare different perspectives.'
  }

  if (lower.includes('essay') || lower.includes('write') || lower.includes('paragraph')) {
    return 'A strong essay has a clear thesis, 2-3 supporting points, evidence, and a conclusion. I can help you plan, draft, or refine it.'
  }

  if (lower.includes('hello') || lower.includes('hi')) {
    return 'Hello! I am your study tutor. Ask me to summarize, explain, quiz you, or help with a topic.'
  }

  return 'A strong student approach is: identify the concept, list the important facts, explain the process, and give a simple example. I can help you do that step by step.'
}

const extractPdfText = (pdfBase64) => {
  try {
    const pdf = Buffer.from(pdfBase64, 'base64')
    const source = pdf.toString('latin1')
    const streams = []
    const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g
    let match

    while ((match = streamPattern.exec(source))) {
      const raw = Buffer.from(match[1], 'latin1')
      let decoded = raw

      try {
        decoded = inflateRawSync(raw)
      } catch {
        try {
          decoded = inflateSync(raw)
        } catch {
          decoded = raw
        }
      }

      streams.push(decoded.toString('latin1'))
    }

    const text = streams
      .join('\n')
      .replace(/\((?:\\.|[^)])*\)\s*Tj/g, (value) => value.slice(1, value.lastIndexOf(')')))
      .replace(/\[(.*?)\]\s*TJ/gs, '$1')
      .replace(/\\([()\\])/g, '$1')
      .replace(/[^\x20-\x7E\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return text.slice(0, 6000)
  } catch {
    return ''
  }
}

const getPdfText = (pdfBase64) => {
  const cacheKey = createHash('sha1').update(pdfBase64).digest('hex')
  if (!pdfTextCache.has(cacheKey)) {
    pdfTextCache.set(cacheKey, extractPdfText(pdfBase64))
  }
  return pdfTextCache.get(cacheKey)
}

app.post('/api/chat', async (req, res) => {
  const { message, dashboardContext } = req.body
  const files = Array.isArray(req.body.files) ? req.body.files : []
  const conversationHistory = Array.isArray(req.body.conversationHistory)
    ? req.body.conversationHistory.slice(-12)
    : []

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required.' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
  const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:3b'
  const fileContext = files
    .filter((file) => file && file.name && (file.text || file.pdfBase64))
    .slice(0, 10)
    .map((file) => {
      const text = file.text || getPdfText(file.pdfBase64)
      return `FILE: ${file.name}\n${text || 'This file could not be converted to readable text.'}`
    })
    .join('\n\n')
  const prompt = [
    'You are a student-focused academic tutor. Answer in clear, helpful language tailored to school study. Use short structured explanations, step-by-step reasoning, examples, and study-friendly formatting.',
    'Your goal is to help students understand concepts, summarize notes, explain assignments, and improve learning. Be precise, encouraging, and educational.',
    'For mathematics, format inline equations with single dollar signs like $E=mc^2$ and standalone equations with double dollar signs like $$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$. Do not use \\( \\), \\[ \\], or plain square brackets as math delimiters. Use standard LaTeX and never leave equations as ambiguous plain text.',
    'Remember the conversation history and answer the latest question in context. Do not repeat information the student already understands. If the student asks for more detail, continue from your previous explanation.',
    'If file content is provided, use it when relevant and clearly say if the answer is not in the uploaded material.',
    'Use the dashboard context below as the student\'s current working environment and study setup when relevant.',
    dashboardContext ? `Dashboard context:\n\n${dashboardContext}` : 'No dashboard context is available.',
    fileContext ? `Relevant student file content:\n\n${fileContext}` : 'No readable file contents have been dropped yet.',
    conversationHistory.length > 0
      ? `Recent conversation:\n\n${conversationHistory.map((item) => `${item.role === 'user' ? 'Student' : 'Tutor'}: ${item.text}`).join('\n\n')}`
      : 'No previous conversation is available.',
    `Student question: ${message}`,
  ].join('\n\n')

  if (apiKey && apiKey !== 'your_gemini_api_key_here') {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 512,
            },
          }),
        },
      )

      if (response.ok) {
        const data = await response.json()
        const answer =
          data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('') ||
          'No answer returned by Gemini.'

        return res.json({ reply: answer.trim(), mode: 'gemini' })
      }

      const errorText = await response.text()
      console.error(`Gemini request rejected (${response.status}): ${errorText.slice(0, 500)}`)
    } catch (error) {
      console.error('Gemini request failed:', error)
    }
  }

  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ollamaModel,
        prompt,
        stream: false,
        keep_alive: -1,
        options: {
          num_ctx: 2048,
          num_predict: 128,
          temperature: 0.3,
        },
      }),
    })

    if (response.ok) {
      const data = await response.json()
      if (data.response) {
        return res.json({ reply: data.response.trim(), mode: 'ollama' })
      }
    }
  } catch (error) {
    console.log('Ollama is not available; using the local offline tutor fallback.')
  }

  return res.json({
    reply: createLocalReply(message),
    mode: 'offline',
  })
})

const distPath = fileURLToPath(new URL('./dist', import.meta.url))
app.use(express.static(distPath))
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(fileURLToPath(new URL('./dist/index.html', import.meta.url)))
  }

  return next()
})

app.listen(port, '0.0.0.0', () => {
  console.log(`Study assistant running on http://localhost:${port}`)
  console.log(`Network access enabled on http://0.0.0.0:${port}`)
})
