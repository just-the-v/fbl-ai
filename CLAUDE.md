# CLAUDE.md — fbl (Feedback Loop Engine)

## Project Overview

CLI tool (`fbl`) that automatically analyzes Claude Code sessions after each session ends, detects frictions, and suggests actionable improvements (CLAUDE.md rules, skills, hooks). Privacy-first, model-agnostic (Anthropic/OpenRouter/Ollama). Published as `fbl-ai` on npm.

## Stack

- **Runtime**: Node.js 22+, TypeScript 5.x, ESM (`"type": "module"`)
- **CLI**: commander, @inquirer/prompts, chalk, ora, cli-table3
- **Validation**: zod (v4 — uses `z.int()`, `z.uuid()`, `z.iso.datetime()`)
- **LLM**: @anthropic-ai/sdk (Anthropic adapter), native fetch (OpenRouter, Ollama)
- **Build**: tsup (2 entry points: `bin/fbl.ts` + `src/hooks/worker.ts`)
- **Tests**: vitest (globals enabled, passWithNoTests)
- **Backend**: Cloudflare Worker + D1 (separate project in `worker/`)

## Architecture

```
bin/fbl.ts                     → CLI entry point (commander, registers all commands)
src/cli/                       → Commands: init, analyze, report, apply, config, history
src/cli/index.ts               → Hook handler (hidden command: hook-handler)
src/cli/gain.ts                → Token savings analytics command
src/core/schema.ts             → Zod schemas: FrictionSchema, SuggestionSchema, SessionAnalysisSchema
src/core/parser.ts             → JSONL transcript parser → ParsedSession
src/core/prompt.ts             → buildAnalysisPrompt() with intelligent truncation
src/core/analyzer.ts           → Orchestrator: parse → prompt → LLM → validate → enrich
src/core/cost-estimator.ts     → Token/cost estimation per provider
src/adapters/types.ts          → LLMAdapter interface, LLMResponse, CostEstimate
src/adapters/anthropic.ts      → AnthropicAdapter (Haiku/Sonnet)
src/adapters/openrouter.ts     → OpenRouterAdapter (OpenAI-compatible API)
src/adapters/local.ts          → OllamaAdapter (localhost:11434)
src/adapters/registry.ts       → createAdapter(config) factory
src/hooks/worker.ts            → Background worker (detached process, separate tsup entry)
src/storage/config.ts          → ConfigSchema + load/save/getDataDir/ensureDataDirs
src/storage/analyses.ts        → CRUD for ~/.fbl/analyses/*.json
src/storage/suggestions.ts     → Suggestion index with status tracking
src/storage/sessions.ts        → Discover JSONL files in ~/.claude/projects/
src/storage/recommendations.ts → Fetch + cache global recommendations
src/telemetry/anonymize.ts     → Strip PII from analyses (no description/rule/reasoning/summary)
src/telemetry/client.ts        → Fire-and-forget POST to ingest endpoint
worker/                        → Cloudflare Worker (separate project, own package.json)
```

## Key Patterns

- **Command registration**: Each CLI command exports `registerXxxCommand(program: Command)` called from `bin/fbl.ts`
- **Adapter pattern**: All LLM adapters implement `LLMAdapter` interface (`analyze`, `estimateCost`, `isAvailable`)
- **Config-driven**: `loadConfig()` returns validated `Config`, `createAdapter(config)` returns the right adapter
- **Storage dir**: `~/.fbl/` (overridable via `FBL_DATA_DIR` env var, legacy `FEEDBACK_LOOP_DATA_DIR` also supported)
- **Schema-first**: Zod schemas define the contract; types are inferred with `z.infer<>`
- **Hook flow**: Claude Code SessionEnd hook → `fbl hook-handler` (reads stdin) → spawns detached worker → worker runs analysis async

## Build & Test

```bash
npm run build      # tsup → dist/bin/fbl.js + dist/hooks/worker.js
npm run test       # vitest run (128 tests, ~200ms)
npm run typecheck  # tsc --noEmit
npm run dev        # tsup --watch
```

## Important Conventions

- All imports use `.js` extension (ESM requirement): `import { foo } from './bar.js'`
- Worker is a separate tsup entry point — changes to `src/hooks/worker.ts` must build correctly standalone
- Tests use `FBL_DATA_DIR` (legacy: `FEEDBACK_LOOP_DATA_DIR`) pointed to a tmpdir for isolation
- Test fixtures live in `src/core/__tests__/fixtures/*.jsonl`
- The worker must NEVER crash — all errors are caught and logged to `~/.fbl/error.log`
- Telemetry is fire-and-forget with 5s timeout — never blocks, never throws
- The hook handler must exit in < 500ms (it only spawns the worker and exits)

## Zod v4 Specifics

This project uses **zod v4**. Key API differences from v3:
- `z.int()` instead of `z.number().int()`
- `z.uuid()` instead of `z.string().uuid()`
- `z.iso.datetime()` instead of `z.string().datetime()`
- `z.literal(1)` same as v3

## Data Flow

1. **Session ends** → Claude Code calls `fbl hook-handler` via SessionEnd hook
2. **Hook handler** reads stdin JSON `{session_id, transcript_path, cwd, reason}`, spawns worker, exits
3. **Worker** loads config → parses JSONL → builds prompt → calls LLM → validates response → stores analysis → updates suggestions → sends telemetry
4. **User** runs `fbl report` to see aggregated frictions and numbered suggestions
5. **User** runs `fbl apply <n>` to apply a suggestion via `claude -p` (headless)

## Commit Guidelines

Always add the AI co-author trailer:
```
Co-Authored-By: Claude <noreply@anthropic.com>
```
