/**
 * cloud-schedule.ts
 *
 * Example registration of maintain-agent-rules as a scheduled workflow in
 * AgentWorkforce/cloud ("Easy agent infra"). This file is illustrative —
 * cloud's scheduling API is not yet active, so do not attempt to run this
 * directly. It exists to document the intended shape and to be ready when
 * cloud lands.
 *
 * When cloud is live, the registration flow will look roughly like:
 *
 *   1. Import the cloud SDK
 *   2. Describe the workflow source (this repo + path)
 *   3. Describe the target repo(s) to run against
 *   4. Describe the schedule (cron, event, or manual)
 *   5. Register — cloud clones the target repo, runs the workflow, and
 *      opens the PR on completion
 *
 * The actual API is TBD. The block below is a plausible sketch.
 */

// import { Cloud } from '@agentworkforce/cloud-sdk' // not yet published

interface ScheduleSketch {
  name: string
  source: {
    repo: string
    ref: string
    path: string
  }
  target: {
    repo: string
    baseBranch: string
  }
  env: Record<string, string>
  schedule: string // cron expression
  timeoutMs: number
}

const schedules: ScheduleSketch[] = [
  {
    name: 'relayed-rules-hygiene',
    source: {
      repo: 'AgentWorkforce/workflows',
      ref: 'main',
      path: 'repeatable/maintain-agent-rules/workflow.ts',
    },
    target: {
      repo: 'AgentWorkforce/relayed',
      baseBranch: 'main',
    },
    env: {
      SINCE_REF: 'HEAD~100',
      DRY_RUN: 'false',
    },
    // Every Monday at 6am UTC
    schedule: '0 6 * * 1',
    timeoutMs: 3_600_000,
  },
  {
    name: 'cloud-rules-hygiene',
    source: {
      repo: 'AgentWorkforce/workflows',
      ref: 'main',
      path: 'repeatable/maintain-agent-rules/workflow.ts',
    },
    target: {
      repo: 'AgentWorkforce/cloud',
      baseBranch: 'main',
    },
    env: {
      SINCE_REF: 'HEAD~100',
      DRY_RUN: 'false',
    },
    schedule: '0 6 * * 1',
    timeoutMs: 3_600_000,
  },
]

async function register() {
  // const cloud = new Cloud({ apiKey: process.env.CLOUD_API_KEY! })
  // for (const s of schedules) {
  //   await cloud.schedules.create(s)
  //   console.log(`registered: ${s.name}`)
  // }
  console.log('cloud SDK not yet wired up — intended schedules:')
  for (const s of schedules) {
    console.log(`  ${s.name}: ${s.target.repo} on "${s.schedule}"`)
  }
}

register().catch((err) => {
  console.error(err)
  process.exit(1)
})
