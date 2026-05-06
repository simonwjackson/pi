---
name: react
description: "MUST read before writing, editing, or reviewing any .jsx or .tsx file. Defines compound components, Provider-driven data strategy, optimistic mutations, and atomic composition. Applies to React component work in any project."
---

# React Component Architecture

## Core Rule

Never add a boolean prop that controls which subtree renders. If the parent decides what renders, compose distinct component trees instead.

## Anti-Pattern

```tsx
// Boolean forest — each new use case adds more booleans
<UserForm isEditing={true} isAdmin={false} showTerms={false} onCancel={fn} />
```

The implementation has conditionals everywhere checking the same booleans.

## Compound Components with Provider

Split monoliths into composable primitives. Each use case assembles its own tree.

### File Structure

One component per file. No barrel files. No namespace objects.

```text
<ui-root>/<WidgetName>/
  <WidgetName>Root.tsx            # Root — only component that creates state
  <WidgetName>.context.tsx        # Context + hook + optional pure state machine
  <WidgetName>.context.test.ts    # Unit tests for pure state logic (if any)
  <WidgetName>.stories.tsx        # Full-composition stories (if the project uses stories)
  components/
    <WidgetName>Header.tsx
    <WidgetName>Sidebar.tsx
    <WidgetName>Nav.tsx
    ...
  data/
    fixtures.ts
  types.ts
```

**Rules:**

- **No barrel files.** Do not create a file that imports all compounds and re-exports them as a namespace object. Consumers import directly from source files.
- **Prefix all compounds with the widget name.** `AppShellHeader`, not `Header`.
- **Root lives at the widget root, not in `components/`.** The Root is the public entry point for the widget. Everything else lives in `components/`.
- **Root owns all state.** Only the Root component calls `useState`, creates the context value, and renders the Provider. Every other compound reads state via `useWidgetName()`.
- **Context lives in `<WidgetName>.context.tsx`.** Export the React context, the guarded hook, and the context value type. If the state logic is complex enough to unit test, also export a pure state machine function with no React dependency.
- **Stories are composition roots.** Each story assembles a distinct tree of compounds. Stories demonstrate flexibility by including or excluding compounds, not by passing boolean props.

### 1. Define a context contract

The contract exposes **data, status, reference data, and simple mutation functions**. Nothing else. No transport state, no pending sets, and no widget-local UI state.

```tsx
// UserForm.context.tsx

type UserFormContext = {
  status: "loading" | "ready" | "error"
  items: Item[]
  availableRoles: { id: number; name: string }[]
  updateItem: (id: number, patch: Partial<Item>) => void
  removeItem: (id: number) => void
}

const UserFormCtx = createContext<UserFormContext | null>(null)

export function useUserForm(): UserFormContext {
  const ctx = useContext(UserFormCtx)
  if (!ctx) {
    throw new Error("useUserForm must be used within a UserFormRoot")
  }
  return ctx
}
```

**What goes in the contract:** data, status, reference data, mutation functions.

**What stays widget-local:** selection, sorting, filtering, search, grouping, undo stack, cell flash, hover state, editing state.

**Mutation signatures** are `(id, value) => void` or similarly simple domain-level functions. The Root captures infrastructure concerns via props or closure. Never push transport or environment arguments through every consumer call.

**Contract types** should be designed intentionally for the UI. Do not copy a server response shape or fixture shape blindly.

### 2. Inject data strategy via Root

The Root component creates state and renders the Provider. Children are source-agnostic.

```tsx
// UserFormRoot.tsx — the only component that creates state

export function UserFormRoot({ children }: { children: ReactNode }) {
  const [items, setItems] = useState(SEED_DATA)

  const updateItem = (id: number, patch: Partial<Item>) => {
    setItems(prev => prev.map(item => (item.id === id ? { ...item, ...patch } : item)))
  }

  const removeItem = (id: number) => {
    setItems(prev => prev.filter(item => item.id !== id))
  }

  return (
    <UserFormCtx.Provider value={{ status: "ready", items, availableRoles, updateItem, removeItem }}>
      {children}
    </UserFormCtx.Provider>
  )
}
```

For server-backed data, create a different Root or Provider with the same contract.

```tsx
// ServerUserFormRoot.tsx — same contract, different data source

export function ServerUserFormRoot({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])

  const updateItem = (id: number, patch: Partial<Item>) => {
    const previous = items.find(item => item.id === id)

    setItems(current =>
      current.map(item => (item.id === id ? { ...item, ...patch } : item)),
    )

    saveItem({ id, ...patch }).catch(() => {
      setItems(current =>
        current.map(item => (item.id === id && previous ? previous : item)),
      )
      toast.error("Couldn't save, reverted")
    })
  }

  return (
    <UserFormCtx.Provider value={{ status: "ready", items, availableRoles, updateItem, removeItem }}>
      {children}
    </UserFormCtx.Provider>
  )
}
```

Same contract. Same children. Different data source.

### 3. Compose distinct trees per use case

Each compound is imported directly from its source file. No dot-notation namespaces.

