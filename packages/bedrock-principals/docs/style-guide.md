# Style Guide

How code looks and reads. Language- and framework-agnostic conventions; project-specific overrides (formatter, exact naming, syntax-level rules) live with the project.

## Formatting

Use the project's chosen formatter consistently. The formatter, not personal taste, is the source of truth.

- Pick one indentation style and one quote style per project, and let the formatter enforce them.
- No trailing whitespace.
- Keep files small and purpose-specific. A file that mixes unrelated concerns is harder to find, change, and review than two focused files.

## Naming

Naming carries meaning. Pick conventions per project and apply them everywhere; do not mix styles within one layer.

General guidance that holds across stacks:

- Names describe intent, not implementation detail. `RetryPolicy`, not `RetryThing`.
- Tests/specs live next to the unit they cover and share its name (e.g. `<unit>.test.<ext>`).
- Multi-action contracts (CRUD-like) use `<action>.<contract>.<ext>` consistently rather than overloading a single file.
- Avoid prefixes that encode type information already provided by the language (`I` for interfaces, `T` for types) unless the project explicitly opts in.
- Test doubles share names with their real counterparts (`InMemoryX`, `RecordingX`), not faux-prefixed names (`MockX`, `StubX`, `FakeX`).

A naming table for the specific stack belongs in the project's style guide.

## Type safety

When the language has a static type system, use it strictly.

- Enable strict mode where available.
- Avoid escape hatches (`any`, `unknown` casts, untyped dynamic) at module boundaries.
- Make module boundaries explicit: types or schemas at the seam, not inferred-only signatures.
- A schema definition is the source of truth for wire payloads, responses, and typed errors.
- Choose clear names over clever abstractions.

When the language is dynamic, the equivalent rule is: write contracts (schemas, validators, docstrings, type comments) at the same seams.

## Imports

- Prefer relative imports inside a small local area.
- Use type-only imports where the language supports them.
- Follow the project's alias and module-boundary rules.

## Unit architecture

These apply equally to UI components, services, modules, and CLI commands.

- One unit per file. A "unit" is the smallest thing a caller imports as a whole.
- Compound names are prefixed with the parent unit's name (`AppShellHeader`, not `Header`) so search and navigation lead somewhere useful.
- The root of a compound lives at the compound's root, not buried in `components/` or `internal/`.
- Only the root creates state and exposes it; every other compound reads through a documented accessor (hook, getter, context, channel).
- No boolean prop forests on units. Compose distinct call shapes per use case rather than toggling shared internals with flags.
- Inner units read state from context, dependency injection, or atoms — not from props drilled through every parent.
- One state owner per root. Lift the root when siblings need shared state; do not duplicate.
- No barrel exports, except documented module entrypoints that intentionally define a public import surface.

## Branching on async / runtime state

- Prefer a domain tagged union plus self-selecting state units over inline control flow.
- Convert raw async primitives once at the seam: `AsyncResult -> FeatureState`, `Exit -> CommandState`, response payload -> view model.
- Status (`Loading | Ready | LoadError | Defect | Empty`) is part of the contract, not a boolean check scattered across call sites.
- Loading, error, empty, and ready are different views of the same data, not different data flows.
- Match/branch helpers belong in pure adapters. Keep fluent async-state branching out of presentation code.
- Avoid render-prop / callback-prop branching as a substitute for a state model. Prefer compound children that read state from context and self-select.

## Functional state pattern

A general shape for behavior-bearing state, regardless of stack:

```
StateRoot(rawResult)
  ├── StateLoading
  ├── StateLoadError(onRetry)
  ├── StateDefect
  └── StateReady
```

Under the hood:

- `StateRoot` converts the raw runtime value (`AsyncResult`, `Exit`, response, etc.) into a tagged-union state once.
- Each child renders / runs only when its case is active and returns nothing otherwise.
- Conversion (`fromResult`, `fromExit`, …) and case selectors are pure and unit-tested.
- Children never inspect raw `AsyncResult` / `Exit` / response values.
- The "Ready" child receives already-validated case data, not the raw payload.

Keep this domain-specific first. Do not introduce a generic state-boundary framework until multiple features force it.

## Real-implementation conventions

- Test and harness doubles are real implementations with a `behavior` or `config` argument:

  ```
  createInMemoryLauncher({ kind: "fail", exitCode: 1 })
  ```

- Configurable knobs: outcome, delay, error type, seed data.
- Doubles live alongside the real implementations they share an interface with — not in a `__mocks__/`, `fakes/`, or `stubs/` folder.
- `Mock*` / `Stub*` / `Fake*` prefixes are forbidden, even in tests.

## Visual design

When the project ships a user-visible surface (web UI, native UI, TUI, generated documents):

- Use design tokens — theme variables, scale ramps, named colors — for type, spacing, color, and radius. Hardcoded values require an inline comment explaining why no token fits, and are an invitation to add a missing token.
- Size and spacing tokens are fluid by default where the medium supports it (e.g. `clamp(min, fluid, max)` on the web), calibrated to read sensibly across the supported range of devices. Static values in the theme are reserved for things that genuinely should not scale.
- Layouts respond to their **container**, not the viewport / window. Use container-relative units and queries where the medium supports them; reserve viewport-level decisions for page-frame layout where the layout itself fundamentally rearranges.
- Grids add cells when space allows rather than scaling a fixed column count. Designs should look denser on a larger surface, not zoomed in.
- Inline / one-off styles bypass theme constraints. Prefer theme-utility or theme-variable references; reach for inline values only when no theme token applies.

## Comments

- Comment the why, not the obvious what.
- Keep comments current or delete them.
- Doc comments are sparing and must add real value beyond what the signature already says.
