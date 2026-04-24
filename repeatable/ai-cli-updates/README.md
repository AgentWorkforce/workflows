# ai-cli-updates

A purely deterministic workflow that installs or updates the local AI CLIs used
by the AgentWorkforce toolchain.

## What it updates

| CLI | Installer | Post-install command check |
|---|---|---|
| Cursor | `curl https://cursor.com/install -fsS \| bash -s -- agent` | `command -v agent` |
| Factory Droid | `curl -fsSL https://app.factory.ai/cli \| sh -s -- droid` | `command -v droid` |
| Gemini | `npm install -g --force @google/gemini-cli@latest` | `command -v gemini` |
| Claude Code | upgrade/reinstall the installed `claude-code` or `claude-code@latest` cask | `command -v claude` |
| Codex | `npm install -g --force @openai/codex@latest` | `command -v codex` |
| OpenCode | `npm install -g --force opencode-ai@latest` | `command -v opencode` |

The workflow has no agents. Every installer is a `type: 'deterministic'` step.

## Why sequential

These commands mutate global machine state: shell-script installer locations,
global npm packages, and Homebrew. The workflow runs them one at a time with
`maxConcurrency(1)` so package-manager locks and PATH changes do not race.

Each installer writes a status file and exits 0 so the workflow attempts every
CLI even if one fails. The final `summary` step reads those status files and
fails the run if any CLI ended in `FAIL_*`.

For Droid, if an existing `droid` executable is already on `PATH`, the workflow
moves it to a timestamped `.bak-<timestamp>` path before running Factory's
installer. This handles broken/stale binaries while keeping the previous file
recoverable.

## Inputs

| Var | Default | Meaning |
|---|---|---|
| `AI_CLI_UPDATES_DRY_RUN` | `false` | `true` prints commands and records status without installing |
| `DRY_RUN` | `false` | Also honored, but some Agent Relay runners treat it as workflow planning only |
| `AI_CLI_UPDATES_ONLY` | all CLIs | Optional comma-separated subset: `cursor,droid,gemini,claude,codex,opencode` |

## Running

```bash
# Validate the workflow file without executing installers:
agent-relay run --dry-run repeatable/ai-cli-updates/workflow.ts

# Exercise every step but skip mutation:
AI_CLI_UPDATES_DRY_RUN=true agent-relay run repeatable/ai-cli-updates/workflow.ts

# Update everything:
agent-relay run repeatable/ai-cli-updates/workflow.ts

# Update only npm-backed CLIs:
AI_CLI_UPDATES_ONLY=gemini,codex,opencode agent-relay run repeatable/ai-cli-updates/workflow.ts
```

## Outputs

Each run writes logs under a timestamped directory:

```text
repeatable/ai-cli-updates/.trail/<timestamp>/
├── ready.txt
├── cursor.txt
├── droid.txt
├── gemini.txt
├── claude.txt
├── codex.txt
└── opencode.txt
```

Every per-tool log ends with a `result:` line:

- `UPDATED`
- `DRY_RUN`
- `FAIL_MISSING_TOOL`
- `FAIL_INSTALL`
- `FAIL_NOT_ON_PATH`
