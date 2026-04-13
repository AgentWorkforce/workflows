/**
 * cloud-schedule.ts
 *
 * Intended registration of prpm-hygiene as a scheduled workflow in
 * AgentWorkforce/cloud. Not active yet — the cloud SDK is not published.
 * This file documents the expected shape so the registration is ready
 * when cloud lands.
 */

// import { Cloud } from '@agentworkforce/cloud-sdk' // not yet published

interface ScheduleSketch {
  name: string
  source: {
    repo: string
    ref: string
    path: string
  }
  // This workflow is special: it targets *many* repos. Cloud will resolve
  // the list from repos.txt in the source repo and clone each one into
  // the workflow's working directory before execution.
  targets: {
    repoListPath: string
    org: string
  }
  env: Record<string, string>
  schedule: string // cron expression
  timeoutMs: number
}

const schedule: ScheduleSketch = {
  name: 'prpm-hygiene-weekly',
  source: {
    repo: 'AgentWorkforce/workflows',
    ref: 'main',
    path: 'repeatable/prpm-hygiene/workflow.ts',
  },
  targets: {
    repoListPath: 'repeatable/prpm-hygiene/repos.txt',
    org: 'AgentWorkforce',
  },
  env: {
    DRY_RUN: 'false',
  },
  // Every Monday at 8am UTC
  schedule: '0 8 * * 1',
  timeoutMs: 3_600_000,
}

async function register() {
  // const cloud = new Cloud({ apiKey: process.env.CLOUD_API_KEY! })
  // await cloud.schedules.create(schedule)
  console.log('cloud SDK not yet wired up — intended schedule:')
  console.log(`  ${schedule.name}: ${schedule.schedule}`)
  console.log(`  source: ${schedule.source.repo}/${schedule.source.path}`)
  console.log(`  targets: listed in ${schedule.targets.repoListPath}`)
}

register().catch((err) => {
  console.error(err)
  process.exit(1)
})
