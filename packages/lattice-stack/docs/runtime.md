# Effect Runtime

Effect is the unifying runtime model in this stack — services, layers, atoms, schemas, RPC. Same primitives backend and frontend. Service contracts compose across the wire.

## Posture

- Same primitives backend and frontend.
- Service contracts compose across the wire via Effect RPC.
- New seams are designed with Effect v4 atoms + layers as the destination, even when the immediate implementation is simpler.
- Avoid hand-rolling query stores, transport hooks, or request caches once Effect is on the critical path. Atoms and layers replace them.
- Effect v4 is the target. New code is written so the path from any Provider/hook scaffolding to v4 atoms is mechanical.

## Services

- Declared with `Context.Service<Self, Shape>()("ID")`.
- Naming: `PascalCase` class, e.g. `class Library extends Context.Service<Library, LibraryShape>()("Library") {}`.

## Layers

- `Layer.effect(Service, makeEffect)` for production wiring.
- `Layer.succeed(Service, value)` for harnesses and tests.
- Naming: `<Service>Layer<Variant>`, e.g. `LibraryLayerLive`, `LibraryLayerInMemory`.

## Reactive state

- Reactive state uses `@effect/atom-react`.
- Atoms run over `Atom.runtime((get) => get(layerAtom))`.
- The harness seam is a `layerAtom` holding the current `Layer<Service>`. Stories and tests override; production leaves it default.
- Atom naming: `<noun>Atom`, e.g. `libraryItemsAtom`, `launchAtom`.

## Effect-flavored React

- Read: `useAtomValue(resultAtom)`, then adapt the result into a domain ADT before rendering.
- Write: `useAtomSet(fnAtom, { mode: "promiseExit" })`, then adapt the exit into a command ADT.
- Render: compose state-specific components (`<FeatureLoading />`, `<FeatureError />`, `<FeatureReady />`) under a state provider.

## API contracts

- **Effect Schema** is the source of truth for wire payloads, responses, and typed errors.
- Errors are discriminated on `_tag`.
- RPC tags follow `entity.concept.action`.
- Generated files are read-only.
