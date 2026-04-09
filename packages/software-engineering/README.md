# @simonwjackson/pi-software-engineering

A Pi package for software engineering skills.

## Included

### Skills
- `tdd` — test-driven development with a red-green-refactor loop

## Source

The `tdd` skill in this package is vendored from:

- <https://github.com/mattpocock/skills/tree/main/tdd>

Imported files:
- `skills/tdd/SKILL.md`
- `skills/tdd/deep-modules.md`
- `skills/tdd/interface-design.md`
- `skills/tdd/mocking.md`
- `skills/tdd/refactoring.md`
- `skills/tdd/tests.md`

The upstream repository is MIT licensed. See `LICENSE`.

## Local install

```bash
pi install ./packages/software-engineering
```

Or reference it from settings:

```json
{
  "packages": [
    "../packages/software-engineering"
  ]
}
```

## Usage

After installation, Pi will discover the skill and expose:

```text
/skill:tdd
```

Pi may also load the skill automatically when the task matches its description.
