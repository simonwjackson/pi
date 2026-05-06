import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DOCS_DIR = resolve(PACKAGE_ROOT, "docs")

const DOCS = [
  { heading: "Philosophy", file: "philosophy.md" },
  { heading: "Standards", file: "standards.md" },
  { heading: "Style Guide", file: "style-guide.md" },
] as const

const HEADER =
  "[BEDROCK PRINCIPLES]\n\n" +
  "Cross-project engineering principles. They apply to every session in every project. " +
  "Project-specific stack rules, paths, and tooling commands live elsewhere and may extend or instantiate these."

function loadContext(): string {
  const sections = DOCS.map(doc => {
    const path = resolve(DOCS_DIR, doc.file)
    const content = readFileSync(path, "utf8").trimEnd()
    return `\n\n## ${doc.heading}\n\n${content}`
  }).join("")
  return `${HEADER}${sections}\n`
}

let cached: string | undefined

export default function bedrockPrincipalsExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", async () => {
    if (!cached) {
      cached = loadContext()
    }
    return {
      message: {
        customType: "bedrock-principals:context",
        content: cached,
        display: false,
      },
    }
  })
}
