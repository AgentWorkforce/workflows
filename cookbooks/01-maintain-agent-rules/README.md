# Cookbook 01 — Maintain Agent Rules

> Soup to nuts: how to bake a repo that keeps its own agent instructions fresh.

**Time:** ~20 minutes for first run, zero minutes after that.
**Difficulty:** Easy if you've ever opened a PR from the command line.
**Yield:** One automated PR per drift cycle that updates `AGENTS.md`, `AGENTS.md.override`, and `.claude/rules/` files against the actual code.

---

## The problem

You have a repo that agents work in. You wrote `AGENTS.md` files and `.claude/rules/` files to tell them how things are done here — "NEVER use raw SDK calls in handlers," "always use `workspace.getMessages()`," "affiliate link injection is post-processing only."

Six months later:
- Half the rules reference functions that were renamed.
- A new `packages/comparison/` directory has conventions that nobody wrote down.
- A rule says "NEVER X" but five files in the new code do X on purpose because the constraint was lifted.
- An override file is pinned to a build command that no longer exists.

Agents reading these files confidently follow outdated instructions. Humans reading them don't trust them, so they ignore them entirely. **The rules are worse than useless — they're actively misleading.**

Manual audits work once. They don't scale. What you want is a bot that runs on a schedule, compares the rules against the actual code, and opens a PR when it finds drift.

That's this cookbook.

---

## Ingredients

