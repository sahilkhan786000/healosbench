import crypto from 'crypto';
import { db, runs, caseResults, promptVersions } from '@test-evals/db';
import { extractTranscript } from './extract.service';
import type { RunConfig, CaseResult, CaseCompleteEvent } from '@test-evals/shared';
import { eq, and } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

class RunnerService {
  private eventEmitter = new EventEmitter();
  private activeRuns = new Map<string, AbortController>();

  async startRun(config: RunConfig): Promise<string> {
    // Generate run ID
    const runId = crypto.randomUUID();

    // Load strategy module to get prompts
    const { getStrategyModule, buildPromptHash } = await import('@test-evals/llm');
    const strategyModule = await getStrategyModule(config.strategy);
    const systemPrompt = strategyModule.buildSystemPrompt();
    const userPromptTemplate = strategyModule.buildUserPrompt('');

    // Build prompt hash
    const promptHash = buildPromptHash(systemPrompt, userPromptTemplate);

    // Check idempotency
    const existingRun = await db
      .select()
      .from(runs)
      .where(and(
        eq(runs.strategy, config.strategy),
        eq(runs.model, config.model),
        eq(runs.promptHash, promptHash),
        eq(runs.status, 'completed')
      ))
      .limit(1);

    if (existingRun.length > 0 && !config.force) {
      return existingRun[0]!.id;
    }

    // Insert run record
    await db.insert(runs).values({
      id: runId,
      strategy: config.strategy,
      model: config.model,
      status: 'pending',
      promptHash,
      fieldAverages: null,
      hallucinationCount: null,
      schemaFailureCount: null,
      totalTokens: null,
      totalCostUsd: null,
      durationMs: null,
    });

    // Store prompt version if not exists
    await db.insert(promptVersions).values({
      hash: promptHash,
      strategy: config.strategy,
      content: systemPrompt + '\n\n' + userPromptTemplate,
    }).onConflictDoNothing();

    // Start processing asynchronously
    this.processRun(runId, config);

    return runId;
  }

