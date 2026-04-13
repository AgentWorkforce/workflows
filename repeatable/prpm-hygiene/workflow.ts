/**
 * prpm-hygiene
 *
 * Purely deterministic workflow — zero agents, just shell.
 *
 * For each repo listed in repos.txt:
 *   1. Ensure prpm / git / gh are installed (once, up front)
 *   2. cd into the repo, refuse to proceed if dirty or detached
 *   3. Checkout main, pull
 *   4. Create branch chore/prpm-hygiene-<timestamp>
 *   5. Run: prpm install collections/agent-relay-starter --as codex,claude --yes
 *   6. Run: prpm update --all
 *   7. If git diff shows changes, commit + push + gh pr create
 *   8. Otherwise, record "no-op" and move on
 *
 * All per-repo work runs in parallel (capped at maxConcurrency). One repo
 * failing does not stop the others — errors are collected into the summary.
 *
 * Inputs (env vars):
 *   PARENT_DIR    absolute path containing the target repos
 *                 (default: parent of this workflows repo)
 *   REPOS_FILE    path to repo list (default: ./repos.txt relative to this file)
 *   DRY_RUN       "true" to skip commit/push/PR (default: "false")
 *   BASE_BRANCH   PR base branch name (default: "main")
 *
 * Run locally:
 *   agent-relay run --dry-run workflow.ts
 *   DRY_RUN=true agent-relay run workflow.ts
 *   agent-relay run workflow.ts
 */

import { workflow } from '@agent-relay/sdk/workflows'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PARENT_DIR = process.env.PARENT_DIR ?? resolve(__dirname, '../../..')
const REPOS_FILE = process.env.REPOS_FILE ?? resolve(__dirname, 'repos.txt')
const DRY_RUN = process.env.DRY_RUN === 'true'
const BASE_BRANCH = process.env.BASE_BRANCH ?? 'main'
const TIMESTAMP = Date.now()
const BRANCH_NAME = `chore/prpm-hygiene-${TIMESTAMP}`
const TRAIL_DIR = resolve(__dirname, `.trail/${TIMESTAMP}`)

