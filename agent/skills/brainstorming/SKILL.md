---
name: brainstorming
description: Explore requirements and approaches through collaborative dialogue before planning. Use when requirements are ambiguous, under-specified, or have multiple valid interpretations.
version: 1.0.0
---

# Brainstorming

This skill drives brainstorming sessions that clarify **WHAT** to build before diving into **HOW** to build it. It precedes planning.

Use today's date from system context when dating brainstorm documents.

> **MANDATORY OUTPUT:** This skill MUST produce a file at `docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md` using the `write` tool. The brainstorm is NOT complete until this file exists. Do NOT present the Phase 4 handoff question until the file has been written. If you reach the end of the dialogue without having written the file, STOP and write it before doing anything else.

## Hard Constraints

- **NEVER CODE.** This phase explores and documents decisions only.
- **YOU MUST WRITE THE BRAINSTORM FILE.** Every brainstorm session produces a `docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md` file. No exceptions.
- You **MUST** use the `question` tool for ALL questions. Never ask questions as plain text. Ask one question at a time.
- **Permitted tools:** `read`, `grep`, `find`, `question`, `write`, `bash` (for web research and `git clone --depth 1` into `/tmp/`).

## Pi Tool Semantics Mapping (Claude -> Pi)

- `Read` -> `read`
- `Grep` -> `grep`
- `Glob` -> `find`
- `AskUserQuestion` -> `question`
- `Write` -> `write`
- `Agent` -> no direct equivalent; do repository analysis directly using `find` + `grep` + `read`
- `WebSearch` / `WebFetch` -> use dedicated web tools if installed; otherwise use `bash` + `curl` for authoritative sources

## When to Use This Skill

Brainstorming is valuable when:
- Requirements are unclear or ambiguous
- Multiple approaches could solve the problem
- Trade-offs need to be explored with the user
- The user hasn't fully articulated what they want
- The feature scope needs refinement

Brainstorming can be skipped when:
- Requirements are explicit and detailed
- The user knows exactly what they want
- The task is a straightforward bug fix or well-defined change

## Execution Flow

### Phase 0: Assess Requirement Clarity

Before diving into questions, assess whether brainstorming is needed.

**Signals that requirements are clear:**
- User provided specific acceptance criteria
- User referenced existing patterns to follow
- User described exact behavior expected
- Scope is constrained and well-defined

**Signals that brainstorming is needed:**
- User used vague terms ("make it better", "add something like")
- Multiple reasonable interpretations exist
- Trade-offs haven't been discussed
- User seems unsure about the approach

**If requirements are already clear:**
Use `question` to suggest: "Your requirements seem detailed enough to proceed directly to planning. Should I proceed to planning, or would you like to explore the idea further?"

### Phase 1: Understand the Idea

#### 1.1 Repository Research

Do a lightweight repository scan yourself using `find`, `grep`, and `read`:

1. Find likely related files/directories.
2. Grep for relevant symbols/patterns.
3. Read key files to identify conventions and existing patterns.
4. Summarize what should be reused.

#### 1.2 Collaborative Dialogue

Use `question` to ask questions **one at a time**.

**Question Techniques:**

1. **Prefer multiple choice when natural options exist**
   - Good: "Should the notification be: (a) email only, (b) in-app only, or (c) both?"
   - Avoid: "How should users be notified?"

2. **Start broad, then narrow**
   - First: What is the core purpose?
   - Then: Who are the users?
   - Finally: What constraints exist?

3. **Validate assumptions explicitly**
   - "I'm assuming users will be logged in. Is that correct?"

4. **Ask about success criteria early**
   - "How will you know this feature is working well?"

**Key Topics to Explore:**

| Topic | Example Questions |
|-------|-------------------|
| Purpose | What problem does this solve? What's the motivation? |
| Users | Who uses this? What's their context? |
| Constraints | Any technical limitations? Timeline? Dependencies? |
| Success | How will you measure success? What's the happy path? |
| Edge Cases | What shouldn't happen? Any error states to consider? |
| Existing Patterns | Are there similar features in the codebase to follow? |

**Exit Condition:** Continue until the idea is clear OR user says "proceed" or "let's move on."

### Phase 2: Research & Explore Approaches

#### External Research (Mandatory when uncertain)

When the discussion involves libraries, APIs, frameworks, protocols, or any topic where authoritative information exists online — you MUST go get it rather than relying on training data.

Apply these strategies in order of cost:

**a. Preferred web tools (if installed):** Use `web_search` and `web_fetch`.

**b. Pi fallback (always available):** Use `bash` with `curl` against authoritative URLs (official docs, READMEs, release notes). Quote the URLs you used.

**c. Repo exploration:** Clone into `/tmp/` and inspect with `find`/`grep`/`read`:

```bash
git clone --depth 1 <repo-url> /tmp/<repo-name>
```

ALWAYS use `--depth 1`. ALWAYS clone into `/tmp/`.

