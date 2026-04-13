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

**`cookbooks/`** — numbered, narrative tutorials on **the discipline of writing and operating workflows**. Not per-workflow walkthroughs — cookbooks teach general techniques (your first workflow, debugging, scheduling, interactive teams, safety rails, wave planning) using the workflows in `repeatable/` and real examples from [`AgentWorkforce/relay`](https://github.com/AgentWorkforce/relay) as teaching material. Read them when learning or when something confuses you; skip them when you know what you're doing.

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

| Workflow | Purpose |
|---|---|
| [`maintain-agent-rules`](repeatable/maintain-agent-rules/) | Audit and update `AGENTS.md`, `AGENTS.md.override`, and `.claude/rules/` files against current code |
| [`prpm-hygiene`](repeatable/prpm-hygiene/) | Install `collections/agent-relay-starter` and run `prpm update` across every AgentWorkforce repo, opening one PR per repo that changed |

More coming.

## Current cookbooks

| # | Cookbook | Topic |
|---|---|---|
| [01](cookbooks/01-your-first-workflow/) | Your First Workflow | Learn to author, run, and debug a workflow from scratch |

Planned: debugging a failing workflow · scheduling workflows (CI / cron / cloud) · interactive teams vs one-shot DAGs · safety rails and scope-locking · wave planning for parallel execution.

## Cookbook format

Cookbooks teach the **discipline** of workflows, not how to operate one specific workflow. Each cookbook is a single `README.md` in `cookbooks/NN-<slug>/` that walks a reader from "I don't get it" to "I can do this on my own" for one general technique. Use workflows from `repeatable/` (and from the [`AgentWorkforce/relay`](https://github.com/AgentWorkforce/relay) monorepo's `workflows/` and `examples/` directories) as worked examples, but the goal is teaching the technique — not documenting one specific recipe.

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