  async processRun(runId: string, config: RunConfig): Promise<void> {
    const abortController = new AbortController();
    this.activeRuns.set(runId, abortController);

    try {
      // Update status to running
      await db.update(runs)
        .set({ status: 'running' })
        .where(eq(runs.id, runId));

      const startTime = Date.now();

      // Load all transcripts
      const transcriptsDir = join(process.cwd(), '..', '..', 'data', 'transcripts');
      const transcriptFiles = readdirSync(transcriptsDir)
        .filter(f => f.endsWith('.txt'))
        .sort();

      // Apply dataset filter
      let filteredTranscripts = transcriptFiles;
      if (config.dataset_filter) {
        filteredTranscripts = transcriptFiles.filter(f =>
          config.dataset_filter!.includes(f.replace('.txt', ''))
        );
      }

      // Load transcripts and check existing results
      const transcriptsToProcess: Array<{ id: string; content: string }> = [];

      for (const file of filteredTranscripts) {
        const transcriptId = file.replace('.txt', '');
        const existingResult = await db
          .select()
          .from(caseResults)
          .where(and(
            eq(caseResults.runId, runId),
            eq(caseResults.transcriptId, transcriptId)
          ))
          .limit(1);

        if (existingResult.length === 0) {
          const content = readFileSync(join(transcriptsDir, file), 'utf-8');
          transcriptsToProcess.push({ id: transcriptId, content });
        }
      }

      // Process with concurrency control (max 5 concurrent)
      const semaphore = new Semaphore(5);
      const results: CaseResult[] = [];
      let completed = 0;

      const processPromises = transcriptsToProcess.map(async (transcript) => {
        await semaphore.acquire();

        if (abortController.signal.aborted) {
          semaphore.release();
          return;
        }

        try {
          const result = await extractTranscript(
            transcript.id,
            transcript.content,
            config.strategy,
            config.model
          );

          // Store result
          await db.insert(caseResults).values({
            id: crypto.randomUUID(),
            runId,
            transcriptId: transcript.id,
            prediction: result.prediction,
            gold: result.gold,
            scores: result.scores,
            attempts: result.attempts,
            schemaValid: result.schema_valid,
            hallucinationCount: result.hallucination_count,
            tokens: result.tokens,
            costUsd: result.cost_usd.toString(),
            durationMs: result.duration_ms,
            llmTrace: null, // TODO: store trace
          });

          results.push(result);
          completed++;

          // Emit progress event
          this.eventEmitter.emit('caseComplete', {
            runId,
            event: {
              transcript_id: transcript.id,
              scores: result.scores,
              progress: (completed / transcriptsToProcess.length) * 100
            }
          });

        } catch (error) {
          console.error(`Failed to process ${transcript.id}:`, error);
          // Continue with other transcripts
        } finally {
          semaphore.release();
        }
      });

      await Promise.all(processPromises);

      // Aggregate results
      const summary = await this.aggregateResults(runId, startTime);
      await db.update(runs)
        .set({
          status: 'completed',
          fieldAverages: summary.field_averages,
          hallucinationCount: summary.hallucination_count,
          schemaFailureCount: summary.schema_failure_count,
          totalTokens: summary.total_tokens,
          totalCostUsd: summary.total_cost_usd.toString(),
          durationMs: summary.duration_ms,
        })
        .where(eq(runs.id, runId));

    } catch (error) {
      console.error(`Run ${runId} failed:`, error);
      await db.update(runs)
        .set({ status: 'failed' })
        .where(eq(runs.id, runId));
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  async resumeRun(runId: string): Promise<void> {
    const runRecord = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (runRecord.length === 0) throw new Error('Run not found');

    const run = runRecord[0]!;
    const config: RunConfig = {
      strategy: run.strategy as any,
      model: run.model,
    };

    await this.processRun(runId, config);
  }

  private async aggregateResults(runId: string, startTime: number): Promise<{
    field_averages: any;
    hallucination_count: number;
    schema_failure_count: number;
    total_tokens: any;
    total_cost_usd: number;
    duration_ms: number;
  }> {
    const results = await db
      .select()
      .from(caseResults)
      .where(eq(caseResults.runId, runId));

    if (results.length === 0) {
      return {
        field_averages: {
          chief_complaint: 0,
          vitals: 0,
          medications: 0,
          diagnoses: 0,
          plan: 0,
          follow_up: 0,
          overall: 0
        },
        hallucination_count: 0,
        schema_failure_count: 0,
        total_tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
        total_cost_usd: 0,
        duration_ms: Date.now() - startTime
      };
    }

    // Aggregate scores
    const fieldAverages = {
      chief_complaint: results.reduce((sum, r) => sum + r.scores.chief_complaint, 0) / results.length,
      vitals: results.reduce((sum, r) => sum + r.scores.vitals, 0) / results.length,
      medications: results.reduce((sum, r) => sum + r.scores.medications, 0) / results.length,
      diagnoses: results.reduce((sum, r) => sum + r.scores.diagnoses, 0) / results.length,
      plan: results.reduce((sum, r) => sum + r.scores.plan, 0) / results.length,
      follow_up: results.reduce((sum, r) => sum + r.scores.follow_up, 0) / results.length,
      overall: results.reduce((sum, r) => sum + r.scores.overall, 0) / results.length,
    };

    const hallucinationCount = results.reduce((sum, r) => sum + r.hallucinationCount, 0);
    const schemaFailureCount = results.filter(r => !r.schemaValid).length;

    const totalTokens = {
      input: results.reduce((sum, r) => sum + r.tokens.input, 0),
      output: results.reduce((sum, r) => sum + r.tokens.output, 0),
      cache_read: results.reduce((sum, r) => sum + r.tokens.cache_read, 0),
      cache_write: results.reduce((sum, r) => sum + r.tokens.cache_write, 0),
    };

    const totalCost = results.reduce((sum, r) => sum + parseFloat(r.costUsd), 0);

    return {
      field_averages: fieldAverages,
      hallucination_count: hallucinationCount,
      schema_failure_count: schemaFailureCount,
      total_tokens: totalTokens,
      total_cost_usd: totalCost,
      duration_ms: Date.now() - startTime
    };
  }

  onCaseComplete(callback: (runId: string, event: CaseCompleteEvent) => void): void {
    this.eventEmitter.on('caseComplete', ({ runId, event }) => callback(runId, event));
  }
}

class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      this.permits--;
      resolve();
    }
  }
}

export const runnerService = new RunnerService();