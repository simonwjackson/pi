# Tooling

Build tools, formatters, runners, harness posture, and verification commands.

## Formatting

Use **Biome** consistently.

- 2-space indentation.
- Semicolons only as needed.
- Double quotes.
- No trailing whitespace.
- Keep files small and purpose-specific.
- Run `just format` to format; `just lint` to check.

## TypeScript

- Strict mode required.
- Avoid `any`.
- Explicit types at module boundaries.
- Choose clear names over clever abstractions.

## Test runner

- Unit tests run with `bun test` (`just test-unit`).
- E2E and visual tests run with Playwright (`just test-e2e`, `just test-component`).

## Visual harness

Components and pages render in **Storybook** with only fixture data and configured behavior.

- No network calls in stories.
- No `vi.mock`, no MSW, no `globalThis.fetch` swap.
- A component that requires a backend to appear in Storybook has a layering bug — fix the component, not the harness.
- The harness seam is the same Provider / Layer / atom-source override used in tests (a `layerAtom` swap).

## Real-implementation conventions

- Test and harness doubles are real implementations with a `behavior` or `config` argument:

  ```ts
  createInMemoryLauncher({ kind: "fail", exitCode: 1 })
  ```

- Configurable knobs: outcome, delay, error type, seed data.
- Doubles live alongside the real implementations they share an interface with — not in a `__mocks__` or `fakes/` folder.
- `Mock*` / `Stub*` / `Fake*` prefixes are forbidden, even in tests.

## Cross-cutting rules

- Sensitive data is never stored in `localStorage`; non-sensitive local preferences such as feature-gate ids may use it when documented at the storage seam.
- When extracting parts from ISO date strings, use UTC methods (`getUTC*`). Local-time methods produce locale-dependent results and silent bugs.
- Use `@shared/logger`, not `console.log`, in runtime code.

## Verification

- TypeScript typechecking is whole-repo only because of path aliases — run `just typecheck`, not per-file `tsc`.
- Run `just typecheck`, `just test-unit`, `just lint`, and `just format` before considering a change complete.
- Run E2E or visual tests when the change touches user-facing behavior.

## Comments

- Comment the why, not the obvious what.
- Keep comments current or delete them.
- Doc comments are sparing and must add real value beyond what the signature already says.
