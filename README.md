# fbl

> Automated session analysis for Claude Code — detect frictions, suggest improvements, close the feedback loop.

[![npm version](https://img.shields.io/npm/v/fbl-ai.svg)](https://www.npmjs.com/package/fbl-ai)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/License-FSL--1.1--MIT-blue.svg)](LICENSE)

## What it does

Every time you close a Claude Code session, **fbl** analyzes the transcript, detects recurring frictions, and suggests actionable rules to add to your `CLAUDE.md`. It learns from your mistakes so you don't repeat them.

**Privacy-first**: Your code and transcripts never leave your machine. Only anonymized friction patterns are shared (opt-in).

**Model-agnostic**: Works with Anthropic (Haiku/Sonnet), OpenRouter (100+ models), or fully local via Ollama.

## Quick Start

```bash
npm i -g fbl-ai                # Install globally
fbl init                       # Configure provider + install hook
fbl analyze --last 7d          # Analyze past sessions (instant value)
fbl report                     # See frictions + suggestions
fbl apply 1                    # Apply suggestion #1 to CLAUDE.md
```

## How it works

```
Claude Code session ends
        │
        ▼
SessionEnd hook triggers (async, < 100ms)
        │
        ▼
Background worker reads transcript JSONL
        │
        ▼
LLM analyzes for frictions & suggestions
        │
        ▼
Results stored locally (~/.fbl/)
        │
        ▼
`fbl report` shows insights
        │
        ▼
`fbl apply` edits CLAUDE.md via Claude Code headless
```

## Features

- **Automatic analysis** — hook runs after every session, zero effort
- **Friction detection** — identifies wrong approaches, buggy code, scope bloat, missing context, and more
- **Actionable suggestions** — specific rules for CLAUDE.md, skills, workflows, and hooks
- **Historical analysis** — `analyze --last 30d` to get value from day one
- **Cost estimation** — see estimated cost before analyzing historical sessions
- **Apply with one command** — `apply <n>` uses Claude Code headless to edit CLAUDE.md intelligently
- **Community insights** — anonymous telemetry powers global recommendations (opt-in)
- **3 LLM providers** — Anthropic, OpenRouter, or local (Ollama)

## Commands

| Command | Description |
|---------|-------------|
| `fbl init` | Interactive setup wizard |
| `fbl analyze --last <duration>` | Analyze past sessions |
| `fbl report [--last <duration>]` | Show friction report + suggestions |
| `fbl apply <n>` | Apply suggestion using Claude Code |
| `fbl history [--last <duration>]` | Timeline of past analyses |
| `fbl config [--show\|--provider\|--telemetry]` | View/update configuration |
| `fbl gain` | Show token savings analytics |

## Configuration

Config is stored in `~/.fbl/config.json`. Use `fbl config` to modify.

### Providers

| Provider | Pros | Cons | Default model |
|----------|------|------|---------------|
| Anthropic | Fast, accurate | API key needed | claude-haiku-4-5 |
| OpenRouter | 100+ models, cheap | API key needed | llama-3.1-8b |
| Local (Ollama) | Free, private | Slower, less accurate | llama3.1:8b |

### Telemetry

When opted-in, **fbl** sends anonymized friction patterns (types, categories, severity counts) to improve community recommendations. **Never sent**: code, transcripts, file paths, descriptions, or rules.

Disable anytime: `fbl config --telemetry off`

## Privacy

| What stays local | What's shared (opt-in only) |
|---|---|
| Source code | Friction types & categories |
| Transcripts | Severity counts |
| File paths | Suggestion targets |
| Descriptions & rules | Satisfaction signals |
| CLAUDE.md content | Hashed device ID |

## Requirements

- Node.js >= 22
- Claude Code installed
- An LLM provider (Anthropic API key, OpenRouter key, or Ollama running locally)

## License

[FSL-1.1-MIT](LICENSE) — Free to use, will become MIT on 2028-03-22.

## Contributing

Contributions welcome! Please open an issue first to discuss changes.
