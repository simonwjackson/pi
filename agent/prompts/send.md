---
description: Send text docs from the last turn to phone via Tailscale
---
Execute a send-to-device workflow.

Defaults:
- Files: Markdown documents (`.md`, `.mdx`, `.markdown`) created **or modified** in the last turn.
- Target device: `simons-z-fold7` (phone).

Argument handling (`$ARGUMENTS`):
- If explicit file path(s) are provided, send those instead of last-turn inference.
- If a target device is provided, use it instead of `simons-z-fold7`.
- If arguments are ambiguous, ask one concise clarifying question.

Rules:
1. Determine target device from args; otherwise use `simons-z-fold7`.
2. Determine files:
   - Prefer explicit paths from args.
   - Otherwise infer Markdown files (`.md`, `.mdx`, `.markdown`) created or modified in the immediately previous turn.
3. Only send Markdown files (`.md`, `.mdx`, `.markdown`).
4. Verify each file exists and is Markdown before sending.
5. Send each file with bash in PTY mode:
   - `sudo tailscale file cp <file> <target>:`
6. After sending, confirm target, filename, and byte size for each file.
7. Keep the final report concise.
