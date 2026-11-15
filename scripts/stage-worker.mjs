import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('dist/server', { recursive: true })
cpSync('worker/index.js', 'dist/server/index.js')
cpSync('worker/wrangler.json', 'dist/server/wrangler.json')
mkdirSync('dist/.openai', { recursive: true })
cpSync('.openai/hosting.json', 'dist/.openai/hosting.json')
cpSync('drizzle', 'dist/.openai/drizzle', { recursive: true })
