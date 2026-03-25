---
name: commit-push
description: Atomic release workflow for fbl-ai. Bumps version, commits with gitmoji, creates PR, merges to master, publishes to npm. Use when the user says "commit-push", "release", "publish", or "deploy to npm".
compatibility: Requires git, gh CLI, npm with publish access
allowed-tools: Bash(git:*) Bash(gh:*) Bash(npm:*) Read Edit
metadata:
  author: just-the-v
  version: "1.0"
---

# Release workflow

Atomic commit + PR + merge + npm publish for fbl-ai.

## Pre-flight

1. Ensure working directory is `/Users/beeleethebee/Dev/vastugo/feedbackoops`
2. Run build and tests:

```bash
npm run build && npm run test
```

If anything fails, STOP and fix first.

## Bump version

Read `package.json`, bump the **patch** version (e.g. 0.1.2 → 0.1.3).

If the user specified major/minor/patch, use that instead.

Update `package.json` with the new version.

## Rebuild

```bash
npm run build
```

## Update Progress.md

Read `Progress.md` and append a new version section under `### Milestones` with:
- Version number and date
- Bullet list of changes included in this release (from staged diff)

If Progress.md doesn't exist, skip this step.

## Branch and commit

Create a release branch:

```bash
git checkout -b release/v<new-version>
```

Stage changed files individually (never `git add -A`). Commit with gitmoji:

| Change type | Emoji |
|------------|-------|
| New feature | ✨ |
| Bug fix | 🐛 |
| Refactor | ♻️ |
| Release/deploy | 🚀 |
| Docs | 📝 |
| Polish | 💄 |
| Breaking change | 💥 |

Always include the trailer:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

## Push and create PR

```bash
git push -u origin release/v<new-version>
```

Create PR:

```bash
gh pr create --title "<gitmoji> <description> (v<version>)" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Checklist
- [x] Build passes
- [x] Tests passing
- [x] Version bumped

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Merge

```bash
gh pr merge --squash --auto
```

Then sync local:

```bash
git checkout master && git pull
```

## Publish

```bash
npm publish --access public
```

This triggers typecheck + test + build automatically via `prepublishOnly`.

## Cleanup

```bash
git branch -d release/v<new-version>
```

## Report

Output:
- Version published
- PR URL
- npm: https://www.npmjs.com/package/fbl-ai

## Rules

- NEVER skip tests or build
- NEVER force push
- ALWAYS use gitmoji
- If any step fails, STOP and report. Do not continue.
- Use the user's commit message if provided, otherwise generate from changes.
