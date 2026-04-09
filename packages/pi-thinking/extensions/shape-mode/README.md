# Shape Mode Extension

Collaborative requirements shaping mode for clarifying **WHAT** to build before planning **HOW** to build it.

> Internal package naming now uses `shape-mode`.

## Features

- **Shape-only tools**: Restricts tools to `read`, `bash`, `grep`, `find`, `write`, `web_search`, and `question`
- **No source-code editing**: Blocks `edit` while shape mode is active
- **Question-driven workflow**: Instructs the agent to ask one question at a time using the `question` tool
- **Mandatory shape document**: Requires a document before allowing planning handoff
- **Document validation**: Checks frontmatter and required sections before allowing planning handoff
- **Open question tracking**: Parses `Open Questions` and `Resolved Questions` from the shape document
- **Session persistence**: Restores mode state, latest document, and question status on resume

## Commands

- `/shape` - If shape mode is off, enable it and begin shaping from the current session context; if it is on, toggle it off
- `/shape <context>` - Enable shape mode (if needed) and start shaping immediately with explicit context
- `Ctrl+Alt+B` - Toggle shape mode

## Usage

1. Use `/shape` to enable shape mode and begin shaping from the current session context, or enable shape mode up front with `--shape`
2. Ask the agent to explore an idea, clarify requirements, and compare approaches
3. The agent should research, ask one question at a time, and write the required shape document
4. The document must contain:
   - frontmatter with `date` and `topic`
   - `## Chosen Thing`
   - `## Users and Context`
   - `## Goals`
   - `## Non-Goals`
   - `## Constraints`
   - `## Success Criteria`
   - `## Candidate Shapes`
   - `## Chosen Shape`
   - `## Key Decisions`
   - `## Open Questions`
   - `## Next Step`
5. If open questions remain, shape mode keeps the conversation in clarification mode
6. When the document is valid and open questions are resolved, shape mode offers planning handoff

## How It Works

### Shape Mode
- Keeps the conversation focused on requirements and trade-offs
- Prevents source-code editing
- Allows repo inspection, external research, and shape document writing
- Tracks the latest shaping document for readiness and handoff

### Completion Rules
A shape is only ready for handoff when:
- a shape markdown file exists
- required frontmatter exists
- required sections exist
- no open questions remain in the document

### Handoff
When complete, shape mode offers:
- Review and refine
- Proceed to planning
- Ask more questions
- Done for now

Proceeding to planning pre-fills the planning command for the next step.
