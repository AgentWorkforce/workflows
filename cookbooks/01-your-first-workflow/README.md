# Cookbook 01 — Your First Workflow

> Soup to nuts: how to think about, write, run, and debug an Agent Relay workflow. Like learning to bake — by the end you'll understand the ingredients, the order of operations, and what to do when the cake doesn't rise.

**Who this is for:** anyone who has never written an Agent Relay workflow before, or who has written one and it didn't work and they don't know why.
**Time:** 45 minutes to read, a couple hours to finish your first real workflow.
**Yield:** a working understanding of the discipline — enough to author, run, and debug workflows on your own.

This cookbook uses [`repeatable/maintain-agent-rules/workflow.ts`](../../repeatable/maintain-agent-rules/) as its main worked example because it's small enough to hold in your head and real enough to teach you something. For more examples drawn from production usage, the [`AgentWorkforce/relay`](https://github.com/AgentWorkforce/relay) monorepo ships an entire directory of real workflows at `relay/workflows/` (e.g. `combined-workforce-relay.ts`, `relay-e2e-meta-workflow.ts`, `fix-broker-spawn-bugs.ts`) and SDK examples at `relay/packages/sdk/examples/communicate/` and `relay/examples/`. When this cookbook says *"see a real example of X"*, it usually means one of those files.

---

## 1. What is a workflow?

A **workflow** is a declarative description of a job that multiple AI agents and deterministic shell steps will cooperate to finish. You describe it as a **DAG** — a directed acyclic graph — where each node is a *step*, and edges are dependencies.

Think of a workflow like a recipe:

- **Agents** are the cooks — Claude, Codex, Gemini, each with their own strengths.
- **Steps** are the prep stations — mix the batter, melt the chocolate, check the oven.
- **Dependencies** are the order — you can't frost until it's baked, you can't bake until it's mixed, but you can melt chocolate *while* the batter is mixing.

The whole point of writing a workflow instead of running one agent with a big prompt is **control**. You get:

1. **Verifiable checkpoints.** Every step can have a deterministic gate that fails the whole run if something's off.
2. **Parallelism.** Independent steps run at the same time. Sequential workflows waste hours; good DAGs are 4–7x faster.
3. **Repeatability.** The same workflow, run again next week, does the same thing.
4. **Specialization.** Cheap model for analysis, expensive one for review, deterministic shell for file operations.

Workflows are worth the effort when the job has any of these traits: multi-file edits, multi-agent coordination, verification requirements, or a schedule. If the job is *"run one agent once with one prompt"*, you don't need a workflow — just run the agent.

---

## 2. The anatomy of a workflow file

Every workflow file in this repo (and in `relay/workflows/`) looks roughly like this:

```typescript
import { workflow } from '@agent-relay/sdk/workflows'
import { ClaudeModels, CodexModels } from '@agent-relay/config'

async function runWorkflow() {
  const result = await workflow('my-workflow')
    .description('what this does in one sentence')
    .pattern('dag')
    .channel('wf-my-workflow')
    .maxConcurrency(4)
    .timeout(3_600_000)

    // Agents — who's cooking
    .agent('analyst', { cli: 'codex', model: CodexModels.GPT_5_4, preset: 'worker' })
    .agent('lead',    { cli: 'claude', model: ClaudeModels.OPUS })
    .agent('writer',  { cli: 'codex',  model: CodexModels.GPT_5_4 })

    // Steps — the DAG
    .step('discover', { type: 'deterministic', command: '...' })
    .step('audit',    { agent: 'analyst', dependsOn: ['discover'], task: '...' })
    .step('apply',    { agent: 'writer',  dependsOn: ['audit'], task: '...' })

    .onError('fail-fast')
    .run({ cwd: process.cwd() })

  console.log('Workflow status:', result.status)
}

runWorkflow().catch((err) => { console.error(err); process.exit(1) })
```

Six things to notice:

