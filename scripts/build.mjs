import { copyFile, mkdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
await mkdir(new URL('lib/', root), { recursive: true })
await copyFile(new URL('src/index.js', root), new URL('lib/index.js', root))
await copyFile(new URL('src/history.js', root), new URL('lib/history.js', root))
await copyFile(new URL('src/client/index.js', root), new URL('lib/client.js', root))
