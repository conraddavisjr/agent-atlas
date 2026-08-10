// Receives toDataURL screenshots from the page and writes them to disk.
// The page cannot write files; this is the shortest bridge that does not need
// a headless browser.
//
// POST /shot   body: { name: "high--hub-establishing", dataUrl: "data:image/png;base64,..." }
// POST /json   body: { name: "whatever", data: <any> }   -> writes <name>.json
// GET  /ping   -> "ok"
//
// Writes under OUT (argv[3] or ./shots). Replies with the byte count so the
// caller can tell a real PNG from an empty one without reading the file.

import { createServer } from 'node:http'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PORT = Number(process.argv[2] ?? 7345)
const OUT = resolve(process.argv[3] ?? './shots')
mkdirSync(OUT, { recursive: true })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const safe = (s) => String(s ?? 'unnamed').replace(/[^A-Za-z0-9._-]/g, '_')

createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }
  if (req.method === 'GET') {
    // The capture driver, so a page reload costs one fetch instead of pasting
    // two hundred lines of JavaScript through a browser tool again.
    if (req.url.startsWith('/harness.js')) {
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/javascript' })
      return res.end(readFileSync(new URL('./harness.js', import.meta.url), 'utf8'))
    }
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain' })
    return res.end('ok ' + OUT)
  }

  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (req.url.startsWith('/json')) {
        const file = join(OUT, safe(body.name) + '.json')
        writeFileSync(file, JSON.stringify(body.data, null, 2))
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: true, file }))
      }
      const url = String(body.dataUrl ?? '')
      const comma = url.indexOf(',')
      if (!url.startsWith('data:image/png;base64,') || comma < 0) {
        throw new Error('not a base64 png data url, got ' + url.slice(0, 40))
      }
      const buf = Buffer.from(url.slice(comma + 1), 'base64')
      const file = join(OUT, safe(body.name) + '.png')
      writeFileSync(file, buf)
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, file, bytes: buf.length }))
      console.log(`${buf.length} bytes -> ${file}`)
    } catch (err) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String(err) }))
      console.error('FAILED', String(err))
    }
  })
}).listen(PORT, '127.0.0.1', () => console.log(`shotsink on :${PORT} -> ${OUT}`))