1. **The file is a runnable script.** `agent-relay run workflow.ts` executes it as a subprocess. It does **not** inspect exports. If you don't call `.run()`, nothing happens.
2. **Top-level `await` is a landmine.** Wrap in `runWorkflow()` + `.catch()`. Some executor paths behave like CJS and top-level await fails cryptically.
3. **Model constants, not strings.** `ClaudeModels.OPUS`, not `'opus'`. Typos in strings silently resolve to "default."
4. **The channel is dedicated.** Give every workflow its own channel so messages don't leak between runs.
5. **`maxConcurrency` caps at 4–6.** Spawning 10+ agents causes broker timeouts.
6. **`.run({ cwd })` is the terminal call.** There is no `.build()`, no `createWorkflowRenderer`. One chain, one terminal `.run()`.

> Compare this with `relay/workflows/combined-workforce-relay.ts` — same shape, real agents, real steps. Read it next to this cookbook to see how the skeleton fills out in production.

---

## 3. Picking a pattern

The SDK supports many patterns — `dag`, `pipeline`, `hub-spoke`, `fan-out`, `supervisor`, `debate`, and more. For most workflows you want **`dag`**. Use others only when you have a specific reason:

| Pattern | Use when |
|---|---|
| `dag` | Default. You have some parallelism, some ordering, and want explicit dependencies. |
| `pipeline` | Strictly sequential. Each step needs the previous one's output. No parallelism. |
| `supervisor` / `hub-spoke` | Unreliable workers that need auto-monitoring and nudges. Only hub patterns auto-harden. |
| `fan-out` | Pure parallelism with a merge. Usually expressible as a `dag` — prefer `dag` for clarity. |
| `debate` | Two agents argue a decision. Rare. See `relay/workflows/debate-direct-model-harness.ts` for a real one. |

The `choosing-swarm-patterns` skill has the full taxonomy. **Don't blindly default to `dag`** — but also don't overthink it. If you're not sure, `dag` is fine.

---

## 4. Designing the steps

This is where most workflows live or die. Two rules to internalize:

### Rule A — One step, one deliverable

A step's task prompt should be **10–20 lines max**. If you're writing a 100-line task prompt, you're asking one agent to do the work of five, and it will forget half of it.

When the work is bigger than one agent can hold in its head:

- **Split into per-file steps** with verify gates between them. Agents reliably edit 1–2 files per step but fail on 4+.
- **Or use an interactive team** (lead + workers on a shared channel). The lead posts file-by-file assignments. The workers iterate. This is how `maintain-agent-rules` handles an unknown number of rule-file edits — see the `team-lead` + `team-writer` pair. It's also how several workflows in `relay/workflows/` handle multi-file refactors.

### Rule B — Deterministic over agentic whenever possible

If a step can be done with a shell command, do it with a shell command. Deterministic steps are free, instant, and reliable. Agents are expensive, slow, and sometimes wrong.

Look at `maintain-agent-rules`:

- `discover-scope` — deterministic `find` + `git diff`
- `snapshot-rules` — deterministic `cat`
- `audit-drift` — Codex agent (only because it needs judgment)
- `verify-drift-exists` — deterministic `grep`
- `team-lead` + `team-writer` — two interactive agents (only because applying edits needs judgment)
- `verify-writes` — deterministic `git diff`
- `commit-and-pr` — deterministic `git` + `gh`
- `pr-self-review` — Claude agent (only because the verdict needs judgment)

**Six of nine steps are deterministic.** The agents do the parts that genuinely need intelligence; the shell does everything else. Follow this ratio.

---

## 5. Dependencies and parallelism

`dependsOn` tells the runner what must finish before a step can start. Two steps with the **same** `dependsOn` run in **parallel**. Two steps where one depends on the other run **sequentially**.

```typescript
// Parallel: both start when 'discover' finishes
.step('audit-a', { dependsOn: ['discover'], ... })
.step('audit-b', { dependsOn: ['discover'], ... })

// Sequential: 'apply' waits for both audits
.step('apply', { dependsOn: ['audit-a', 'audit-b'], ... })
```

**The deadlock anti-pattern:** if a step has a task that says *"wait for worker X to finish"*, but step X has `dependsOn: ['that-step']`, you've just written a deadlock. Workers and their lead must share the same upstream dependency — they start at the same time, and the lead coordinates them via the channel.

