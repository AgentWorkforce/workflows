/**
 * fix-publish-workflow
 *
 * Repeatable single-persona workflow. Invokes the `npm-provenance` persona
 * via workload-router to rewrite a repo's `.github/workflows/publish.yml`
 * to use OIDC trusted publishing instead of NODE_AUTH_TOKEN / NPM_TOKEN
 * secrets.
 *
 * Unlike the DAG-style repeatables in this directory, this is a thin
 * wrapper around `usePersona('npm-provenance').sendMessage(...)`. The persona
 * does the actual editing; this file just points it at a target repo and
 * supplies the task description.
 *
 * Inputs (env vars):
 *   TARGET_REPO_DIR   absolute path to the repo whose publish.yml should
 *                     be fixed (default: process.cwd())
 *   TIMEOUT_SECONDS   persona execution timeout (default: 600)
 *
 * Run locally:
 *   TARGET_REPO_DIR=/path/to/repo agent-relay run workflow.ts
 */

import { usePersona } from '@agentworkforce/workload-router'

const TARGET_REPO_DIR = process.env.TARGET_REPO_DIR ?? process.cwd()
const TIMEOUT_SECONDS = Number(process.env.TIMEOUT_SECONDS ?? '600')

async function main() {
  const { sendMessage } = usePersona('npm-provenance')

  const result = await sendMessage(
    'Fix .github/workflows/publish.yml to use OIDC npm trusted publishing instead of NODE_AUTH_TOKEN / NPM_TOKEN secrets. Requirements: (1) Remove all NODE_AUTH_TOKEN / NPM_TOKEN secret references — OIDC only. (2) Ensure job permissions include id-token: write and contents: read. (3) Ensure npm publish uses --provenance --access public. (4) Preserve the existing workflow_dispatch inputs (package, version, tag, dry_run) and the multi-package publishing loop. (5) Keep the version bump and git commit steps. (6) Pin Node to 22.14.0 exactly in the setup-node step (node-version: 22.14.0) — other Node 22 versions have a known issue with npm trusted publishing / provenance. Write the fixed file to disk — do not print to stdout.',
    {
      workingDirectory: TARGET_REPO_DIR,
      timeoutSeconds: TIMEOUT_SECONDS,
    }
  )

  console.log('Result:', result.status)
}

main().catch((err) => {
  console.error('Execution failed:', err.message)
  if (err.result) {
    console.error('Result:', err.result)
  }
  process.exit(1)
})
