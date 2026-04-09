---
name: shaping
description: Shape requirements into a concise, plan-ready brief through collaborative dialogue before planning.
version: 1.0.0
---

# Shaping Workflow

Use this skill to define the chosen thing clearly enough that `/spec` can implement it from a concise brief.

## What This Skill Is For

Use this skill to shape **WHAT** should be built:
- the chosen thing
- who it is for
- goals and non-goals
- constraints
- success criteria
- candidate shapes
- the chosen shape
- key decisions
- open questions

## What This Skill Is NOT For

Do **not** use this skill for broad exploratory reasoning like:
- whether this initiative should exist at all
- philosophical or strategic reflection
- devil's-advocate challenge sessions
- mental-model analysis of ambiguous decisions

That belongs in `/think`.

If the user is still fundamentally deciding **whether** to pursue the idea, pause and say that `/think` is the better place for that reasoning. Then either:
1. switch to `/think`, or
2. continue here only after the user confirms the thing being shaped.

## Artifact Contract

- `/think` may optionally create a thinking memo at `docs/thinking/YYYY-MM-DD-<topic>-think.md`
- `/shape` must create a brief at `docs/briefs/YYYY-MM-DD-<topic>-brief.md`
- `/spec` should read the brief first and use thinking memos only as optional context

> **MANDATORY OUTPUT:** This skill MUST produce `docs/briefs/YYYY-MM-DD-<topic>-brief.md` using the `write` tool. The shaping session is not complete until that brief exists.

## Hard Constraints

- **NEVER CODE.** This phase defines and documents.
- **YOU MUST WRITE THE BRIEF.** Every shaping session ends with a brief file.
- You **MUST** use the `question` tool for ALL user questions.
- Ask **one question at a time**.
- **Permitted tools:** `read`, `grep`, `find`, `question`, `write`, `bash`.

## Pi Tool Semantics Mapping

- `Read` -> `read`
- `Grep` -> `grep`
- `Glob` -> `find`
- `AskUserQuestion` -> `question`
- `Write` -> `write`
- `Agent` -> inspect the repo directly with `find` + `grep` + `read`
- `WebSearch` / `WebFetch` -> use dedicated web tools if available; otherwise use `bash` + authoritative sources

## Core Shaping Principle

This is not an open-ended brainstorm.

You are shaping a **specific, chosen thing** into a plan-ready brief.

That means:
- reduce ambiguity
- surface trade-offs
- compare a small number of viable shapes
- pick one shape
- record the decisions and remaining unknowns

Avoid drifting into strategy theater, abstract ideation, or implementation planning.

## Required Outputs to Discover

By the end of shaping, the brief must contain clear answers for:

1. **Chosen Thing** — what exactly is being shaped?
2. **Users** — who is it for, and in what context?
3. **Goals** — what must this accomplish?
4. **Non-Goals** — what is explicitly out of scope?
5. **Constraints** — technical, product, time, policy, dependency, or UX constraints
6. **Success Criteria** — how do we know this is good enough?
7. **Candidate Shapes** — 2-3 plausible shapes, not a giant list
8. **Chosen Shape** — which shape is selected and why?
9. **Key Decisions** — decisions already made that planning should treat as inputs
10. **Open Questions** — only the unresolved items that still matter

## Workflow

### Phase 1: Establish the Thing Being Shaped

Start by making sure there is a concrete thing to shape.

Clarify:
- what the user wants to create or change
- what trigger/problem/user moment matters
- what would count as a successful outcome

If the user is still at the stage of asking whether this idea is worthwhile at all, do not spend the session on broad go/no-go reasoning. Redirect that reasoning to `/think`, then come back once the target is chosen.

### Phase 2: Lightweight Repository and Context Research

Before asking too many questions:
1. Inspect the repository for adjacent features, patterns, naming, and constraints.
2. Reuse existing conventions where possible.
3. If the topic involves external systems, libraries, APIs, or standards and you are uncertain, verify them with authoritative sources.

Research should support shaping decisions, not turn into implementation work.

### Phase 3: Shape Through Focused Questions

Use the `question` tool one question at a time.

Move through these areas in roughly this order:

#### 3.1 Users and Context
- Who is this for?
- What are they trying to do?
- In what moment or workflow does this matter?

#### 3.2 Goals and Non-Goals
- What must this achieve?
- What matters most if trade-offs appear?
- What is explicitly out of scope for this version?

#### 3.3 Constraints
- What constraints must shape the solution?
- Are there existing patterns, systems, policies, deadlines, or dependencies?

#### 3.4 Success Criteria
- What would make the user say “yes, this is right”?
- What are the must-have acceptance signals?

#### 3.5 Candidate Shapes
Generate **2-3 candidate shapes**.

A candidate shape is a product/UX/requirements form of the solution, not an implementation plan.

For each candidate shape, capture:
- short description
- who it serves best
- strengths
- weaknesses
- what trade-off it makes

#### 3.6 Chosen Shape
Use `question` to help the user choose a shape.

Then lock in:
- which shape was chosen
- why it was chosen over the others
- what was intentionally left out

### Phase 4: Write the Brief

Write the brief to:

`docs/briefs/YYYY-MM-DD-<topic>-brief.md`

Ensure `docs/briefs/` exists before writing.

Use this structure:

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
artifact: brief
---

# <Topic Title>

## Chosen Thing
[What is being built or changed?]

## Users and Context
[Who it is for and when they use it]

## Goals
- [Goal]
- [Goal]

## Non-Goals
- [Explicitly out of scope]

## Constraints
- [Constraint]
- [Constraint]

## Success Criteria
- [Criterion]
- [Criterion]

## Candidate Shapes
### Shape A
[Summary, strengths, weaknesses, trade-off]

### Shape B
[Summary, strengths, weaknesses, trade-off]

### Shape C
[Optional third shape]

## Chosen Shape
[Which shape was selected and why]

## Key Decisions
- [Decision]: [Rationale]
- [Decision]: [Rationale]

## Open Questions
- [Only unresolved items that still matter to planning]

## Next Step
- Run `/spec` using this brief as the primary input
- Optionally consult related `docs/thinking/*.md` memos for rationale
```

## Pre-Handoff Checklist

Before offering handoff, verify all of the following:

- [ ] Brief file exists at `docs/briefs/YYYY-MM-DD-<topic>-brief.md`
- [ ] Frontmatter includes `date` and `topic`
- [ ] The brief covers: chosen thing, users/context, goals, non-goals, constraints, success criteria, candidate shapes, chosen shape, key decisions, open questions
- [ ] Candidate shapes were actually compared
- [ ] A chosen shape is explicitly named
- [ ] Open questions are either resolved or intentionally left for planning

If any item is missing, fix the brief before handoff.

## Handoff

When the brief is ready, use `question` to ask:

**"Brief captured. What would you like to do next?"**

Options:
1. **Review and refine**
2. **Proceed to planning**
3. **Ask more questions**
4. **Done for now**

If the user chooses **Ask more questions**, continue shaping one question at a time.

If the user chooses **Proceed to planning**, the brief is the primary input for `/spec`.

## Important Guidelines

- Stay focused on **definition**, not implementation
- Ask **one question at a time**
- Prefer **specific choices** over abstract discussion
- Generate **2-3 candidate shapes**, not a sprawling idea dump
- Use **YAGNI**: shape the smallest version that solves the stated problem
- Keep the brief concise and useful for planning

## Anti-Patterns to Avoid

| Anti-Pattern | Better Approach |
|--------------|-----------------|
| "Should we do this at all?" debates | Redirect to `/think`, then return once the thing is chosen |
| Long abstract ideation | Shape a specific thing with specific constraints |
| Jumping into implementation | Stay at requirements, UX, scope, and decision level |
| Asking many questions at once | Ask one at a time with the `question` tool |
| Listing many possible options | Compare 2-3 serious candidate shapes |
| Leaving the chosen shape implicit | Name it explicitly and record why |
| Writing a vague plan-adjacent document | Write a crisp brief with concrete decisions |

## Integration with Planning

Shaping answers **WHAT** to build:
- what the thing is
- who it is for
- what success looks like
- which shape was chosen
- which decisions are already made
- what remains open

Planning answers **HOW** to build it.

When this brief exists, `/spec` should use it as the primary input.
