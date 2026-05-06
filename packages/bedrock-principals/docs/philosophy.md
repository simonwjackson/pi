# Development Philosophy

Language- and framework-agnostic principles. They describe how engineering work compounds across any project, in any stack. Project-, language-, and tool-specific rules live alongside the project.

## Compound Engineering

Each unit of engineering work should make subsequent units easier, not harder.

- Plan enough to avoid rework.
- Keep changes small and reviewable.
- Codify reusable patterns in code, tests, and documentation when requested.
- Keep quality high so future changes stay easy.

## Engineering docs are the source of truth

Substantive rules live in versioned engineering docs, not in scattered chat logs, ticket comments, or agent prompts.

- Canonical engineering principles, standards, and style are written down once and shared by humans and agents.
- Agent-harness configuration files carry only harness-specific content and project-specific quirks; they defer to the canonical engineering docs.
- When a rule applies across projects, it lives in the cross-project layer. When it applies only to one project, it lives with that project.

## Design-First

Start from the user experience and work backward to implementation. This applies whether the "user" is a human, another service, an agent, or a script.

- What does the user see, receive, or observe?
- What do they do?
- What happens when something goes wrong?

## Completion Reflex

Do not ship something merely because it builds, compiles, or "looks right".

- Surface and challenge assumptions about inputs, environment, and callers.
- Prefer the minimum code that solves the stated problem.
- Verify behavior with a real command, real input, or real test — not by inspection alone.

## Systems Thinking

Build for composability.

- Vertical slices over horizontal layers — ship the thinnest end-to-end path first.
- Clean boundaries between product code and shared/reusable code.
- Pure domain logic in the core; infrastructure (I/O, transport, storage, time, randomness) at the edges.

## Composition at the boundary, functional core underneath

User-facing surfaces should read as composition; state and decisions should behave like functional data.

- Model feature state as small tagged unions / sum types / discriminated variants — not bags of booleans and nullable fields.
- Convert infrastructure primitives (results, exits, responses, process outcomes) into domain-specific state types at the seam where they enter the application.
- The presentation layer composes named states; pure adapters select and transform state.
- Prefer self-selecting state components or handlers over conditionals scattered throughout call sites.
- Keep state-conversion functions pure and directly testable.

## Reusable code is product-agnostic, today

Shared code does not reach into product code. Reusability is a property right now or never.

- Shared modules cannot import from product-specific layers (routes, transport clients, app wiring, feature glue).
- A "shared" module that only works inside one product is a product module wearing a costume.
- Move it, narrow its imports, or delete the boundary.

## Real implementations over mocks

Test what you ship by exercising the actual contract, not a stand-in.

- No `Mock*` / `Stub*` / `Fake*` classes in production or test code.
- Test doubles are real implementations with configurable behavior — outcome, delay, error mode, seed data, exit code.
- Configurability replaces faux-ness as the marker of a test seam.

## Preview environments are first-class consumers

Any unit (a page, a component, a CLI command, an endpoint, a job) renders or runs in its preview/sandbox environment using only fixture data and configured behavior.

- No live network calls in previews.
- No request-interception layers, no global fetch swaps, no environment-detection branching.
- A unit that requires a live backend to appear in its preview has a layering bug — fix the unit, not the harness.

## A unifying runtime model is preferred

When a stack offers a single runtime/effect model that spans services, state, and contracts, prefer it over a patchwork of one-off libraries.

- The same primitives apply across layers and across the wire when possible.
- Service contracts compose across the boundary.
- New seams are designed toward the unifying model, even when the immediate implementation is simpler.

The specific runtime, effect system, or composition model is a per-project choice.
