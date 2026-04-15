import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Build-time list of all `*left*.png` mockups for the landing marquee. */
function leftMockupsVirtualModule(): Plugin {
  const resolvedId = '\0virtual:left-mockups'
  return {
    name: 'left-mockups-virtual',
    resolveId(id) {
      if (id === 'virtual:left-mockups') return resolvedId
      return undefined
    },
    load(id) {
      if (id !== resolvedId) return null
      const projectMockDir = path.join(__dirname, 'mockups')
      const publicMockDir = path.join(__dirname, 'public/mockups')
      let files: Array<{ fileName: string; sourcePath: string }> = []
      try {
        const fromProject = fs.existsSync(projectMockDir)
          ? fs
              .readdirSync(projectMockDir)
              .filter((f) => f.toLowerCase().endsWith('.png') && f.toLowerCase().includes('left'))
              .map((f) => ({ fileName: f, sourcePath: `/mockups/${f}` }))
          : []
        const fromPublic = fs.existsSync(publicMockDir)
          ? fs
              .readdirSync(publicMockDir)
              .filter((f) => f.toLowerCase().endsWith('.png') && f.toLowerCase().includes('left'))
              .map((f) => ({ fileName: f, sourcePath: `/mockups/${f}` }))
          : []

        // Prefer project mockups when both folders contain the same filename.
        const deduped = new Map<string, { fileName: string; sourcePath: string }>()
        for (const item of [...fromPublic, ...fromProject]) {
          deduped.set(item.fileName.toLowerCase(), item)
        }
        files = [...deduped.values()].sort((a, b) =>
          a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base' }),
        )
      } catch {
        files = []
      }
      const imports = files
        .map((file, index) => `import mock${index} from ${JSON.stringify(file.sourcePath)}`)
        .join('\n')
      const exports = files
        .map((file, index) => `{ image: mock${index}, fileName: ${JSON.stringify(file.fileName)} }`)
        .join(',\n')
      return `${imports}\n\nexport default [\n${exports}\n]`
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    // Listen on all interfaces so you can open http://<LAN-IP>:5173/ on a phone (same Wi‑Fi).
    host: true,
  },
  preview: {
    host: true,
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    leftMockupsVirtualModule(),
  ],
})
