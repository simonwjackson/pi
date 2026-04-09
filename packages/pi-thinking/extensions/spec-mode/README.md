# Spec Mode Extension

Read-only spec mode for safe code analysis.

## Features

- **Read-only tools**: Restricts available tools to read, bash, grep, find, ls, questionnaire
- **Bash allowlist**: Only read-only bash commands are allowed
- **Spec extraction**: Extracts numbered steps from `Spec:` sections
- **Progress tracking**: Widget shows completion status during execution
- **[DONE:n] markers**: Explicit step completion tracking
- **Session persistence**: State survives session resume
- **Handoff auto-compaction**: `/spec-handoff` enables session-scoped auto-compaction for the new execution session only, triggering early at roughly 85% context usage

## Commands

- `/spec` - If spec mode is off, enable it and begin spec generation from current session context; if it is on, toggle it off
- `/spec <request>` - Enable spec mode (if needed) and run a spec request immediately
- `/spec-handoff` - Execute the current spec in a new session
- `/todos` - Show current spec progress
- `Ctrl+Alt+P` - Toggle spec mode (shortcut)

## Usage

1. Enable spec mode with `/spec` or `--spec`
2. Ask the agent to analyze code and create an implementation spec
3. When available, the agent should read relevant files in `docs/briefs/` first and treat them as the primary spec input
4. The agent may optionally consult `docs/thinking/` for rationale/history, but those memos are secondary to the brief
5. The agent should output a numbered spec under a `Spec:` header:

```
Spec:
1. First step description
2. Second step description
3. Third step description
```

6. Choose "Execute the spec" when prompted
7. During execution, the agent marks steps complete with `[DONE:n]` tags
8. Progress widget shows completion status

## How It Works

### Spec Mode (Read-Only)
- Only read-only tools available
- Bash commands filtered through allowlist
- Agent creates an implementation spec without making changes
- Relevant `docs/briefs/*.md` files are the primary spec source when present
- Relevant `docs/thinking/*.md` files are optional supporting context only
- `/spec` is intentionally distinct from `/think` and `/shape`; it should consume a brief rather than recreate one

### Execution Mode
- Full tool access restored
- Agent executes one remaining step per turn and auto-continues until blocked or complete
- `[DONE:n]` markers track completion and cross items off in the widget
- If no step is marked complete, execution pauses and waits for user intervention
- Widget shows progress

### Command Allowlist

Safe commands (allowed):
- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- System info: `uname`, `whoami`, `date`, `uptime`

Blocked commands:
- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Editors: `vim`, `nano`, `code`
