# Code Layout

File and module conventions in this stack: aliases, imports, naming.

## Aliases

- `@app/*` → product code (this app).
- `@shared/*` → shared runtime code.
- One alias per layer. Do not introduce ad-hoc aliases (`~/*`, `#/*`, `$/*`, `@/*`).
- Shared modules MUST NOT import from product aliases or from product-specific transport (`@shared/api/rpc/runRpc`, `@shared/api/rpc/useRpcQuery`).
- A "shared" theme, primitive, or SDK that only works inside one product is mislabelled.

## Imports

- Prefer relative imports inside a small local area.
- `import type` for type-only imports.
- No barrel exports, except documented module entrypoints (e.g. `@shared/logger`).

## Naming

| Thing | Convention | Example |
|---|---|---|
| React component | `PascalCase.tsx` | `WelcomeCard.tsx` |
| Hook | `useFoo.ts` / `useFoo.tsx` | `useWelcomeData.ts` |
| Effect Service | `Context.Service` class, `PascalCase` | `class Library extends Context.Service<...>()("Library") {}` |
| Effect Layer | `<Service>Layer<Variant>` | `LibraryLayerLive`, `LibraryLayerInMemory` |
| Atom | `<noun>Atom` | `libraryItemsAtom`, `launchAtom` |
| Test/spec | `*.test.ts` / `*.spec.ts` | `resolver.test.ts` |
| Single-action RPC | `rpc.ts` / `rpc-handler.ts` | `hello/rpc.ts` |
| Multi-action RPC | `<action>.rpc.ts` / `<action>.rpc-handler.ts` | `get.rpc.ts` |
