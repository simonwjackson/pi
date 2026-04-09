# Conversion Contract: `search` -> Pi

Source implementation:
- `/snowscape/code/github/simonwjackson/claude-plugins/search/scripts/web-search.ts`
- `/snowscape/code/github/simonwjackson/claude-plugins/search/skills/web-search/SKILL.md`
- `/snowscape/code/github/simonwjackson/claude-plugins/search/commands/web.md`

Target implementation (Pi):
- `agent/extensions/web-search/index.ts` (`web_search` tool)
- `agent/skills/web-search/SKILL.md`
- `agent/prompts/web.md` (`/web` command)

Parity level: functional parity
- Brave + Serper backends
- backend selection (`brave|serper|all`)
- RRF fusion when using both
- code-oriented behavior preserved via intent routing
- includeText accepted (not implemented)
