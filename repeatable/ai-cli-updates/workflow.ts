/**
 * ai-cli-updates
 *
 * Purely deterministic workflow: no agents, just the installer commands for
 * the AI CLIs this machine should keep current.
 *
 * The installs run sequentially because they mutate global package-manager
 * state: npm globals, Homebrew, and shell-script installers. Each CLI writes a
 * status file and exits 0 so the workflow attempts every CLI; the final
 * summary step fails the run if any installer failed.
 *
 * Inputs:
 *   AI_CLI_UPDATES_DRY_RUN=true   Execute workflow steps but print installer
 *                                 commands instead of running them.
 *   DRY_RUN=true                  Also honored, but some agent-relay runners
 *                                 use it for workflow planning only.
 *   AI_CLI_UPDATES_ONLY=...   Optional comma-separated list of ids to run:
 *                             cursor,droid,gemini,claude,codex,opencode
 *
 * Run:
 *   agent-relay run --dry-run repeatable/ai-cli-updates/workflow.ts
 *   AI_CLI_UPDATES_DRY_RUN=true agent-relay run repeatable/ai-cli-updates/workflow.ts
 *   agent-relay run repeatable/ai-cli-updates/workflow.ts
 */

import { workflow } from '@agent-relay/sdk/workflows'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const INSTALL_DRY_RUN =
  process.env.AI_CLI_UPDATES_DRY_RUN === 'true' || process.env.DRY_RUN === 'true'
