/**
 * maintain-agent-rules
 *
 * Continuous repo hygiene: audit and update agent instruction files against
 * the actual state of the codebase.
 *
 * Scope (only these three file types are touched):
 *   - AGENTS.md               (any directory)
 *   - AGENTS.md.override      (any directory)
 *   - .claude/rules/*.md      (any directory under .claude/rules/)
 *
 * How it works (DAG):
 *   1. discover-scope       — deterministic: list changed dirs + existing rule files
 *   2. snapshot-rules       — deterministic: cat all rule files into a single blob
 *   3. audit-drift          — analyst: produces .trail/rules-drift.md
 *   4. verify-drift-exists  — deterministic: fail fast if drift report is empty
 *   5. team-lead            — lead (interactive Claude): coordinates edits on channel
 *   6. team-writer          — writer (interactive Codex): applies per-file edits
 *   7. verify-writes        — deterministic: git diff --stat must be non-empty
 *   8. commit-and-pr        — deterministic: branch, commit, push, gh pr create
 *   9. pr-self-review       — reviewer: reads the PR diff, flags over-reach
 *
 * Inputs (via env vars):
 *   TARGET_REPO_DIR   absolute path to the repo to audit (default: process.cwd())
 *   SINCE_REF         git ref to diff against for "recently touched" (default: HEAD~50)
 *   DRY_RUN           "true" to skip commit/PR (default: "false")
 *   BASE_BRANCH       PR base branch (default: "main")
 *
 * Run locally:
 *   TARGET_REPO_DIR=/path/to/repo agent-relay run --dry-run workflow.ts
 *   TARGET_REPO_DIR=/path/to/repo agent-relay run workflow.ts
 *
 * Run via cloud (when AgentWorkforce/cloud is wired up):
 *   See ../../cookbooks/01-maintain-agent-rules/README.md
 */

import { workflow } from '@agent-relay/sdk/workflows'
import { ClaudeModels, CodexModels } from '@agent-relay/config'

const TARGET_REPO_DIR = process.env.TARGET_REPO_DIR ?? process.cwd()
const SINCE_REF = process.env.SINCE_REF ?? 'HEAD~50'
const DRY_RUN = process.env.DRY_RUN === 'true'
const BASE_BRANCH = process.env.BASE_BRANCH ?? 'main'
const BRANCH_NAME = `chore/maintain-agent-rules-${Date.now()}`