**Trigger conditions** (if ANY apply, you MUST research):
- You are uncertain about a library's API, behavior, or compatibility
- The user references a tool/project you have limited knowledge of
- You are about to recommend an approach that depends on external behavior you haven't verified
- The topic involves version-specific features, recent releases, or evolving standards
- You catch yourself saying "I believe", "typically", or "should work" about external systems

**If web research is not possible:** explicitly tell the user what could not be verified, then ask via `question` whether to proceed with best-effort assumptions.

#### Propose Approaches

Propose **2-3 concrete approaches** based on research and conversation.

For each approach, provide:
- Brief description (2-3 sentences)
- Pros and cons
- When it's best suited

Lead with your recommendation and explain why. Apply YAGNI — prefer simpler solutions.

Use `question` to ask which approach the user prefers.

### Phase 3: Capture the Design

Write a brainstorm document to `docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md` using `write`.

Ensure `docs/brainstorms/` directory exists before writing.

**Design Doc Structure:**

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
---

# <Topic Title>

## What We're Building
[Concise description—1-2 paragraphs max]

## Why This Approach
[Brief explanation of approaches considered and why this one was chosen]

## Key Decisions
- [Decision 1]: [Rationale]
- [Decision 2]: [Rationale]

## Open Questions
- [Any unresolved questions for the planning phase]

## Next Steps
→ `/forgerie:spec` for implementation details
```

**IMPORTANT:** Before proceeding to Phase 4, check if there are any Open Questions listed in the brainstorm document. If there are open questions, you MUST resolve each one by asking the user via `question` before offering to proceed. Move resolved questions to a "Resolved Questions" section.

### Phase 3.5: Pre-Handoff Checklist (MANDATORY)

**STOP. Before proceeding to Phase 4, verify ALL of the following:**

- [ ] **Brainstorm file written** — `docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md` exists (you used the `write` tool to create it)
- [ ] **File has frontmatter** — Contains `date:` and `topic:` fields
- [ ] **Key sections present** — File contains: What We're Building, Why This Approach, Key Decisions, Open Questions, Next Steps
- [ ] **Open questions resolved** — All open questions have been asked via `question` and resolved

**If the brainstorm file has NOT been written, go back to Phase 3 and write it NOW.** Do not proceed to Phase 4.

### Phase 4: Handoff

Use `question` to present next steps:

**Question:** "Brainstorm captured. What would you like to do next?"

**Options:**
1. **Review and refine** — Improve the document through structured review
2. **Proceed to planning** — Run `/forgerie:spec` (will auto-detect this brainstorm)
3. **Ask more questions** — I have more questions to clarify before moving on
4. **Done for now** — Return later

**If user selects "Ask more questions":** Return to Phase 1.2 and continue asking one question at a time.

**If user selects "Review and refine":**

Load and apply the `document-review` skill to the brainstorm document.

When document review is complete, use `question` to present:
1. **Move to planning** — Continue to `/forgerie:spec` with this document
2. **Done for now** — Brainstorming complete. To start planning later: `/forgerie:spec`

## Output Summary

When complete, display:

```text
Brainstorm complete!

Document: docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md

Key decisions:
- [Decision 1]
- [Decision 2]

Next: Run `/forgerie:spec` when ready to implement.
```

## Important Guidelines

- **Stay focused on WHAT, not HOW** — Implementation details belong in the plan
- **Ask one question at a time** — Don't overwhelm
- **Apply YAGNI** — Prefer simpler approaches
- **Keep outputs concise** — 200-300 words per section max

## YAGNI Principles

During brainstorming, actively resist complexity:

- **Don't design for hypothetical future requirements**
- **Choose the simplest approach that solves the stated problem**
- **Prefer boring, proven patterns over clever solutions**
- **Ask "Do we really need this?" when complexity emerges**
- **Defer decisions that don't need to be made now**

## Incremental Validation

Keep sections short—200-300 words maximum. After each section of output, pause to validate understanding:

- "Does this match what you had in mind?"
- "Any adjustments before we continue?"
- "Is this the direction you want to go?"

## Anti-Patterns to Avoid

| Anti-Pattern | Better Approach |
|--------------|-----------------|
| Asking 5 questions at once | Ask one at a time |
| Jumping to implementation details | Stay focused on WHAT, not HOW |
| Proposing overly complex solutions | Start simple, add complexity only if needed |
| Ignoring existing codebase patterns | Research what exists first |
| Making assumptions without validating | State assumptions explicitly and confirm |
| Creating lengthy design documents | Keep it concise—details go in the plan |

## Integration with Planning

Brainstorming answers **WHAT** to build:
- Requirements and acceptance criteria
- Chosen approach and rationale
- Key decisions and trade-offs

Planning answers **HOW** to build it:
- Implementation steps and file changes
- Technical details and code patterns
- Testing strategy and verification

When brainstorm output exists, planning should detect it and use it as input, skipping its own idea-refinement phase.

NEVER CODE! Just explore and document decisions.
