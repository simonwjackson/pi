---
description: Generate 3-5 UI design variations with an ultra-subtle option picker
---
Generate multiple UI design options from the user’s input.

Input:
- Primary brief: `$ARGUMENTS`
- Optional assets/context from the user (brand style, target audience, constraints, existing UI)

If `$ARGUMENTS` is empty, ask one concise clarifying question before proceeding.

Output requirements:
1. Create **3 to 5 distinct design variations** within the active application flow/screen the user is working on.
2. Include an **option picker** that lets the user switch between variations.
   - The picker must live **inside the application UI context** (not as an external overlay/tool panel), unless the user explicitly asks otherwise.
3. The picker must be **extremely subtle**:
   - Near-transparent / visually quiet
   - Still discoverable as interactive
   - Must not distract from the core design
4. Keep variation differences meaningful (layout, hierarchy, visual tone, component treatment).
5. For each variation, provide:
   - Variation name
   - Short concept rationale
   - Key visual differences
6. End with a concise recommendation on when to choose each variation.

Rules:
- Prioritize clarity and visual hierarchy.
- Avoid over-ornamentation.
- Apply changes **in the current application/codebase context** the user is actively working in.
- Do **not** create standalone demo files (e.g., new HTML mockups) unless the user explicitly asks for them.
- Prefer updating existing app screens/components/routes over creating parallel artifacts.
- For the picker, never use high-contrast borders, heavy shadows, or loud accent colors.
- Keep picker states subtle (default, hover, active) while preserving clear clickability.
- Do not provide implementation code unless explicitly requested.
- Keep responses concise and design-focused.
