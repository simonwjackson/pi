---
name: web-search
description: Real-time web search with Brave + Serper fusion. Use when users need current information, latest versions, breaking changes, official docs, or external references beyond model training data.
---

# Web Search Skill (Pi)

Use the `web_search` tool for live web lookups.

## When to invoke automatically

Invoke without asking for confirmation when the request is clearly time-sensitive or requires external references:

- "latest" / "current" / "recent" information
- release versions, changelogs, deprecations
- current incidents, outages, advisories, pricing
- API docs lookups, framework syntax checks, library usage examples
- verification requests: "find sources", "cite references", "check docs"

## Tool contract

Use tool: `web_search`

Parameters:

- `query` (required): the search text
- `backend` (optional): `all` (default), `brave`, `serper`
- `numResults` (optional): 1-20, default 10
- `includeText` (optional): accepted for compatibility, currently not implemented

## Behavior notes

- With `backend: all`, results are fused using Reciprocal Rank Fusion (RRF).
- If only one API key is configured, the tool falls back to that backend automatically.
- Code/documentation intent is auto-detected and query-biased toward technical sources.
- If no backend is configured, the tool returns setup guidance.

## Environment variables

- `BRAVE_API_KEY` → https://brave.com/search/api/
- `SERPER_API_KEY` → https://serper.dev/

At least one key is required.

## Response style

After tool execution:

1. Give a short summary (2-5 bullets)
2. Extract key findings relevant to the user's question
3. Include sources explicitly (title + URL)
4. Note uncertainty if sources conflict or are stale

Prefer authoritative sources (official docs, maintainer posts, standards bodies) before blogs/opinions.