```typescript
// WRONG — deadlock
.step('lead', { dependsOn: ['context'], task: 'wait for worker' })
.step('worker', { dependsOn: ['lead'], task: '...' })

// RIGHT — both start together
.step('lead', { dependsOn: ['context'], ... })
.step('worker', { dependsOn: ['context'], ... })
.step('next', { dependsOn: ['lead'], ... })
```

---

## 6. Verification gates

Every step that produces something should have a gate that proves it. Four types:

| Type | What it checks |
|---|---|
| `exit_code` | Step's shell command exited 0. Default for code-editing steps. |
| `file_exists` | A named file exists after the step. Best for file-creation steps. |
| `output_contains` | Step's output contains a substring. Use sparingly. |
| `custom` | A shell expression you write. |

**Prefer `exit_code` and `file_exists`.** They're deterministic and hard to fool. `output_contains` has a weird gotcha: if the token appears in the task prompt text, the runner requires it *twice* in output. Don't fight this — use `exit_code` instead.

The most useful deterministic gate is `git diff --quiet`:

```typescript
.step('verify-edit', {
  type: 'deterministic',
  dependsOn: ['edit-file'],
  command: 'if git diff --quiet src/foo.ts; then echo "NOT MODIFIED"; exit 1; fi',
  failOnError: true,
})
```

This fails fast if the agent said it edited a file but actually didn't. You will hit this — agents emit "DONE" markers confidently without having written anything. Always verify writes.

---

## 7. Safety rails: scope-locking

The single biggest risk with agentic workflows is **an agent does something it wasn't supposed to**. A drift-fixer accidentally edits a source file. A refactor deletes a whole directory. A commit step stages `.env` and `node_modules`.

Build safety rails at two layers:

### Layer 1 — Tell the agent its scope

In the task prompt:
```
- ONLY edit AGENTS.md, AGENTS.md.override, or .claude/rules/*.md
- Never touch source code
- Edit exactly one file per assignment
```

This catches 80% of mistakes. Agents respect explicit constraints when they're stated plainly.

### Layer 2 — Pathspec the commit

In the deterministic commit step:
```bash
git add -- '*AGENTS.md' '*AGENTS.md.override' '*/.claude/rules/*.md'
```

This catches the other 20%. Even if the agent went rogue and edited `src/foo.ts`, it never gets staged, because `git add` only matches the pathspec. The final commit contains only what the workflow was authorized to change.

**Both layers are cheap. Both are mandatory for any workflow that touches files in someone else's repo.** Never rely on agent instructions alone.

---

## 8. Running your workflow

Three commands, in order:

```bash
# 1. Dry-run — validates syntax without spawning agents
agent-relay run --dry-run repeatable/my-workflow/workflow.ts

# 2. Real run with DRY_RUN env var — runs the full DAG but skips side effects
DRY_RUN=true agent-relay run repeatable/my-workflow/workflow.ts

# 3. Live run — actually opens the PR
agent-relay run repeatable/my-workflow/workflow.ts
```

The distinction between `--dry-run` (syntax check, no agents) and `DRY_RUN=true` (full run, no side effects) matters. The first catches typos; the second catches logic bugs. Use both the first time you run a new workflow.

**Build a `DRY_RUN` env var into every workflow from day one.** In `maintain-agent-rules`, the `commit-and-pr` step checks for it and skips `git push` / `gh pr create` when it's set. This lets you run the full audit and see what *would* happen without actually touching the remote.

---

## 9. Debugging: what goes wrong, in order of likelihood

**1. Top-level await error.** Something like `Top-level await is currently not supported with the "cjs" output format`. Fix: wrap your `.run()` call in an `async function runWorkflow()` + `.catch()`.

**2. Agent exits 0 with no file written.** Most common failure. Agent said DONE, no file exists. Fix: use `file_exists` verification, and in the task prompt add `IMPORTANT: Write the file to disk. Do NOT output to stdout.` Use **absolute** paths — agents in one-shot mode sometimes run from a different cwd than you expect.