- A repo with some combination of `AGENTS.md`, `AGENTS.md.override`, or `.claude/rules/*.md` files (target repo)
- [`agent-relay`](https://github.com/AgentWorkforce) CLI installed
- `gh` CLI authenticated and able to push to the target repo
- Node.js 18+
- One API key for whichever Claude/Codex models your `agent-relay` is configured to use
- **Eventually:** access to `AgentWorkforce/cloud` for scheduled runs (not yet active — see step 5)

---

## Step 1 — Clone the recipe

```bash
gh repo clone AgentWorkforce/workflows ~/AgentWorkforce/workflows
cd ~/AgentWorkforce/workflows
```

Open `repeatable/maintain-agent-rules/workflow.ts` and skim it. The DAG is documented at the top. The three file types it touches — `AGENTS.md`, `AGENTS.md.override`, `.claude/rules/*.md` — are hardcoded in the `find` commands of `discover-scope` and `snapshot-rules`. Nothing else in the repo is ever modified.

---

## Step 2 — Dry-run against a test repo

Pick a target repo. Start with `DRY_RUN=true` — this runs the full audit and generates the drift report, but skips the commit and PR. You see exactly what the workflow *would* change before you let it change anything.

```bash
cd ~/AgentWorkforce/workflows/repeatable/maintain-agent-rules

TARGET_REPO_DIR=/absolute/path/to/your/repo \
SINCE_REF=HEAD~100 \
DRY_RUN=true \
agent-relay run workflow.ts
```

You'll see the DAG step through:

1. `discover-scope` prints the list of touched directories and existing rule files.
2. `snapshot-rules` concatenates every rule file's contents.
3. `audit-drift` spawns the Codex analyst. It reads the snapshot, cross-references against the code paths in scope, and writes a structured report to `.trail/rules-drift.md`.
4. `verify-drift-exists` confirms the report is non-empty. If the analyst found nothing, it writes `NO_DRIFT_DETECTED` and the workflow exits clean — you're done, no PR needed.
5. If drift exists, `team-lead` (Claude Opus) and `team-writer` (Codex) join a shared channel. The lead posts file-by-file assignments from the drift report. The writer edits exactly one file per assignment. The lead verifies each write before moving on.
6. `verify-writes` confirms `git diff` shows real changes — and **only** in the three permitted file types.
7. `commit-and-pr` normally creates a branch and opens a PR, but because `DRY_RUN=true` it prints the `git diff --stat` and exits.

Read `.trail/rules-drift.md` in the target repo. This is the report the real run will use as the PR body. If it looks reasonable, proceed. If the analyst hallucinated rules or missed obvious drift, go to **Step 6 — Tuning**.

---

## Step 3 — The live run

Once the dry run looks right:

```bash
TARGET_REPO_DIR=/absolute/path/to/your/repo \
SINCE_REF=HEAD~100 \
agent-relay run workflow.ts
```

The workflow runs end-to-end. The final steps:

- Creates a branch named `chore/maintain-agent-rules-<timestamp>`.
- Commits only files matching `*AGENTS.md`, `*AGENTS.md.override`, `*/.claude/rules/*.md`. Any accidental source-code edits by the writer agent are silently dropped at this stage.
- Pushes the branch with `-u origin`.
- Opens a PR with the drift report as the body.
- The reviewer agent reads the diff and produces a PASS/FAIL verdict.

You end up with one PR containing the drift summary, the actual file edits, and a self-review verdict. A human still merges it — this workflow is not an autonomous merger, it's an auditor that proposes changes.

---

## Step 4 — Read the PR

The PR body is the drift report. It's structured as:

```
## Summary
- files_audited: 23
- files_with_drift: 4
- new_rules_to_add: 2

## Drift per file
### packages/core/src/relay/AGENTS.md
- Status: drift
- Issues:
  - Rule "use workspace.getMessages()" — method was renamed to workspace.messages.list() in SDK 2.0
  - References packages/core/src/relay/legacy.ts which was deleted in commit abc123
- Proposed edits:
  - Replace `workspace.getMessages()` with `workspace.messages.list()`
  - Remove the paragraph about `legacy.ts`

## New rules to add
- File: packages/comparison/AGENTS.md
- Rule: Comparison handler must detect two-product queries via detector.ts — never silently fall back to multi-product
- Evidence: packages/comparison/detector.ts exports a detectComparison() function used in every handler
```

Scan the report. Every prescribed edit should map to a real diff in the PR. If you see edits in the diff that are *not* described in the drift report, the writer went off-script — the self-review step should have caught it, but double-check. Reject the PR and tune.

---

## Step 5 — Wire it to a schedule (when cloud lands)

Until `AgentWorkforce/cloud` publishes its scheduling API, "continuous" hygiene means running the workflow from CI (a weekly GitHub Actions job, a local cron, a pre-release gate).

Sketch of a weekly GitHub Actions job:

```yaml
# .github/workflows/agent-rules-hygiene.yml
name: agent-rules-hygiene
on:
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm i -g @agent-relay/cli
      - name: Checkout workflows repo
        run: gh repo clone AgentWorkforce/workflows /tmp/workflows
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Run maintain-agent-rules
        env:
          TARGET_REPO_DIR: ${{ github.workspace }}
          SINCE_REF: HEAD~100
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: agent-relay run /tmp/workflows/repeatable/maintain-agent-rules/workflow.ts
```

When cloud is live, the same workflow file becomes a one-line registration against cloud's scheduler — see `repeatable/maintain-agent-rules/cloud-schedule.ts` for the intended shape.

---

## Step 6 — Tuning

**The analyst hallucinated a rule that isn't real.** Lower the model temperature if your `agent-relay` config exposes it. More effective: narrow `SINCE_REF` so the analyst sees less context, or add an exclusion glob in `discover-scope` to hide directories that are known to be stable.

**The analyst missed obvious drift.** Widen `SINCE_REF` (e.g. `HEAD~500` or a release tag). Consider splitting the repo into multiple targets — running the workflow on one package at a time produces tighter reports than one run across a giant monorepo.

**The writer touched a file it shouldn't have.** The `commit-and-pr` step's pathspec (`'*AGENTS.md' '*AGENTS.md.override' '*/.claude/rules/*.md'`) is the final safety net. If you're seeing non-rule files land in PRs, that means the pathspec is wrong — check it.

**The workflow keeps proposing the same edit over and over across runs.** Some rule is aspirational ("we plan to migrate to X") and the code isn't there yet. Either update the rule to describe current state, or mark it with a `<!-- aspirational: ... -->` comment and add a skip pattern in `audit-drift`'s task prompt.

**Runs are too slow.** Most time is in the Codex analyst reading the snapshot. If your repo has >50 rule files, consider sharding: split by top-level directory and run multiple copies of the workflow in parallel, each with a narrower scope.

---

## Step 7 — Troubleshooting

**`verify-drift-exists` fails with "drift report is empty".** The analyst exited without writing the file. Check agent logs — usually a path issue. `TARGET_REPO_DIR` must be absolute.

**`verify-writes` fails with "drift report had work but no files were changed".** The writer agent couldn't apply edits (permissions, wrong path, disagreement it couldn't resolve). Check the channel transcript — the lead should have logged the disagreement.

**`commit-and-pr` fails at `gh pr create`.** Usually authentication. Run `gh auth status` in the target repo. The workflow runs `gh` as whatever user the environment is authenticated as — make sure that user can push to the target repo and open PRs.

**The self-review posts FAIL but the diff looks fine.** The reviewer is conservative by design. Read its specific complaint — often it's catching a real subtlety (a new rule that contradicts an old one elsewhere in the file).

---

## What this gives you

A repo that audits its own agent instructions every week, automatically. When rules drift, you get a PR. When they don't, you get nothing. Agents (and humans) can trust the rules again because someone is actively checking them.

The total ongoing cost is one weekly run of one Claude Opus lead, one Codex analyst, one Codex writer, and one Claude Sonnet reviewer — roughly the cost of one medium PR review on average.

---

## Next

- [ ] Run against all your repos
- [ ] Schedule via cron, then via cloud when it's ready
- [ ] Propose additional cookbooks by opening an issue on `AgentWorkforce/workflows`
