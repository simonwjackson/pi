# Search Migration Notes (Claude Plugin -> Pi)

This Pi conversion replaces the legacy Claude plugin at:

- `/snowscape/code/github/simonwjackson/claude-plugins/search`

## Mapping

- Old command flow: `/search:web <query>` or script subcommands (`search`, `code`)
- New Pi flow: `/web <query>` prompt template + `web_search` tool
- Old explicit `code` subcommand: now auto-detected intent in `web_search`

## Backend parity

- Brave backend: preserved
- Serper backend: preserved
- Backend select (`brave|serper|all`): preserved via tool parameter
- RRF fusion (`all`): preserved

## Compatibility notes

- `includeText` is accepted but still not implemented (same practical behavior as legacy script)
- API keys remain unchanged:
  - `BRAVE_API_KEY`
  - `SERPER_API_KEY`
