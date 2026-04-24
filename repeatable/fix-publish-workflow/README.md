# fix-publish-workflow

A single-persona repeatable that rewrites a repo's `.github/workflows/publish.yml` to use OIDC npm trusted publishing instead of `NODE_AUTH_TOKEN` / `NPM_TOKEN` secrets.

## What it touches

Only `.github/workflows/publish.yml` in the target repo. Nothing else.

## How it works

Unlike the DAG-style repeatables in this directory, this is a thin wrapper around `usePersona('npm-provenance').sendMessage(...)` from `@agentworkforce/workload-router`. The persona owns the edit logic; this file just points it at a target repo.

The persona is instructed to:

1. Remove all `NODE_AUTH_TOKEN` / `NPM_TOKEN` secret references — OIDC only.
2. Ensure job permissions include `id-token: write` and `contents: read`.
3. Ensure `npm publish` uses `--provenance --access public`.
4. Preserve the existing `workflow_dispatch` inputs (`package`, `version`, `tag`, `dry_run`) and the multi-package publishing loop.
5. Keep the version bump and git commit steps.
6. Pin Node to exactly `22.14.0` in the `setup-node` step — other Node 22 releases have a known issue with npm trusted publishing / provenance.

## Inputs (env vars)

| Var | Default | Meaning |
|---|---|---|
| `TARGET_REPO_DIR` | `process.cwd()` | Absolute path to the repo whose `publish.yml` should be fixed |
| `TIMEOUT_SECONDS` | `600` | Persona execution timeout |

## Running locally

```bash
# Against a specific repo:
TARGET_REPO_DIR=/path/to/repo agent-relay run workflow.ts

# Example — fix relayfile-providers:
TARGET_REPO_DIR=../../../relayfile-providers agent-relay run workflow.ts
```

The persona writes the fixed file directly to disk in `TARGET_REPO_DIR/.github/workflows/publish.yml`. Review with `git diff` afterwards and commit manually.