const ONLY = new Set<string>(
  (process.env.AI_CLI_UPDATES_ONLY ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)
const TIMESTAMP = Date.now()
const TRAIL_DIR = resolve(__dirname, `.trail/${TIMESTAMP}`)

type CliSpec = {
  id: string
  commandName: string
  displayName: string
  installer: string
  preInstall?: string
  requiredTools: string[]
}

const CLI_SPECS: CliSpec[] = [
  {
    id: 'cursor',
    commandName: 'agent',
    displayName: 'Cursor CLI',
    installer: 'curl https://cursor.com/install -fsS | bash -s -- agent',
    requiredTools: ['curl', 'bash'],
  },
  {
    id: 'droid',
    commandName: 'droid',
    displayName: 'Factory Droid CLI',
    installer: 'curl -fsSL https://app.factory.ai/cli | sh -s -- droid',
    preInstall:
      'existing=$(command -v droid 2>/dev/null || true); if [ -n "$existing" ]; then backup="${existing}.bak-${timestamp}"; echo "moving existing droid to $backup"; mv "$existing" "$backup"; printf "%s\\n%s\\n" "$existing" "$backup" > "${status_file}.backup"; fi',
    requiredTools: ['curl', 'sh'],
  },
  {
    id: 'gemini',
    commandName: 'gemini',
    displayName: 'Gemini CLI',
    installer: 'npm install -g --force @google/gemini-cli@latest',
    requiredTools: ['npm'],
  },
  {
    id: 'claude',
    commandName: 'claude',
    displayName: 'Claude Code',
    installer:
      'if brew list --cask claude-code >/dev/null 2>&1; then brew upgrade --cask claude-code || brew reinstall --cask claude-code; elif brew list --cask claude-code@latest >/dev/null 2>&1; then brew upgrade --cask claude-code@latest || brew reinstall --cask claude-code@latest; else brew install --cask claude-code@latest || brew install --cask claude-code; fi',
    requiredTools: ['brew'],
  },
  {
    id: 'codex',
    commandName: 'codex',
    displayName: 'Codex CLI',
    installer: 'npm install -g --force @openai/codex@latest',
    requiredTools: ['npm'],
  },
  {
    id: 'opencode',
    commandName: 'opencode',
    displayName: 'OpenCode CLI',
    installer: 'npm install -g --force opencode-ai@latest',
    requiredTools: ['npm'],
  },
]

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function shellPrintLine(value: string): string {
  return `printf '%s\\n' ${shellQuote(value)}`
}

function enabledCliSpecs(): CliSpec[] {
  if (ONLY.size === 0) {
    return CLI_SPECS
  }

  const knownIds = new Set(CLI_SPECS.map((spec) => spec.id))
  const unknown = [...ONLY].filter((id) => !knownIds.has(id))
  if (unknown.length > 0) {
    throw new Error(`Unknown AI_CLI_UPDATES_ONLY id(s): ${unknown.join(', ')}`)
  }

  return CLI_SPECS.filter((spec) => ONLY.has(spec.id))
}

function bashCommand(script: string): string {
  return `bash -lc ${shellQuote(script)}`
}

function perCliCommand(spec: CliSpec, statusFile: string): string {
  const requiredTools = spec.requiredTools.map((tool) => shellQuote(tool)).join(' ')
  const preInstallBlock = spec.preInstall
    ? `
log "running pre-install"
bash -o pipefail -c ${shellQuote(spec.preInstall)} 2>&1 | tee -a "$status_file"
pre_install_status=\${PIPESTATUS[0]}
if [ "$pre_install_status" -ne 0 ]; then
  log "pre-install failed with exit code $pre_install_status"
  echo "result: FAIL_PRE_INSTALL" >> "$status_file"
  exit 0
fi
`
    : ''

  return bashCommand(`set +e
set -o pipefail
mkdir -p "${TRAIL_DIR}"
status_file="${statusFile}"
id="${spec.id}"
command_name="${spec.commandName}"
timestamp="${TIMESTAMP}"
export timestamp
export status_file

log() {
  printf '[%s] %s\\n' "$id" "$*" | tee -a "$status_file"
}

restore_backup() {
  backup_file="\${status_file}.backup"
  [ -s "$backup_file" ] || return 0

  target=$(sed -n '1p' "$backup_file")
  backup=$(sed -n '2p' "$backup_file")
  if [ -z "$target" ] || [ -z "$backup" ]; then
    log "backup marker is incomplete: $backup_file"
    return 1
  fi

  if [ ! -e "$backup" ]; then
    log "backup file is missing: $backup"
    return 1
  fi

  if [ -e "$target" ]; then
    log "not restoring backup because target already exists: $target"
    return 0
  fi

  mv "$backup" "$target"
  log "restored backup to $target"
}

{
  ${shellPrintLine(`=== ai-cli-updates: ${spec.displayName} ===`)}
  ${shellPrintLine(`id: ${spec.id}`)}
  ${shellPrintLine(`timestamp: ${TIMESTAMP}`)}
  ${shellPrintLine(`dry_run: ${INSTALL_DRY_RUN ? 'true' : 'false'}`)}
  ${shellPrintLine(`installer: ${spec.installer}`)}
  ${shellPrintLine(`pre_install: ${spec.preInstall ?? 'none'}`)}
  echo ""
} > "$status_file"

before_path=$(command -v "$command_name" 2>/dev/null || true)
echo "before_path: \${before_path:-MISSING}" >> "$status_file"
echo "check_command: $command_name" >> "$status_file"

if [ "${INSTALL_DRY_RUN ? 'true' : 'false'}" = "true" ]; then
  log "dry run: would run installer"
  echo "${spec.installer}" >> "$status_file"
  echo "result: DRY_RUN" >> "$status_file"
  exit 0
fi

missing=0
for tool in ${requiredTools}; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    log "missing required tool: $tool"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "result: FAIL_MISSING_TOOL" >> "$status_file"
  exit 0
fi
${preInstallBlock}

log "running installer"
bash -o pipefail -c ${shellQuote(spec.installer)} 2>&1 | tee -a "$status_file"
install_status=\${PIPESTATUS[0]}
if [ "$install_status" -ne 0 ]; then
  log "installer failed with exit code $install_status"
  restore_backup
  echo "result: FAIL_INSTALL" >> "$status_file"
  exit 0
fi

after_path=$(command -v "$command_name" 2>/dev/null || true)
echo "after_path: \${after_path:-MISSING}" >> "$status_file"
if [ -z "$after_path" ]; then
  log "installer completed but '$command_name' is not on PATH"
  restore_backup
  echo "result: FAIL_NOT_ON_PATH" >> "$status_file"
  exit 0
fi

log "updated"
echo "result: UPDATED" >> "$status_file"
exit 0`)
}

function summaryCommand(specs: CliSpec[]): string {
  const expectedFiles = specs.map((spec) => `${spec.id}.txt`).join(' ')

  return bashCommand(`set -e
cd "${TRAIL_DIR}"
echo "=== ai-cli-updates summary ==="
echo "timestamp: ${TIMESTAMP}"
echo "dry_run: ${INSTALL_DRY_RUN ? 'true' : 'false'}"
echo ""

declare -a updated=()
declare -a dry_run=()
declare -a failed=()

for f in ${expectedFiles}; do
  if [ ! -f "$f" ]; then
    failed+=("$f (missing status file)")
    continue
  fi

  id=\${f%.txt}
  result=$(grep "^result:" "$f" | tail -1 | awk '{print $2}')
  case "$result" in
    UPDATED) updated+=("$id") ;;
    DRY_RUN) dry_run+=("$id") ;;
    FAIL_*) failed+=("$id (\${result#FAIL_})") ;;
    *) failed+=("$id (unknown: $result)") ;;
  esac
done

echo "updated (\${#updated[@]}):"
for item in "\${updated[@]}"; do echo "  - $item"; done
echo ""

echo "dry-run (\${#dry_run[@]}):"
for item in "\${dry_run[@]}"; do echo "  - $item"; done
echo ""

echo "failed (\${#failed[@]}):"
for item in "\${failed[@]}"; do echo "  - $item"; done
echo ""

if [ \${#failed[@]} -gt 0 ]; then
  echo "one or more AI CLI updates failed; see ${TRAIL_DIR}/ for per-tool logs"
  exit 1
fi

echo "AI_CLI_UPDATES_DONE"`)
}

async function runWorkflow() {
  const specs = enabledCliSpecs()
  if (specs.length === 0) {
    console.error('No AI CLIs selected')
    process.exit(1)
  }

  console.log(
    `ai-cli-updates: ${specs.map((spec) => spec.id).join(', ')}; INSTALL_DRY_RUN=${INSTALL_DRY_RUN}`,
  )

  const builder = workflow('ai-cli-updates')
    .description('Install or update local AI CLIs with deterministic shell steps')
    .pattern('pipeline')
    .channel('wf-ai-cli-updates')
    .maxConcurrency(1)
    .timeout(3_600_000)
    .step('validate-runner', {
      type: 'deterministic',
      command: bashCommand(`set -e
mkdir -p "${TRAIL_DIR}"
echo "trail_dir: ${TRAIL_DIR}"
echo "dry_run: ${INSTALL_DRY_RUN ? 'true' : 'false'}"
echo "selected: ${specs.map((spec) => spec.id).join(',')}"
for tool in bash curl sh npm brew; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '%s: %s\\n' "$tool" "$(command -v "$tool")"
  else
    printf '%s: MISSING\\n' "$tool"
  fi
done
echo READY > "${TRAIL_DIR}/ready.txt"`),
      captureOutput: true,
      failOnError: true,
    })

  let previousStep = 'validate-runner'
  const stepNames: string[] = []
  for (const spec of specs) {
    const stepName = `update-${spec.id}`
    const statusFile = resolve(TRAIL_DIR, `${spec.id}.txt`)
    stepNames.push(stepName)

    builder.step(stepName, {
      type: 'deterministic',
      dependsOn: [previousStep],
      command: perCliCommand(spec, statusFile),
      captureOutput: true,
      failOnError: false,
    })

    previousStep = stepName
  }

  builder.step('summary', {
    type: 'deterministic',
    dependsOn: stepNames,
    command: summaryCommand(specs),
    captureOutput: true,
    failOnError: true,
  })

  builder.onError('fail-fast', { maxRetries: 0 })
  const result = await builder.run({ cwd: process.cwd() })
  console.log('Workflow status:', result.status)
}

runWorkflow().catch((error) => {
  console.error(error)
  process.exit(1)
})
