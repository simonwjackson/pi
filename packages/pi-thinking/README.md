# @simonwjackson/pi-thinking

A local Pi package for guided thinking and requirements exploration.

## Source of truth

`packages/pi-thinking` is the active source of truth for these workflows.

- `package.json` exposes the package's `extensions`, `skills`, and `prompts` through the `pi` manifest.
- `agent/settings.json` currently loads this package via `../packages/pi-thinking`, which resolves to `/home/simonwjackson/.pi/packages/pi-thinking`.
- Legacy copies under `agent/` are not the active implementation and should not be changed unless they are reintroduced and explicitly wired back in.

## Artifact contract

The package is moving to a three-artifact workflow:

- `/think` may optionally save a **thinking memo** to `docs/thinking/YYYY-MM-DD-<topic>-think.md`
- `/shape` must produce a **brief** at `docs/briefs/YYYY-MM-DD-<topic>-brief.md`
- `/spec` should treat `docs/briefs/*.md` as the primary input and `docs/thinking/*.md` as optional secondary context/rationale

This makes the pipeline intentionally asymmetric:

1. `/think` explores reasoning and can stand alone
2. `/shape` defines the chosen thing in a plan-ready brief
3. `/spec` implements from the brief, consulting thinking memos only when useful

## Naming

The package now uses shape-aligned internal names as well as user-facing names:

- **Primary command:** `/shape`
- **Internal package paths:**
  - `extensions/shape-mode/`
  - `skills/shaping/`

## Guided pipeline

The package now supports two ways to enter the workflow:

### Guided entrypoint: `/flow`
Use `/flow` when you want the full end-to-end pipeline managed for you.

`/flow` is the guided path through:
1. `/think`
2. `/shape`
3. `/spec`

Behavior:
- `/flow <topic>` starts the pipeline with explicit input
- `/flow` starts from current session context when possible, or prompts for a topic if needed
- running `/flow` while active offers stage-aware actions such as continue, pause, stop, or restart
- flow keeps lightweight state across session resume/switch so the current stage, topic, memo path, and brief path can be recovered

### Direct entrypoints: `/think`, `/shape`, `/spec`
Use the stage commands when you want to jump directly into a specific stage without the guided handoff behavior.

- `/think` = direct entry into reasoning
- `/shape` = direct entry into shaping/briefing
- `/spec` = direct entry into implementation spec generation

The stage commands remain fully available even though `/flow` is now the preferred guided path.

## Three-stage workflow

Use the package as an intentionally non-overlapping pipeline:

### 1. `/think` — reasoning
Use `/think` when the user needs help thinking, not building.

Use it for:
- strategy and philosophy
- decision-making
- challenging assumptions
- trade-off analysis
- devil's-advocate / stress-testing
- clarifying what matters before committing to a shape

Output:
- optional thinking memo in `docs/thinking/`
- not a brief
- not an implementation plan

### 2. `/shape` — definition and briefing
Use `/shape` when the thing is chosen and now needs to be clearly defined.

Use it for:
- identifying users and context
- defining goals and non-goals
- capturing constraints and success criteria
- comparing 2-3 candidate shapes
- choosing one shape
- writing a plan-ready brief

Output:
- required brief in `docs/briefs/`
- may optionally consult `docs/thinking/` for rationale/history


### 3. `/spec` — implementation spec
Use `/spec` after shaping is complete.

Use it for:
- reading the brief
- breaking implementation into steps
- identifying file changes, risks, tests, and validation work
- producing an execution-ready plan

Input priority:
1. `docs/briefs/*.md`
2. direct user request
3. `docs/thinking/*.md` only as optional supporting rationale/history

## Directory conventions

```text
docs/
├── thinking/
│   └── YYYY-MM-DD-<topic>-think.md
└── briefs/
    └── YYYY-MM-DD-<topic>-brief.md
```

Conventions:
- thinking memos are optional and reasoning-oriented
- briefs are required for the full shape → plan workflow
- `/spec` should consume briefs first and should not rely on old `docs/brainstorms/` documents

## Examples

### Example: pure reasoning
```text
/think Should I leave the UI mostly boring and predictable, or make it more opinionated and distinctive?
```

Possible result:
- discussion only, or
- optional memo saved to `docs/thinking/YYYY-MM-DD-ui-strategy-think.md`

### Example: shape from direct user input
```text
/shape Add a lightweight saved-views feature for the dashboard
```

Expected result:
- shaping conversation
- brief written to `docs/briefs/YYYY-MM-DD-saved-views-brief.md`
- ready to hand off to `/spec`

### Example: shape from current session context
```text
/shape
```

Expected result:
- if shape mode is off, it turns on and shaping begins from the current session context
- if shape mode is already on, it turns off

### Example: shape using prior thinking as context
```text
/think What trade-offs matter most for saved views in the dashboard?
/shape Add a lightweight saved-views feature for the dashboard
```

Expected result:
- `/shape` can optionally use the relevant memo in `docs/thinking/`
- `/shape` still works even if no memo exists
- brief is still the main artifact handed to `/spec`

### Example: implementation planning
```text
/spec Implement the saved-views brief
```

Expected behavior:
- `/spec` reads the brief in `docs/briefs/` first
- `/spec` may optionally consult `docs/thinking/` for rationale/history
- `/spec` outputs an implementation spec rather than redoing `/think` or `/shape`

## Included

### Extensions
- `flow-mode` — `/flow` guided think → shape → spec pipeline
- `think-mode` — `/think` guided thinking-partner mode
- `shape-mode` — `/shape` requirements shaping mode
- `spec-mode` — `/spec` implementation spec mode
- `question` — interactive single-question tool used by shaping
- `web-search` — Brave + Serper web search tool

### Skills
- `thinking-partner`
- `shaping` — the shaping skill backing `/shape` and available via `/skill:shaping`
- `web-search`

### Prompt templates
- `/web` — run a web search prompt

## Local install

For local path usage, install the package dependencies once:

```bash
cd packages/pi-thinking
npm install
```

Then install or reference the package:

```bash
pi install ./packages/pi-thinking
```

Or reference it from `agent/settings.json`:

```json
{
  "packages": [
    "../packages/pi-thinking"
  ]
}
```

## Command relationship summary

- `/flow` is the guided end-to-end path across reasoning, shaping, and spec generation
- `/think`, `/shape`, and `/spec` are still available for direct entry into a single stage
- `/shape` remains the primary definition artifact step because it produces the brief consumed by `/spec`
- `/spec` should prefer `docs/briefs/*.md` over conversation history, and use `docs/thinking/*.md` only as optional rationale

## Notes

- `/flow`, `/think`, `/shape`, and `/spec` are provided by extension commands.
- `web_search` uses `BRAVE_API_KEY` and/or `SERPER_API_KEY`.
