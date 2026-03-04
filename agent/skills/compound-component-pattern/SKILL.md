---
name: compound-component-pattern
description: "MUST read before writing, editing, or reviewing any .jsx or .tsx file. Defines the compound component pattern: composition over boolean props, provider/consumer trees. Applies to all React component work — creating, modifying, or refactoring components."
---

## React Composition Pattern — Compound Components

### Core Rule
Never add a boolean prop that controls which subtree renders. If the parent decides what renders, compose distinct component trees instead.

### Anti-Pattern
```tsx
// Boolean forest — each new use case adds more booleans
<UserForm isEditing={true} isAdmin={false} showTerms={false} onCancel={fn} />
```
The implementation has conditionals everywhere checking the same booleans.

### Pattern: Compound Components with Provider

Split monoliths into composable primitives. Each use case assembles its own tree:

**1. Define a Provider contract:**
```tsx
type FeatureContext = {
  state: FeatureState
  update: (patch: Partial<FeatureState>) => void
  submit: () => Promise<void>
  meta: { [key: string]: unknown }  // refs, loading flags, etc.
}
```

**2. Inject state implementation via Provider:**
The component rendering the Provider decides HOW state works. Children are agnostic.

```tsx
// Local state provider
function EphemeralProvider({ children }) {
  const [state, setState] = useState(initial)
  return <Ctx.Provider value={{ state, update: setState, submit, meta }}>{children}</Ctx.Provider>
}

// Server-synced provider (same children, different backend)
function SyncedProvider({ children }) {
  const { state, update, submit } = useServerSync()
  return <Ctx.Provider value={{ state, update, submit, meta }}>{children}</Ctx.Provider>
}
```

**3. Compose distinct trees per use case:**
```tsx
// Create user — full form with terms
function CreateUserForm() {
  return (
    <EphemeralProvider>
      <Form.Header title="Create User" />
      <Form.NameField />
      <Form.EmailField />
      <Form.TermsCheckbox />
      <Form.Footer submit={<SubmitButton />} />
    </EphemeralProvider>
  )
}

// Edit user — no terms, cancel/save buttons
function EditUserForm({ userId }) {
  return (
    <EditProvider userId={userId}>
      <Form.Header title="Edit User" />
      <Form.NameField />
      <Form.EmailField />
      <Form.Footer submit={<><CancelButton /><SaveButton /></>} />
    </EditProvider>
  )
}
```
No booleans. No conditionals inside shared components. Each variant is a distinct file.

**4. Lift the Provider when siblings need shared state:**
```tsx
// Submit button is OUTSIDE the form frame
function EditUserDialog({ userId }) {
  return (
    <EditProvider userId={userId}>      {/* wraps BOTH */}
      <EditUserForm />                  {/* the form */}
      <DialogActions>
        <SaveButton />                  {/* uses context, not inside form */}
      </DialogActions>
    </EditProvider>
  )
}
```

**5. Reusable monolith escape hatch:**
```tsx
// CommonFields wraps primitives for the 80% case (ZERO boolean props)
function CommonFields() {
  return <><Form.NameField /><Form.EmailField /><Form.PhoneField /></>
}

// Most forms use it
<Form.Footer submit={<SubmitButton />}><CommonFields /></Form.Footer>

// One-off forms escape to individual primitives
<Form.Footer submit={<SaveButton />}><Form.NameField /><Form.EmailField /></Form.Footer>
```

**6. Permissions are a separate context layer:**
```tsx
function UserPage() {
  const perms = usePermissions()
  return (
    <PermissionProvider value={perms}>
      <UserProvider>
        <UserToolbar />  {/* reads permissions for button visibility */}
        <UserForm />     {/* reads permissions for field editability */}
      </UserProvider>
    </PermissionProvider>
  )
}
```

### Why This Matters for AI
- Boolean props create 2^n state space. LLMs hallucinate impossible combinations.
- Component trees are sequential JSX. No combinatorial explosion.
- Each variant is a distinct file — easy to copy and modify.
- Removing a feature = delete a JSX element, not hunt for all boolean checks.

### Decision Rules
| Situation | What to do |
|-----------|------------|
| Parent passes boolean controlling child rendering | Compose instead |
| Same boolean checked in 3+ places in component | Extract into separate composition |
| Footer/toolbar/actions differ per use case | Pass as JSX children, not config |
| State backend differs between use cases | Different Provider, same children |
| Something outside the frame needs feature state | Lift the Provider |
| Cross-feature UI state (theme, sidebar) | Global state manager, not providers |
