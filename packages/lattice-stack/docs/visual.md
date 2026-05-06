# Visual Design

How visual surfaces look in this stack: **Tailwind** + CSS theme variables + container queries.

## Design tokens

- Use design tokens — Tailwind theme utilities and CSS theme variables — for type, spacing, color, and radius.
- Hardcoded values (`font-size: 14px`, `#1B1714`) require an inline comment explaining why no token fits, and are an invitation to add a missing token.

## Fluid scaling

- Theme tokens for size and spacing are fluid by default — `clamp(min, fluid, max)` calibrated to read sensibly from a small handheld through a TV.
- Static pixel values in the theme are reserved for things that genuinely should not scale (e.g., 1px hairlines).

## Container-relative layout

- Components respond to their **container**, not the viewport.
- Use container query units (`cqi`, `cqh`, `cqw`) and `@container` queries.
- Declare `container-type: inline-size` (or `size`) on the appropriate ancestor.
- Reserve `@media` and viewport units for page-frame layout decisions where the layout itself fundamentally rearranges.

## Additive grids

- Grids add cells when space allows: `grid-template-columns: repeat(auto-fit, minmax(MIN, 1fr))` or equivalent.
- Do not scale a fixed column count up. Designs should look denser on a TV, not zoomed in.

## Style escape hatches

- Inline `style={{ … }}` and raw values in scoped `<style>` blocks bypass theme constraints.
- Prefer Tailwind utilities or theme-variable references; reach for inline values only when no theme token applies.