```tsx
import { UserFormRoot } from "./UserFormRoot"
import { UserFormHeader } from "./components/UserFormHeader"
import { UserFormNameField } from "./components/UserFormNameField"
import { UserFormEmailField } from "./components/UserFormEmailField"
import { UserFormTermsCheckbox } from "./components/UserFormTermsCheckbox"
import { UserFormFooter } from "./components/UserFormFooter"

function CreateUserForm() {
  return (
    <UserFormRoot>
      <UserFormHeader title="Create User" />
      <UserFormNameField />
      <UserFormEmailField />
      <UserFormTermsCheckbox />
      <UserFormFooter submit={<SubmitButton />} />
    </UserFormRoot>
  )
}

function EditUserForm() {
  return (
    <ServerUserFormRoot>
      <UserFormHeader title="Edit User" />
      <UserFormNameField />
      <UserFormEmailField />
      <UserFormFooter submit={<><CancelButton /><SaveButton /></>} />
    </ServerUserFormRoot>
  )
}
```

No booleans. No conditionals inside shared components. Each variant is a distinct composition.

### 4. Lift the Root when siblings need shared state

```tsx
function EditUserDialog() {
  return (
    <ServerUserFormRoot>
      <EditUserForm />
      <DialogActions>
        <SaveButton />
      </DialogActions>
    </ServerUserFormRoot>
  )
}
```

### 5. Reusable monolith escape hatch

```tsx
function CommonFields() {
  return (
    <>
      <UserFormNameField />
      <UserFormEmailField />
      <UserFormPhoneField />
    </>
  )
}

<UserFormFooter submit={<SubmitButton />}>
  <CommonFields />
</UserFormFooter>
```

Use the escape hatch for the common case, but keep the ability to compose individual primitives for one-off flows.

### 6. Permissions and other cross-cutting concerns are separate layers

```tsx
function UserPage() {
  const permissions = usePermissions()

  return (
    <PermissionProvider value={permissions}>
      <UserFormRoot>
        <UserToolbar />
        <EditUserForm />
      </UserFormRoot>
    </PermissionProvider>
  )
}
```

## Optimistic-First Mutations

All mutation contracts use simple function signatures. The Root applies changes to data immediately. Consumers always see the intended current truth.

**Rules:**
- No `pendingMutations`, `isPending`, or network-state bags in the context contract
- No transport concerns leaking into atoms
- Root handles optimistic write and rollback internally
- Rollback on failure should restore previous state and surface an error appropriately

**Why:** Atoms should not care whether their Provider talks to local state or a server. The data they receive should already represent the best current truth for rendering.

## Undo Pattern

Undo is **widget-local**. It is not part of the Provider contract.

The widget captures a snapshot before each mutation, then pushes an undo entry that calls the same Provider mutation with the previous value.

```tsx
function handleChangeRole(id: number, newRoleId: number) {
  const previousRole = participants.find(participant => participant.id === id)?.role

  changeRole(id, newRoleId)

  pushUndo({
    description: `Role → ${newRoleName}`,
    undo: () => changeRole(id, previousRole!.id),
  })
}
```

- Local-state Root: undo is another state update
- Server-backed Root: undo is another optimistic mutation
- The undo stack, toast, and timers stay entirely widget-local

## Atomic Composition Levels

| Level | What it is | Example |
|---|---|---|
| Atom | Single UI primitive that consumes context | `UserFormNameField`, `StatusBadge` |
| Molecule | Small composition of atoms | `ParticipantRow`, `ToolbarControls` |
| Organism | Larger feature surface | `ParticipantsTable`, `EditUserForm` |
| Root | Creates state and renders Provider | `UserFormRoot`, `AppShellRoot` |
| Composition root | Picks the Root and assembles the tree | route component, page component, story |

Atoms and molecules are source-agnostic. The Root is the seam where data strategy changes.

## No Leaky Abstractions

Transport concerns never enter the component contract:
- No `pendingMutations: Set<string>`
- No `dirtyFields` or `confirmed: boolean` on UI data types
- No network-specific state objects in context
- No infrastructure arguments repeated in mutation signatures

`status: "loading" | "ready" | "error"` **is** part of the contract because it describes what the widget should render, not how the data arrived.

## Why This Matters for AI

- Boolean props create combinatorial state spaces
- Component trees are explicit and easier to reason about
- Each variant is a distinct file or composition
- Removing behavior often becomes deleting JSX instead of untangling conditionals
- Direct imports keep dependencies explicit

## Decision Rules

| Situation | What to do |
|---|---|
| Parent passes boolean controlling child rendering | Compose instead |
| Same boolean checked in multiple places | Extract a separate composition |
| Footer, toolbar, or actions differ by use case | Pass JSX children, not config booleans |
| Data source differs between use cases | Different Root, same children |
| Something outside the frame needs feature state | Lift the Root |
| Component needs pending state | Prefer optimistic data over transport flags |
| UI state like selection, sort, filter, undo | Keep widget-local |
| Undo after mutation | Snapshot before, reverse with another mutation |
| Reference data for dropdowns and pickers | Put it in the context contract |
| Need aggregate exports | Do not create barrel files |
| Need a public entry point | Put the Root at the widget root |
