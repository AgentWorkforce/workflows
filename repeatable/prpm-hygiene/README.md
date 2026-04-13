# prpm-hygiene

A purely deterministic repeatable workflow that keeps every AgentWorkforce repo current on the `agent-relay-starter` prpm collection and the latest versions of its prpm packages.

## What it does

For each repo listed in [`repos.txt`](./repos.txt):

1. **Refuses to proceed** if the working tree is dirty, the repo isn't checked out to `main`, or the directory doesn't exist — your WIP is never disturbed.
2. **Pulls latest `main`** and creates a throwaway branch `chore/prpm-hygiene-<timestamp>`.
3. **Runs** `prpm install collections/agent-relay-starter --as codex,claude --yes`.
4. **Runs** `prpm update --all` to bring all existing packages to their latest compatible versions.
5. **If anything changed**, commits, pushes, and opens a PR.
6. **If nothing changed**, throws away the branch and records "already up to date."

All per-repo work runs in **parallel**, capped at `maxConcurrency: 4`. One failing repo does not stop the others. The final `summary` step aggregates every repo's result into one readable table.

## Why purely deterministic

There's no decision an LLM needs to make here. `prpm install` and `prpm update` are deterministic commands with deterministic outputs. "Did anything change?" is `git status --porcelain`. "Open a PR" is `gh pr create`. Wrapping this in agent prompts would add cost, latency, and randomness without adding value.

So: zero agents, every step is `type: 'deterministic'`. The workflow format is still worth using because it gives us:

- **Parallelism** — one step per repo, fan-out from a shared `validate-tooling` step
- **Failure isolation** — `onError('continue')` so one broken repo doesn't stop the others
- **Uniform scheduling path** — same `agent-relay run` command as every other workflow, same future `cloud-schedule.ts` wiring
- **Status aggregation** — the `summary` step reads per-repo `.trail/` files and produces a single verdict

## Inputs (env vars)

| Var | Default | Meaning |
|---|---|---|
| `PARENT_DIR` | parent of this workflows repo | Absolute path containing the target repos |
| `REPOS_FILE` | `./repos.txt` (next to `workflow.ts`) | Path to the repo list |
| `DRY_RUN` | `false` | `true` → run install/update but discard changes without committing |
| `BASE_BRANCH` | `main` | Branch to base PRs against |

## The repo list

[`repos.txt`](./repos.txt) is a simple newline-delimited file. `#` starts a comment. Currently active by default:

- **Core products** — relay, relayed, relaycast, relaycron, cloud, relayauth, relayfile, relayfile-cloud, relayfile-adapters, relayfile-providers
- **Infra and shared** — workforce, workflows
- **Other active** — trajectories, nightcto, sage

**Explicitly skipped:** the `skills` repo (it *publishes* skills rather than consuming them), `docs`, and all the SDK / tooling repos (`relay-sdk`, `relay-broker`, `relay-dashboard`, `relay-tui`, `relay-pulse`, `relay-examples`, `relay-pty-visualizer`, `relay-visualizer`, `agent-relay-vscode`, `vscode-acp`, `agent-trace`) — these ship prpm packages, they don't consume the starter collection.

Experimental / research / one-off repos are commented out. Uncomment to include them. Add new repos by appending to the file — one repo per line.

## Running

```bash
# Validate the workflow file (no shell executed):
agent-relay run --dry-run workflow.ts

# Full run with changes discarded per repo:
DRY_RUN=true agent-relay run workflow.ts

# Live run — opens PRs:
agent-relay run workflow.ts
```

## Safety rails

- **Refuses to touch dirty repos.** If `git diff --quiet HEAD` fails, the repo is skipped with `SKIP_DIRTY`.
- **Refuses to touch non-main branches.** If the user has a feature branch checked out, we leave it alone (`SKIP_WRONG_BRANCH`).
- **Cleans up its own branches on no-op.** If `prpm install` + `prpm update` produce no diff, the branch is deleted so we don't clutter the repo.
- **Opens PRs, never pushes to main.** Humans review and merge.
- **Per-repo failure isolation.** `onError('continue')` so one bad repo doesn't take down the other 24.

## Outputs

Per run, a timestamped directory under `.trail/`:

```
.trail/<timestamp>/
├── ready.txt              # preflight marker
├── relay.txt              # one status file per repo
├── relayed.txt
├── ...
```

Each per-repo status file contains the full log of what happened, ending with a `result:` line — `PR_OPENED`, `NOOP`, `SKIP_DIRTY`, `SKIP_WRONG_BRANCH`, `SKIP_NOT_FOUND`, `SKIP_NOT_GIT`, `DRY_RUN_CHANGES`, or `FAIL_*`.

The `summary` step aggregates all of these into a bucketed report printed at the end of the run, and exits non-zero if any repo landed in a `FAIL_*` bucket.

## Scheduling

Until `AgentWorkforce/cloud` scheduling is live, the natural way to run this continuously is a weekly GitHub Actions job in this `workflows` repo itself. Sketch:

```yaml
# .github/workflows/prpm-hygiene.yml
name: prpm-hygiene
on:
  schedule:
    - cron: '0 8 * * 1'  # every Monday 8am UTC
  workflow_dispatch:
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm i -g prpm @agent-relay/cli
      # Clone every target repo under ../ so PARENT_DIR resolves correctly.
      - name: Clone targets
        run: |
          mkdir -p ../AgentWorkforce
          while read -r repo; do
            [ -z "$repo" ] || [[ "$repo" == \\#* ]] && continue
            gh repo clone "AgentWorkforce/$repo" "../AgentWorkforce/$repo" || true
          done < repeatable/prpm-hygiene/repos.txt
        env:
          GH_TOKEN: ${{ secrets.HYGIENE_GH_TOKEN }}
      - run: agent-relay run repeatable/prpm-hygiene/workflow.ts
        env:
          PARENT_DIR: ${{ github.workspace }}/../AgentWorkforce
          GH_TOKEN: ${{ secrets.HYGIENE_GH_TOKEN }}
```

When cloud lands, replace the manual clone loop with cloud's managed target repos — see `cloud-schedule.ts` for the intended shape.

## Related

- General workflow-authoring tutorial: [`cookbooks/01-your-first-workflow/`](../../cookbooks/01-your-first-workflow/)
- Rules maintenance workflow: [`repeatable/maintain-agent-rules/`](../maintain-agent-rules/)
