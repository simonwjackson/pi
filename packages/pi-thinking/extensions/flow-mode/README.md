# Flow Mode Extension

Guided end-to-end pipeline mode for moving through:

1. `/think`
2. `/shape`
3. `/spec`

`/flow` is the package's guided entrypoint when the user wants help moving from reasoning through definition into implementation planning.

## Purpose

Flow mode coordinates the existing stage modes instead of replacing them.

It exists to:
- start the right stage at the right time
- persist lightweight pipeline state across session resume/switch
- track the current topic, memo path, and brief path
- present controlled stage handoffs
- keep the user oriented inside the guided pipeline

## Command

- `/flow <topic>` - start the guided pipeline with explicit input
- `/flow` - start from current session context when possible, or prompt for a topic
- `/flow` while active - show stage-aware actions such as continue, pause, stop, or restart

## Stages

### Think
- starts through the shared think-mode helper
- treats thinking memos as optional reasoning artifacts
- detects readiness from think-mode's existing ready-to-synthesize state

### Shape
- starts through the shared shape-mode helper
- treats the brief in `docs/briefs/` as the primary artifact
- uses `docs/thinking/` only as optional rationale/history
- waits until the brief is valid and open questions are resolved

### Spec
- starts through the shared spec-mode helper
- prefers `docs/briefs/*.md` as primary input
- uses `docs/thinking/*.md` only as optional supporting rationale
- marks flow complete once a valid `Spec:` section with numbered steps exists

## Relationship to `/think`, `/shape`, and `/spec`

`/flow` does not replace the standalone stage commands.

Instead:
- `/flow` is the guided end-to-end path
- `/think` remains direct entry into reasoning
- `/shape` remains direct entry into shaping and brief creation
- `/spec` remains direct entry into implementation spec generation

All stage transitions in flow mode should go through the same internal helpers used by the standalone commands.

## UI behavior

Flow mode adds a lightweight status/footer widget so the user can see:
- that they are inside the guided pipeline
- the current stage
- known readiness state
- known memo path / brief path when available

## Persistence

Flow mode persists lightweight pipeline state so it can recover:
- current stage
- topic
- memo path
- brief path
- readiness flags

This allows the guided pipeline to survive session resume and session switch.
