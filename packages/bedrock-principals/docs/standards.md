# Development Standards

Language- and framework-agnostic rules for how to structure, layer, and verify code. Project-specific paths, file names, tooling commands, and stack choices live with the project.

## Layering

Reusable layers must not depend on product-specific code.

- Code in shared design systems, primitives, themes, SDKs, and utility packages MUST NOT import from product-specific layers (routes, transport clients, feature wiring, app glue).
- Pages and templates compose roots; they MUST NOT pick the data strategy. The composition root — the entry point that wires the unit into the app — is where data strategy is chosen.
- A reusable module that only works inside one app is mislabelled. Either narrow its scope or move it into the product.

## Imports and boundaries

- Use product-scoped paths or aliases for cross-folder imports inside a product.
- Use shared-scoped paths or aliases only for genuinely shared runtime code.
- No barrel exports / re-export indexes, except explicitly documented package or module entrypoints that define a public import surface.
- One alias per layer. Do not introduce ad-hoc aliases (`~/*`, `#/*`, `$/*`, `@/*`) just to avoid relative paths.

## Testing posture

- Tests exercise real implementations of contracts with deterministic configuration.
- No `Mock*` / `Stub*` / `Fake*` classes in test or production code.
- Use real subprocesses with controlled exit codes; real filesystem in temp directories; real in-process servers where feasible. The "fakeness" is in the configuration, not the type name.
- Test fixtures expose configurable knobs (`behavior`, `seed`, `exitCode`, `delayMs`, `errorKind`, …) on real implementations.

## Preview / sandbox harness posture

- Previews MUST render or run without live network calls and without intercepting network APIs.
- The seam for swapping data sources between production and harness is the same seam used in tests — a provider, layer, dependency-injection container, or atom-source override.
- A unit that requires a live backend to appear in its harness has a layering bug; fix the unit, not the harness.

## Runtime stack

When the project has chosen a unifying runtime/effect model, code targets it consistently.

- Service contracts are declared once and shared between production wiring and harness/test wiring.
- Wiring is explicit: production composition wires the live implementation; harnesses and tests wire alternative implementations of the same interface.
- Reactive state, request flow, and side-effect orchestration go through the chosen runtime — avoid hand-rolling a parallel mechanism for one feature.
- New code is written so that the path to the project's intended target version of the runtime is mechanical, not a rewrite.

The specific runtime is project-specific.

## State modeling

Composition shows views; functional data models state.

- Convert async/runtime primitives into domain-specific tagged unions before rendering or branching.
- Tagged unions use explicit cases for every meaningful state: `Loading`, `Ready`, `LoadError`, `Defect`, `Launching`, `Failed`, etc.
- Do not expose boolean forests (`loading`, `error`, `empty`, `failed`, plus nullable payloads) as the primary contract for a feature.
- State-specific units self-select from context or a derived value and do nothing when inactive.
- Selection helpers return an explicit `Maybe`/`Option`/sentinel-free type, not `null` / `undefined` payloads.
- Keep conversion and selection helpers pure and covered by unit tests.
- Call sites should not be dominated by render-prop chains, fluent async-state builders, or presenter-level `switch` statements. Those belong behind a domain boundary.

## API contracts

- A schema language is the source of truth for wire payloads, responses, and typed errors. Hand-written ad-hoc parsers and validators do not replace it.
- Errors are discriminated with an explicit tag (`_tag`, `kind`, `type`, …) — chosen consistently per project.
- Generated files are read-only; regenerate them through the project's tooling.

## Cross-cutting rules

- Sensitive data is never stored in client-accessible storage. Non-sensitive local preferences may use it when documented at the storage seam.
- When extracting parts from time values that originated as UTC (e.g. ISO date strings), use UTC accessors. Local-time accessors produce locale-dependent results and silent bugs.
- Use the project's structured logger, not `print` / `console.log` / `puts`, in runtime code. Direct stdout writes are reserved for CLIs whose contract is "write to stdout".

## Verification

Behavioral changes must be verified with a real command or test. The exact commands are project-specific.

- Run the project's typechecker / static analyzer across the relevant scope (whole-repo when path aliases are involved).
- Run unit tests.
- Run end-to-end, integration, or visual tests when the change touches user-facing behavior.
- Run formatter and linter.
