import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DOCS_DIR = resolve(PACKAGE_ROOT, "docs")

const DOCS = [
  { heading: "Effect Runtime", file: "runtime.md" },
  { heading: "React UI Patterns", file: "ui.md" },
  { heading: "Visual Design", file: "visual.md" },
  { heading: "Code Layout", file: "layout.md" },
  { heading: "Tooling", file: "tooling.md" },
] as const

const HEADER =
  "[LATTICE STACK]\n\n" +
  "Conventions for projects that use the lattice stack: TypeScript + React + Effect + Tailwind + Vite + Biome + Bun. " +
  "Apply when the current project actually uses these tools; otherwise treat as reference. " +
  "These conventions extend the bedrock principles with stack-specific bindings."

function loadContext(): string {
  const sections = DOCS.map(doc => {
    const path = resolve(DOCS_DIR, doc.file)
    const content = readFileSync(path, "utf8").trimEnd()
    return `\n\n## ${doc.heading}\n\n${content}`
  }).join("")
  return `${HEADER}${sections}\n`
}

let cached: string | undefined

export default function latticeStackExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", async () => {
    if (!cached) {
      cached = loadContext()
    }
    return {
      message: {
        customType: "lattice-stack:context",
        content: cached,
        display: false,
      },
    }
  })
}