function loadRepos(path: string): string[] {
  const raw = readFileSync(path, 'utf-8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

function slugFor(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
}

function perRepoCommand(repo: string, repoDir: string, statusFile: string): string {
  // All shell state is reset per step — no cross-step env leakage. Failures
  // inside this block are captured to the status file and the step still
  // exits 0 so sibling repos can finish. The summary step surfaces failures.
  return `set +e
mkdir -p "${TRAIL_DIR}"
status_file="${statusFile}"
repo="${repo}"
dir="${repoDir}"

log() { echo "[\${repo}] $*" | tee -a "$status_file"; }

echo "=== prpm-hygiene: \${repo} ===" > "$status_file"
echo "timestamp: ${TIMESTAMP}" >> "$status_file"
echo "dir: \${dir}" >> "$status_file"
echo "" >> "$status_file"

if [ ! -d "\${dir}" ]; then
  log "SKIP: directory not found"
  echo "result: SKIP_NOT_FOUND" >> "$status_file"
  exit 0
fi

if [ ! -d "\${dir}/.git" ]; then
  log "SKIP: not a git repo"
  echo "result: SKIP_NOT_GIT" >> "$status_file"
  exit 0
fi

cd "\${dir}" || { log "FAIL: cd failed"; echo "result: FAIL_CD" >> "$status_file"; exit 0; }

if ! git diff --quiet HEAD 2>/dev/null; then
  log "SKIP: dirty working tree"
  echo "result: SKIP_DIRTY" >> "$status_file"
  exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$branch" != "${BASE_BRANCH}" ]; then
  log "SKIP: not on ${BASE_BRANCH} (on \${branch})"
  echo "result: SKIP_WRONG_BRANCH" >> "$status_file"
  exit 0
fi

log "pulling latest ${BASE_BRANCH}"
git pull --ff-only origin "${BASE_BRANCH}" 2>&1 | tee -a "$status_file"
if [ \${PIPESTATUS[0]} -ne 0 ]; then
  log "FAIL: git pull failed"
  echo "result: FAIL_PULL" >> "$status_file"
  exit 0
fi

log "creating branch ${BRANCH_NAME}"
if ! git checkout -b "${BRANCH_NAME}" 2>&1 | tee -a "$status_file"; then
  log "FAIL: branch creation"
  echo "result: FAIL_BRANCH" >> "$status_file"
  exit 0
fi

log "running prpm install collections/agent-relay-starter --as codex,claude"
if ! prpm install collections/agent-relay-starter --as codex,claude --yes 2>&1 | tee -a "$status_file"; then
  log "FAIL: prpm install"
  echo "result: FAIL_INSTALL" >> "$status_file"
  git checkout "${BASE_BRANCH}" 2>/dev/null
  git branch -D "${BRANCH_NAME}" 2>/dev/null
  exit 0
fi

log "running prpm update --all"
if ! prpm update --all 2>&1 | tee -a "$status_file"; then
  log "WARN: prpm update returned non-zero (continuing)"
fi

changed=$(git status --porcelain | wc -l | tr -d ' ')
echo "changed files: \${changed}" >> "$status_file"

if [ "\${changed}" = "0" ]; then
  log "already up to date, nothing to commit"
  echo "result: NOOP" >> "$status_file"
  git checkout "${BASE_BRANCH}" 2>/dev/null
  git branch -D "${BRANCH_NAME}" 2>/dev/null
  exit 0
fi

if [ "${DRY_RUN ? 'true' : 'false'}" = "true" ]; then
  log "DRY_RUN — would commit \${changed} files"
  git status --short >> "$status_file"
  echo "result: DRY_RUN_CHANGES" >> "$status_file"
  git checkout "${BASE_BRANCH}" 2>/dev/null
  git branch -D "${BRANCH_NAME}" 2>/dev/null
  exit 0
fi

log "committing and pushing"
git add -A
git commit -m "chore: prpm-hygiene — refresh agent-relay-starter + update packages

Generated by AgentWorkforce/workflows repeatable/prpm-hygiene.
Install: prpm install collections/agent-relay-starter --as codex,claude
Update:  prpm update --all" 2>&1 | tee -a "$status_file"

git push -u origin "${BRANCH_NAME}" 2>&1 | tee -a "$status_file"
if [ \${PIPESTATUS[0]} -ne 0 ]; then
  log "FAIL: git push"
  echo "result: FAIL_PUSH" >> "$status_file"
  exit 0
fi

pr_url=$(gh pr create \\
  --base "${BASE_BRANCH}" \\
  --head "${BRANCH_NAME}" \\
  --title "chore: prpm-hygiene refresh" \\
  --body "Automated refresh of agent-relay-starter collection and prpm package updates.

Ran:
- \\\`prpm install collections/agent-relay-starter --as codex,claude --yes\\\`
- \\\`prpm update --all\\\`

Changed files: \${changed}

Generated by [AgentWorkforce/workflows](https://github.com/AgentWorkforce/workflows) repeatable/prpm-hygiene." 2>&1 | tail -1)

echo "pr_url: \${pr_url}" >> "$status_file"
echo "result: PR_OPENED" >> "$status_file"
log "PR opened: \${pr_url}"

git checkout "${BASE_BRANCH}" 2>/dev/null
exit 0`
}

async function runWorkflow() {
  const repos = loadRepos(REPOS_FILE)
  if (repos.length === 0) {
    console.error(`No repos listed in ${REPOS_FILE}`)
    process.exit(1)
  }

  console.log(`prpm-hygiene: ${repos.length} repos, PARENT_DIR=${PARENT_DIR}, DRY_RUN=${DRY_RUN}`)

  const builder = workflow('prpm-hygiene')
    .description('Install agent-relay-starter + prpm update across AgentWorkforce repos')
    .pattern('dag')
    .channel('wf-prpm-hygiene')
    .maxConcurrency(4)
    .timeout(3_600_000)

    // ─── Preflight: tools must exist ─────────────────────────────────────
    .step('validate-tooling', {
      type: 'deterministic',
      command: `set -e
for tool in prpm git gh; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "missing tool: $tool"
    exit 1
  fi
done
prpm --version
git --version
gh --version | head -1
mkdir -p "${TRAIL_DIR}"
echo "ready" > "${TRAIL_DIR}/ready.txt"`,
      captureOutput: true,
      failOnError: true,
    })

  // ─── Per-repo steps (parallel, fan-out from validate-tooling) ──────────
  const stepNames: string[] = []
  for (const repo of repos) {
    const slug = slugFor(repo)
    const stepName = `repo-${slug}`
    const repoDir = resolve(PARENT_DIR, repo)
    const statusFile = resolve(TRAIL_DIR, `${slug}.txt`)
    stepNames.push(stepName)

    builder.step(stepName, {
      type: 'deterministic',
      dependsOn: ['validate-tooling'],
      command: perRepoCommand(repo, repoDir, statusFile),
      captureOutput: true,
      failOnError: false,
    })
  }

  // ─── Summary: aggregate per-repo status files ────────────────────────
  builder.step('summary', {
    type: 'deterministic',
    dependsOn: stepNames,
    command: `set -e
cd "${TRAIL_DIR}"
echo "=== prpm-hygiene summary ==="
echo "timestamp: ${TIMESTAMP}"
echo ""

declare -a pr_opened=()
declare -a noop=()
declare -a skipped=()
declare -a failed=()
declare -a dry_run=()

for f in *.txt; do
  [ "$f" = "ready.txt" ] && continue
  [ -f "$f" ] || continue
  repo=\${f%.txt}
  result=$(grep "^result:" "$f" | tail -1 | awk '{print $2}')
  case "$result" in
    PR_OPENED) pr_opened+=("$repo") ;;
    NOOP) noop+=("$repo") ;;
    DRY_RUN_CHANGES) dry_run+=("$repo") ;;
    SKIP_*) skipped+=("$repo (\${result#SKIP_})") ;;
    FAIL_*) failed+=("$repo (\${result#FAIL_})") ;;
    *) failed+=("$repo (unknown: $result)") ;;
  esac
done

total=\$(( \${#pr_opened[@]} + \${#noop[@]} + \${#skipped[@]} + \${#failed[@]} + \${#dry_run[@]} ))
echo "total processed: $total"
echo ""

echo "PRs opened (\${#pr_opened[@]}):"
for r in "\${pr_opened[@]}"; do echo "  - $r"; done
echo ""

echo "no-op / up to date (\${#noop[@]}):"
for r in "\${noop[@]}"; do echo "  - $r"; done
echo ""

echo "dry-run changes pending (\${#dry_run[@]}):"
for r in "\${dry_run[@]}"; do echo "  - $r"; done
echo ""

echo "skipped (\${#skipped[@]}):"
for r in "\${skipped[@]}"; do echo "  - $r"; done
echo ""

echo "failed (\${#failed[@]}):"
for r in "\${failed[@]}"; do echo "  - $r"; done
echo ""

if [ \${#failed[@]} -gt 0 ]; then
  echo "some repos failed — see .trail/${TIMESTAMP}/ for per-repo logs"
  exit 1
fi

echo "done"`,
    captureOutput: true,
    failOnError: true,
  })

  builder.onError('continue')
  const result = await builder.run({ cwd: PARENT_DIR })
  console.log('Workflow status:', result.status)
}

runWorkflow().catch((error) => {
  console.error(error)
  process.exit(1)
})
