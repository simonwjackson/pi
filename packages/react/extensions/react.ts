import { homedir } from "node:os"
import { extname, resolve } from "node:path"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

const SKILL_NAME = "react"
const PACKAGE_ROOT = ".pi/packages/react"
const SKILL_PATH = `${PACKAGE_ROOT}/skills/${SKILL_NAME}/SKILL.md`
const GLOBAL_SKILL_PATH = resolve(homedir(), SKILL_PATH)
const REACT_EXTENSIONS = new Set([".tsx", ".jsx"])

type ReadInput = {
  path?: string
}

type WriteInput = {
  path?: string
}

type EditOperation = {
  oldText?: string
  newText?: string
}

type EditInput = {
  path?: string
  edits?: EditOperation[]
}

function stripAtPrefix(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path
}

function normalizePath(cwd: string, maybePath: string): string {
  return resolve(cwd, stripAtPrefix(maybePath))
}

function isReactComponentPath(
  cwd: string,
  maybePath: string | undefined,
): boolean {
  if (!maybePath) return false

  return REACT_EXTENSIONS.has(extname(normalizePath(cwd, maybePath)))
}

function isSkillPath(cwd: string, maybePath: string | undefined): boolean {
  if (!maybePath) return false

  const path = normalizePath(cwd, maybePath)
  return path === resolve(cwd, SKILL_PATH) || path === GLOBAL_SKILL_PATH
}

function buildBlockReason(): string {
  return [
    `Auto-loading /skill:${SKILL_NAME} because this operation targets a JSX/TSX file.`,
    `Once the skill is in session context, retry with the React architecture rules applied.`,
  ].join(" ")
}

export default function reactExtension(pi: ExtensionAPI) {
  let skillLoadedForSession = false
  let skillLoadQueued = false

  pi.on("session_start", async () => {
    skillLoadedForSession = false
    skillLoadQueued = false
  })

  pi.on("input", async event => {
    if (event.text.trim().startsWith(`/skill:${SKILL_NAME}`)) {
      skillLoadedForSession = true
      skillLoadQueued = false
    }

    return { action: "continue" as const }
  })

  pi.on("tool_call", async (event, ctx) => {
    const queueSkillLoad = () => {
      if (skillLoadQueued || skillLoadedForSession) {
        return
      }

      skillLoadQueued = true
      pi.sendUserMessage(`/skill:${SKILL_NAME}`, { deliverAs: "steer" })

      if (ctx.hasUI) {
        ctx.ui.notify(`Auto-loading /skill:${SKILL_NAME} for JSX/TSX work`, "info")
      }
    }

    if (event.toolName === "read") {
      const input = event.input as ReadInput
      if (isSkillPath(ctx.cwd, input.path)) {
        skillLoadedForSession = true
        skillLoadQueued = false
        return
      }
      if (!skillLoadedForSession && isReactComponentPath(ctx.cwd, input.path)) {
        queueSkillLoad()
        return { block: true, reason: buildBlockReason() }
      }
      return
    }

    if (skillLoadedForSession) {
      return
    }

    if (event.toolName !== "write" && event.toolName !== "edit") {
      return
    }

    if (event.toolName === "write") {
      const input = event.input as WriteInput
      if (isReactComponentPath(ctx.cwd, input.path)) {
        queueSkillLoad()
        return { block: true, reason: buildBlockReason() }
      }
      return
    }

    const input = event.input as EditInput
    if (
      isReactComponentPath(ctx.cwd, input.path) &&
      (input.edits?.length ?? 0) > 0
    ) {
      queueSkillLoad()
      return { block: true, reason: buildBlockReason() }
    }
  })
}
