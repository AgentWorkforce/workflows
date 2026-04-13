# maintain-agent-rules

A repeatable Agent Relay workflow that keeps a repo's agent instruction files honest against the actual code.

## What it touches

Only these three file types, anywhere in the target repo:

- `AGENTS.md`
- `AGENTS.md.override`
- `.claude/rules/*.md`

Source code, tests, build configs, and everything else are **never** modified.

## Why

Agent instruction files drift. A rule says "use `workspace.getMessages()`" but the SDK renamed it six months ago. A new directory gets added with its own conventions but nobody writes them down. A `NEVER do X` rule is contradicted by code that now does X.

Manual audits don't scale. This workflow runs on a schedule, detects drift, and opens a PR with the fixes.

## How it works

```
discover-scope ── snapshot-rules ── audit-drift ── verify-drift-exists ─┐
                                                                        ├── team-lead ──┐
                                                                        └── team-writer ┴── verify-writes ── commit-and-pr ── pr-self-review
```

1. **discover-scope** (deterministic) — lists directories touched since `SINCE_REF` and every existing rule file in the repo.
2. **snapshot-rules** (deterministic) — reads every rule file into a single blob that the analyst consumes without needing filesystem access.
3. **audit-drift** (Codex analyst) — produces `.trail/rules-drift.md` with a per-file drift report. If nothing is drifting, writes `NO_DRIFT_DETECTED` and the workflow exits clean.
4. **verify-drift-exists** (deterministic) — fail-fast gate: ensures the drift report exists and is non-empty.
5. **team-lead** + **team-writer** (Claude lead + Codex writer on a shared channel) — interactive team pattern. Lead assigns file edits one at a time, writer applies them, lead verifies before moving on. See the `writing-agent-relay-workflows` skill for why interactive teams beat one-shot fan-out for multi-file edits.
6. **verify-writes** (deterministic) — confirms `git diff` shows real changes to rule files (and only rule files).
7. **commit-and-pr** (deterministic) — branches, commits, pushes, and opens a PR with the drift report as the body.
8. **pr-self-review** (Claude reviewer) — reads the diff and flags over-reach or hallucinated rules.

## Inputs (env vars)

| Var | Default | Meaning |
|---|---|---|
| `TARGET_REPO_DIR` | `process.cwd()` | Absolute path to the repo being audited |
| `SINCE_REF` | `HEAD~50` | Git ref for "recently touched" directories |
| `DRY_RUN` | `false` | If `true`, skip commit and PR — useful for first runs |
| `BASE_BRANCH` | `main` | Branch to open the PR against |

## Running locally

```bash
# Validate the workflow file (no agents spawned):
agent-relay run --dry-run workflow.ts

# First run against a real repo, no commit:
TARGET_REPO_DIR=/path/to/repo DRY_RUN=true agent-relay run workflow.ts

# Live run — opens a PR:
TARGET_REPO_DIR=/path/to/repo agent-relay run workflow.ts
```

## Running via cloud (inactive until AgentWorkforce/cloud is wired up)

This workflow is designed to run on a schedule via `AgentWorkforce/cloud` (the "Easy agent infra" runtime). See `cloud-schedule.ts` in this directory for the intended registration shape. Once cloud is live, one schedule per target repo runs this workflow on a configurable cadence (daily, weekly, per-PR-merge, etc.).

Until cloud is active, run the workflow locally or from CI via `agent-relay run`.

## Outputs

- `.trail/rules-scope.txt` — the scope scan
- `.trail/rules-snapshot.md` — raw rule-file contents at audit time
- `.trail/rules-drift.md` — structured drift report (also the PR body)
- `.trail/pr-url.txt` — URL of the opened PR (if not dry run)

## Safety rails

- **Scope lock:** `commit-and-pr` only `git add`s paths matching `*AGENTS.md`, `*AGENTS.md.override`, and `*/.claude/rules/*.md`. Any accidental source-code edits by the writer agent are rejected at commit time.
- **No-drift exit:** if the analyst finds nothing wrong, the workflow exits clean at `verify-drift-exists` without calling any interactive agents.
- **Self-review gate:** the final step is an independent reviewer that checks the diff against the drift report. A FAIL verdict surfaces in the PR as a comment.
- **One file per edit:** the writer agent is instructed to edit exactly one file per assignment, following the multi-file-edit pattern from `writing-agent-relay-workflows`.

## Tuning

- **Too noisy?** Raise `SINCE_REF` to narrow the audit window, or add exclusion globs to the `find` commands in `discover-scope`.
- **Too slow?** Lower `maxConcurrency` is already at 4. The bottleneck is the sequential edit loop, which is intentional for correctness.
- **Wrong file type scope?** Edit the `find` commands in `discover-scope` and `snapshot-rules`, and the glob in `commit-and-pr`. Keep the three locations in sync.

## Related

- General workflow-authoring tutorial: [`cookbooks/01-your-first-workflow/`](../../cookbooks/01-your-first-workflow/) — uses this workflow as its worked example
- Pattern reference: `.claude/skills/writing-agent-relay-workflows/SKILL.md` (in any consumer repo)
- More real-world workflow examples: [`AgentWorkforce/relay`](https://github.com/AgentWorkforce/relay) → `workflows/`, `examples/`, `packages/sdk/examples/`