async function runWorkflow() {
  const result = await workflow('maintain-agent-rules')
    .description('Audit and update AGENTS.md, AGENTS.md.override, and .claude/rules/ against current code')
    .pattern('dag')
    .channel('wf-maintain-agent-rules')
    .maxConcurrency(4)
    .timeout(3_600_000)

    .agent('analyst', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      preset: 'worker',
      role: 'Drift analyst — reads rule files + current code, writes structured drift report',
      retries: 2,
    })
    .agent('lead', {
      cli: 'claude',
      model: ClaudeModels.OPUS,
      role: 'Rules editor lead — reviews drift, assigns edits on channel, verifies writer output',
      retries: 1,
    })
    .agent('writer', {
      cli: 'codex',
      model: CodexModels.GPT_5_4,
      role: 'Rules editor — applies one-file-at-a-time edits to AGENTS.md / override / .claude/rules files',
      retries: 2,
    })
    .agent('reviewer', {
      cli: 'claude',
      model: ClaudeModels.SONNET,
      preset: 'reviewer',
      role: 'PR reviewer — flags hallucinated rules and over-reach',
      retries: 1,
    })

    // ─── 1. Discover scope ────────────────────────────────────────────────
    .step('discover-scope', {
      type: 'deterministic',
      command: `set -e
mkdir -p .trail
cd "${TARGET_REPO_DIR}"

echo "=== target: ${TARGET_REPO_DIR} ===" > .trail/rules-scope.txt
echo "=== since: ${SINCE_REF} ===" >> .trail/rules-scope.txt

echo "" >> .trail/rules-scope.txt
echo "=== touched directories ===" >> .trail/rules-scope.txt
git diff --name-only "${SINCE_REF}...HEAD" 2>/dev/null \
  | xargs -n1 dirname 2>/dev/null \
  | sort -u >> .trail/rules-scope.txt || true

echo "" >> .trail/rules-scope.txt
echo "=== existing AGENTS.md files ===" >> .trail/rules-scope.txt
find . -type f -name "AGENTS.md" -not -path "*/node_modules/*" -not -path "*/.git/*" >> .trail/rules-scope.txt || true

echo "" >> .trail/rules-scope.txt
echo "=== existing AGENTS.md.override files ===" >> .trail/rules-scope.txt
find . -type f -name "AGENTS.md.override" -not -path "*/node_modules/*" -not -path "*/.git/*" >> .trail/rules-scope.txt || true

echo "" >> .trail/rules-scope.txt
echo "=== existing .claude/rules/ files ===" >> .trail/rules-scope.txt
find . -type f -path "*/.claude/rules/*.md" -not -path "*/node_modules/*" -not -path "*/.git/*" >> .trail/rules-scope.txt || true

cat .trail/rules-scope.txt`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── 2. Snapshot rule file contents ────────────────────────────────────
    .step('snapshot-rules', {
      type: 'deterministic',
      dependsOn: ['discover-scope'],
      command: `set -e
cd "${TARGET_REPO_DIR}"
{
  echo "# Rule file snapshot"
  echo ""
  for f in $(find . -type f \\( -name "AGENTS.md" -o -name "AGENTS.md.override" -o -path "*/.claude/rules/*.md" \\) -not -path "*/node_modules/*" -not -path "*/.git/*"); do
    echo "## FILE: $f"
    echo ""
    echo '-----BEGIN FILE-----'
    cat "$f"
    echo '-----END FILE-----'
    echo ""
  done
} > .trail/rules-snapshot.md
wc -l .trail/rules-snapshot.md`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── 3. Audit drift ────────────────────────────────────────────────────
    .step('audit-drift', {
      agent: 'analyst',
      dependsOn: ['snapshot-rules'],
      task: `You are auditing agent instruction files against the current state of the code.

Inputs:
- Scope summary:
{{steps.discover-scope.output}}
- Rule file snapshot:
{{steps.snapshot-rules.output}}

Process each rule file listed in the snapshot and identify drift:
1. Does it reference files, directories, functions, or conventions that no longer exist?
2. Are there new patterns in the code (based on touched directories) that are NOT yet documented?
3. Are any rules contradicted by current code (e.g. rule says "NEVER use X" but code uses X)?
4. Are there broken internal links or stale build commands?

Write the drift report to .trail/rules-drift.md with this exact structure:

# Rules Drift Report

## Summary
- files_audited: N
- files_with_drift: N
- new_rules_to_add: N

## Drift per file
### <file path>
- **Status:** clean | drift | stale
- **Issues:** (bulleted, concrete — reference line numbers or rule headings)
- **Proposed edits:** (bulleted, imperative — "Replace X with Y", "Delete section Z", "Add rule about W")

## New rules to add
- **File:** <where it should go>
- **Rule:** (imperative — "Use X, never Y because Z")
- **Evidence:** (file path + brief quote from current code)

If nothing is drifting AND no new rules are needed, write exactly "NO_DRIFT_DETECTED" on its own line and nothing else.

IMPORTANT: Write the file to disk at ${TARGET_REPO_DIR}/.trail/rules-drift.md. Do not output to stdout.`,
      verification: { type: 'file_exists', value: '.trail/rules-drift.md' },
    })

    // ─── 4. Verify drift report is meaningful ──────────────────────────────
    .step('verify-drift-exists', {
      type: 'deterministic',
      dependsOn: ['audit-drift'],
      command: `set -e
cd "${TARGET_REPO_DIR}"
if [ ! -s .trail/rules-drift.md ]; then
  echo "drift report is empty"
  exit 1
fi
if grep -q "^NO_DRIFT_DETECTED$" .trail/rules-drift.md; then
  echo "NO_DRIFT"
  exit 0
fi
echo "DRIFT_PRESENT"
wc -l .trail/rules-drift.md`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── 5. Lead coordinates edits on channel ──────────────────────────────
    .step('team-lead', {
      agent: 'lead',
      dependsOn: ['verify-drift-exists'],
      task: `You are the lead on #wf-maintain-agent-rules. Your writer is named "writer".

If the prior step output contains "NO_DRIFT", post "NO_DRIFT_EXITING" to the channel and exit cleanly.

Otherwise:
1. Read ${TARGET_REPO_DIR}/.trail/rules-drift.md
2. For each file needing edits, post a clear assignment to the channel:
   "writer: edit <absolute path>. Changes: <bulleted list from drift report>. Only edit this one file. Reply DONE when written."
3. After writer says DONE, read the file and verify the changes match the drift report.
4. If correct, post next assignment. If wrong, post corrections.
5. When all files are updated, post "ALL_RULES_UPDATED" and exit.

Constraints you must enforce on the writer:
- ONLY edit AGENTS.md, AGENTS.md.override, or .claude/rules/*.md
- Never delete files unless the drift report says to
- Never add speculative rules — only what the drift report prescribes
- Preserve existing structure and tone of each file

Work directory: ${TARGET_REPO_DIR}`,
    })
    .step('team-writer', {
      agent: 'writer',
      dependsOn: ['verify-drift-exists'],
      task: `You are "writer" on #wf-maintain-agent-rules. The lead will assign rule file edits one at a time.

For each assignment:
1. Read the file at the absolute path given
2. Apply exactly the changes listed
3. Save the file to disk
4. Post "DONE: <path>" to the channel
5. Wait for the next assignment

Rules:
- ONLY edit the file the lead assigns
- ONLY edit AGENTS.md, AGENTS.md.override, or .claude/rules/*.md
- Never touch source code
- Preserve YAML/markdown frontmatter structure
- If you disagree with an edit, still apply it but post a WARNING after DONE

Exit when the lead posts "ALL_RULES_UPDATED" or "NO_DRIFT_EXITING".

Work directory: ${TARGET_REPO_DIR}`,
    })

    // ─── 6. Verify writes landed ───────────────────────────────────────────
    .step('verify-writes', {
      type: 'deterministic',
      dependsOn: ['team-lead'],
      command: `set -e
cd "${TARGET_REPO_DIR}"
changed=$(git diff --name-only -- '*AGENTS.md' '*AGENTS.md.override' '*/.claude/rules/*.md' | wc -l | tr -d ' ')
echo "changed rule files: $changed"
git diff --stat -- '*AGENTS.md' '*AGENTS.md.override' '*/.claude/rules/*.md' || true

if grep -q "^NO_DRIFT$" ../../.trail/rules-scope.txt 2>/dev/null; then
  echo "no-drift path, exiting 0"
  exit 0
fi

if [ "$changed" = "0" ]; then
  if grep -q "NO_DRIFT_EXITING\\|NO_DRIFT_DETECTED" .trail/rules-drift.md 2>/dev/null; then
    echo "no drift to apply — exiting clean"
    exit 0
  fi
  echo "drift report had work but no files were changed"
  exit 1
fi`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── 7. Commit + PR (skipped on DRY_RUN) ───────────────────────────────
    .step('commit-and-pr', {
      type: 'deterministic',
      dependsOn: ['verify-writes'],
      command: `set -e
cd "${TARGET_REPO_DIR}"

if [ "${DRY_RUN ? 'true' : 'false'}" = "true" ]; then
  echo "DRY_RUN — skipping commit and PR"
  git diff --stat -- '*AGENTS.md' '*AGENTS.md.override' '*/.claude/rules/*.md' || true
  exit 0
fi

changed=$(git diff --name-only -- '*AGENTS.md' '*AGENTS.md.override' '*/.claude/rules/*.md' | wc -l | tr -d ' ')
if [ "$changed" = "0" ]; then
  echo "nothing to commit"
  exit 0
fi

git checkout -b "${BRANCH_NAME}"
git add -- '*AGENTS.md' '*AGENTS.md.override' '*/.claude/rules/*.md'
git commit -m "chore: maintain-agent-rules automated drift update

Generated by AgentWorkforce/workflows repeatable/maintain-agent-rules.
Drift report: .trail/rules-drift.md"

git push -u origin "${BRANCH_NAME}"

gh pr create \\
  --base "${BASE_BRANCH}" \\
  --head "${BRANCH_NAME}" \\
  --title "chore: automated agent rules drift update" \\
  --body-file .trail/rules-drift.md \\
  > .trail/pr-url.txt

echo "PR: $(cat .trail/pr-url.txt)"`,
      captureOutput: true,
      failOnError: true,
    })

    // ─── 8. PR self-review ─────────────────────────────────────────────────
    .step('pr-self-review', {
      agent: 'reviewer',
      dependsOn: ['commit-and-pr'],
      task: `Review the automated rules-drift PR.

Commit diff (from the previous deterministic step):
{{steps.commit-and-pr.output}}

Drift report the changes were based on:
{{steps.audit-drift.output}}

Evaluate:
1. Do the edits match what the drift report prescribed? (no extra changes, nothing missed)
2. Are any added rules speculative or not grounded in real code?
3. Do any edits contradict still-valid rules elsewhere?
4. Was any source code accidentally touched? (it should not have been)

Output a short verdict: PASS or FAIL with bulleted reasons. One paragraph max.`,
    })

    .onError('fail-fast')
    .run({ cwd: TARGET_REPO_DIR })

  console.log('Workflow status:', result.status)
}

runWorkflow().catch((error) => {
  console.error(error)
  process.exit(1)
})