**3. Deadlock — workflow hangs forever.** A step's task says "wait for worker" but also depends on that worker. See the deadlock anti-pattern above.

**4. Interactive agent's stdout is garbled when chained via `{{steps.X.output}}`.** Interactive agents emit PTY chrome (spinners, ANSI). Fix: have the agent write to a file, then read it in a deterministic step. Or use `preset: 'worker'` for clean stdout — but only in one-shot patterns, not interactive team patterns.

**5. Broker timeout with "too many agents."** You went over `maxConcurrency: 6` or spawned 10+ agents at once. Cap at 4–6.

**6. `exit_code` auto-passes despite the agent doing nothing.** It passes if the agent exits 0 without errors, even if nothing happened. Use `file_exists` or `git diff --quiet` for anything that should produce a file change.

**7. Workflow completes but the output looks wrong.** Add a **self-review step** as your final step — an independent reviewer agent that reads the actual diff and flags over-reach. This catches things verification gates miss.

When you're really stuck, read a working example in `relay/workflows/` and compare its structure to yours side by side. The anti-patterns are subtle until you've seen the good version.

---

## 10. Scheduling: running it continuously

Three tiers, in order of maturity:

**Tier 1 — manual.** You run it. `agent-relay run` from your laptop. Good for testing, bad for production.

**Tier 2 — CI.** A GitHub Actions job runs it on a cron or on push. Works today. Example skeleton in each `repeatable/*/README.md`.

**Tier 3 — cloud.** `AgentWorkforce/cloud` ("Easy agent infra") will eventually run workflows on schedules with managed infrastructure. Not active yet — each repeatable workflow in this repo has a `cloud-schedule.ts` stub showing the intended registration shape. When cloud lands, swap tier 2 for tier 3.

Build for tier 2 today; document tier 3 for tomorrow.

---

## 11. What makes a workflow *good*

After you've written a few, you'll develop taste. Early signs of a good workflow:

- **Every agent step is short.** 10–20 lines. If you're writing 50-line task prompts, split the step.
- **Most steps are deterministic.** Agents for judgment, shell for everything else. Aim for a 60/40 ratio in favor of shell.
- **Every write is verified.** No step trusts an agent's "DONE" — every write is followed by a `git diff --quiet` or `file_exists` check.
- **Safety rails are belt-and-suspenders.** Both in the task prompt and at the commit pathspec.
- **The final step is a self-review.** An independent reviewer reads the actual output and says PASS or FAIL.
- **`DRY_RUN=true` mode exists and is documented.** You can run the full workflow with no side effects.
- **The workflow is idempotent.** Running it twice on the same state produces the same result. Running it after its own PR merges produces no changes.

---

## 12. Next steps

Read these in order:

1. **`writing-agent-relay-workflows` skill** — the canonical API reference. Skim before authoring anything, grep when something surprises you.
2. **`choosing-swarm-patterns` skill** — when you outgrow `dag`.
3. **`repeatable/maintain-agent-rules/workflow.ts`** — the worked example in this repo. Read top to bottom with this cookbook open alongside.
4. **`relay/workflows/`** — a library of real, production workflows. Good ones to start with:
   - `combined-workforce-relay.ts` — multi-agent coordination
   - `fix-broker-spawn-bugs.ts` — bug-fix workflow with capture-reproduce-verify structure
   - `relay-e2e-meta-workflow.ts` — meta-workflow that chooses its own approach
   - `explore-swarm-patterns.ts` — how to pick a pattern
5. **`relay/packages/sdk/examples/communicate/`** and **`relay/examples/`** — lower-level SDK usage when you need to go under the workflow abstraction.
6. **Other cookbooks in this directory** — each zooms into a specific technique (debugging, scheduling, interactive teams, safety rails, wave planning).

Then write one. Start small — two agents, three steps. Get it running. Add a verification gate. Add a `DRY_RUN` mode. Add a self-review step. Run it against a real repo with `DRY_RUN=true`. Read the output. Fix what's wrong. Run it for real.

That's baking a cake.
