// Copies MediaPipe's WASM runtime out of node_modules into public/wasm so it
// is served from our own origin (no CDN dependency during demos). Runs on
// `npm install` via the postinstall hook; public/wasm is gitignored.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const dest = join(here, '..', 'public', 'wasm')

mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log(`Copied MediaPipe WASM runtime -> ${dest}`)
