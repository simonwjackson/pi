# React UI Patterns

UI reads like React composition; state behaves like functional data.

## Composition posture

- Model feature state as small TypeScript discriminated unions, not bags of booleans and nullable fields.
- Convert infrastructure primitives (`Result`, `Exit`, RPC responses, process outcomes) into domain ADTs at the seam.
- Components compose visual states; pure adapters select and transform state.
- Prefer self-selecting state components over render props, fluent builders in JSX, or imperative presenter switches.
- Keep state-conversion functions pure and directly testable.

## Component architecture

- One component per file.
- Compounds are prefixed with the widget name (`AppShellHeader`, not `Header`).
- The Root lives at the widget root, not in `components/`.
- Only the Root creates state and renders the Provider; every other compound reads via the widget's hook.
- No boolean prop forests. Compose distinct trees per use case rather than toggling shared subtrees with flags.
- Atoms read state from context (or atoms), not from props drilled through every parent.
- One state owner per Root. Lift the Root when siblings need shared state; do not duplicate.

## State modeling

- Convert async/runtime primitives into domain-specific ADTs before rendering. Examples: `LibraryListState.fromResult(result)`, `LaunchState.fromExit(id, exit)`.
- ADTs use explicit `_tag` values for every meaningful state: `Loading`, `Ready`, `LoadError`, `Defect`, `Launching`, `Failed`, etc.
- Do not expose boolean forests (`loading`, `error`, `empty`, `failed` plus nullable payloads) as the primary UI contract.
- State-specific components self-select from context or an atom-derived ADT and return `null` when inactive.
- Selection helpers return `Option` from `effect`, not `undefined` payloads.
- Keep conversion and selection helpers pure and covered by unit tests.
- JSX should not be dominated by render props, async-state builder chains, or presenter-level `switch` statements.

## Branching on async state

- Status (`Loading | Ready | LoadError | Defect | Empty`) is part of the contract, not a boolean check scattered across components.
- Loading, error, empty, and ready are different views of the same data, not different data flows.
- `AsyncResult.match*` helpers are useful in pure adapters, but avoid fluent async-state branching in JSX.
- Avoid render props for state branching. Prefer compound children that read state from context/atoms and self-select.

## Functional state component pattern

Use this shape for behavior-bearing React state:

```tsx
<LibraryListStateRoot result={items}>
  <LibraryListLoading />
  <LibraryListLoadError onRetry={refreshItems} />
  <LibraryListDefect />
  <LibraryListReady launch={launch} />
</LibraryListStateRoot>
```

Under the hood:

```ts
type LibraryListState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Ready"; readonly games: readonly GameRecord[] }
  | { readonly _tag: "LoadError"; readonly error: LibraryError }
  | { readonly _tag: "Defect"; readonly defect: unknown }

const LibraryListState = {
  fromResult: (
    result: AsyncResult.AsyncResult<readonly GameRecord[], LibraryError>,
  ) =>
    AsyncResult.matchWithWaiting(result, {
      onWaiting: () => ({ _tag: "Loading" }),
      onError: error => ({ _tag: "LoadError", error }),
      onDefect: defect => ({ _tag: "Defect", defect }),
      onSuccess: success => ({ _tag: "Ready", games: success.value }),
    }),

  select:
    <Tag extends LibraryListState["_tag"]>(tag: Tag) =>
    (state: LibraryListState) =>
      state._tag === tag ? Option.some(state) : Option.none(),
}
```

State components consume selected cases:

```tsx
function LibraryListReady() {
  const ready = useLibraryListCase("Ready")

  return Option.match(ready, {
    onNone: () => null,
    onSome: ({ games }) => <LibraryListReadyView games={games} />,
  })
}
```

Guidelines:

- The Root/provider converts raw runtime state into the ADT.
- ADT conversion and selectors are pure and unit-tested.
- Components do not inspect raw `AsyncResult` / `Exit` values.
- Success views receive already-valid case data.
- Keep this domain-specific first; do not introduce a generic result-boundary framework until multiple features force it.
