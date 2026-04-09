# web-search extension

Pi extension that provides the `web_search` tool:

- Brave Search backend (`BRAVE_API_KEY`)
- Serper backend (`SERPER_API_KEY`)
- Reciprocal Rank Fusion (RRF) when both are available
- Automatic code/doc intent routing

## Files

- `index.ts` - tool registration + orchestration
- `clients.ts` - Brave/Serper HTTP clients
- `core.ts` - pure logic (intent detection, RRF, formatting)
- `core.test.ts` - unit tests for pure logic
