# workflows

Public home for Agent Relay workflows we run across our repos, plus soup-to-nuts cookbooks that teach you how to use them.

## What's here

```
workflows/
├── repeatable/        # runnable workflows meant to execute on a schedule across repos
│   └── maintain-agent-rules/
└── cookbooks/         # narrative walkthroughs — how to bake a cake
    └── 01-maintain-agent-rules/
```

**`repeatable/`** — each subdirectory is one workflow. Every workflow is a single `workflow.ts` file you can execute directly with `agent-relay run`, plus a README describing inputs, outputs, and safety rails. These are designed to run continuously (via cron, CI, or eventually [`AgentWorkforce/cloud`](https://github.com/AgentWorkforce)) against any target repo.

**`cookbooks/`** — numbered, step-by-step tutorials. Each cookbook walks you from "I have never heard of this" to "I am running this in production on a schedule." Cookbooks reference the workflows in `repeatable/` but focus on the *why*, the *ingredients*, and the gotchas you only hit on your first run.

## Why this exists

Repos that host AI agents need ongoing hygiene: rules drift, instructions go stale, build commands rot. Manual maintenance doesn't scale. These workflows are the maintenance bots we run against our own repos — published so anyone else can run them too.

We build in public. Contributions welcome.

## Running a workflow

Every workflow in `repeatable/` works the same way:

```bash
gh repo clone AgentWorkforce/workflows
cd workflows/repeatable/<workflow-name>
agent-relay run --dry-run workflow.ts   # validate
TARGET_REPO_DIR=/path/to/target agent-relay run workflow.ts   # run
```

See each workflow's README for required env vars and inputs.

## Current workflows

| Workflow | Purpose | Cookbook |
|---|---|---|
| [`maintain-agent-rules`](repeatable/maintain-agent-rules/) | Audit and update `AGENTS.md`, `AGENTS.md.override`, and `.claude/rules/` files against current code | [01](cookbooks/01-maintain-agent-rules/) |

More coming.

## Cookbook format

Each cookbook is a single `README.md` in `cookbooks/NN-<slug>/` with the following shape:

1. **The problem** — why this exists, with a concrete example
2. **Ingredients** — prerequisites, CLIs, API keys
3. **Step 1: Clone the recipe** — get the workflow
4. **Step 2: Dry-run** — validate before committing to changes
5. **Step 3: The live run** — end-to-end
6. **Step 4: Read the output** — what to expect
7. **Step 5: Schedule it** — how to run continuously
8. **Step 6: Tuning** — knobs to turn
9. **Step 7: Troubleshooting** — common failures

If you contribute a new cookbook, keep this shape. Readers bounce between cookbooks and recognize the structure.

## Contributing a new repeatable workflow

1. Read `writing-agent-relay-workflows` skill — it's the source of truth for the DAG/step/agent API and the anti-patterns.
2. Add your workflow under `repeatable/<slug>/` with a `workflow.ts`, a `README.md`, and (optionally) a `cloud-schedule.ts` stub if it's meant to run on a schedule.
3. Add a matching cookbook under `cookbooks/NN-<slug>/` following the format above.
4. Open a PR.

**Constraints for repeatable workflows:**

- Must work on any repo, not just ours — parameterize via env vars, not hardcoded paths.
- Must have a `DRY_RUN=true` mode that runs the full audit without making commits.
- Must pin its scope (file globs, path filters) so it cannot accidentally touch files outside its mandate.
- Must open a PR rather than pushing to a branch directly — humans merge, bots propose.
- Must include a self-review step as the final gate.

## License

MIT.
