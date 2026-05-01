#!/usr/bin/env bun
import { runnerService } from '../services/runner.service';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const config: Record<string, string | string[]> = {};

  for (const arg of args) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    const value = rest.join('=');
    if (!value || !key) continue;
    if (key === 'dataset_filter') {
      config[key] = value.split(',');
    } else {
      config[key] = value;
    }
  }

  return config;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  return `${minutes}m ${remainderSeconds}s`;
}

function printSummary(summary: any) {
  console.log(`HEALOSBENCH Results — ${summary.config.strategy} / ${summary.config.model}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Field              Score');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`chief_complaint    ${summary.field_averages.chief_complaint.toFixed(3)}`);
  console.log(`vitals             ${summary.field_averages.vitals.toFixed(3)}`);
  console.log(`medications        ${summary.field_averages.medications.toFixed(3)}`);
  console.log(`diagnoses          ${summary.field_averages.diagnoses.toFixed(3)}`);
  console.log(`plan               ${summary.field_averages.plan.toFixed(3)}`);
  console.log(`follow_up          ${summary.field_averages.follow_up.toFixed(3)}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Overall F1         ${summary.field_averages.overall.toFixed(3)}`);
  console.log('');
  console.log(`Schema failures:   ${summary.schema_failure_count} / 50`);
  console.log(`Hallucinations:    ${summary.hallucination_count}`);
  console.log(`Total tokens:      ${summary.total_tokens.input + summary.total_tokens.output}`);
  console.log(`Cache hit rate:    ${((summary.total_tokens.cache_read / summary.total_tokens.input) * 100).toFixed(1)}%`);
  console.log(`Total cost:        $${summary.total_cost_usd.toFixed(2)}`);
  console.log(`Duration:          ${formatDuration(summary.duration_ms)}`);
  console.log(`Prompt hash:       ${summary.prompt_hash}`);
}

async function main() {
  const args = parseArgs();
  const strategy = String(args.strategy || 'zero_shot');
  const model = String(args.model || 'claude-haiku-4-5-20251001');
  const dataset_filter = args.dataset_filter as string[] | undefined;

  console.log(`Starting CLI eval run: strategy=${strategy}, model=${model}`);
  const runId = await runnerService.startRun({ strategy: strategy as any, model, dataset_filter });
  console.log(`Run started: ${runId}`);
  console.log('Waiting for completion...');

  // Poll for completion
  let summary: any = null;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const response = await fetch(`http://localhost:8787/api/v1/runs/${runId}`);
    if (!response.ok) {
      continue;
    }

    const data = await response.json() as Record<string, unknown>;
    if (data.status === 'completed' || data.status === 'failed') {
      summary = data as any;
      break;
    }
  }

  if (!summary) {
    console.error('Could not retrieve summary');
    process.exit(1);
  }

  printSummary(summary);

  const resultsFolder = join(process.cwd(), 'results');
  if (!existsSync(resultsFolder)) {
    mkdirSync(resultsFolder, { recursive: true });
  }

  const filename = `results/${strategy}_${Date.now()}.json`;
  writeFileSync(filename, JSON.stringify(summary, null, 2));
  console.log(`Saved results to ${filename}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});