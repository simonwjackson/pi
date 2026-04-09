# pi dotfiles (public-safe)

This repo tracks a public-safe subset of `~/.pi`.

## Tracked
- `.pi/agent/settings.json`
- `.pi/agent/extensions/**` (source + package manifests)
- `packages/**` (local Pi packages)
- optional prompts/skills/themes if added later

## Not tracked
- `.pi/agent/auth.json` (tokens/secrets)
- `.pi/agent/sessions/**` (conversation history)
- `.pi/agent/git/**`, `.pi/agent/bin/**`, `node_modules/**`

## Apply to home
```bash
rsync -a .pi/ ~/.pi/
```

## Notes
- Keep provider API keys in environment variables.
- If you use `/login`, credentials go to `~/.pi/agent/auth.json` and stay untracked.
