import { Hono } from 'hono';
import { db, runs, caseResults } from '@test-evals/db';
import { runnerService } from '../services/runner.service';
import type { RunConfig, RunSummary } from '@test-evals/shared';
import { eq, and, desc } from 'drizzle-orm';

const runsRoutes = new Hono();

// POST /api/v1/runs - Start a new run
runsRoutes.post('/', async (c) => {
  const body: RunConfig = await c.req.json();

  try {
    const runId = await runnerService.startRun(body);
    return c.json({ runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

// GET /api/v1/runs - List all runs
runsRoutes.get('/', async (c) => {
  try {
    const runRecords = await db
      .select()
      .from(runs)
      .orderBy(desc(runs.createdAt));

    const summaries: RunSummary[] = runRecords.map(r => ({
      id: r.id,
      config: {
        strategy: r.strategy as any,
        model: r.model,
      },
      status: r.status as any,
      field_averages: r.fieldAverages as any,
      hallucination_count: r.hallucinationCount || 0,
      schema_failure_count: r.schemaFailureCount || 0,
      total_tokens: r.totalTokens as any,
      total_cost_usd: parseFloat(r.totalCostUsd || '0'),
      duration_ms: r.durationMs || 0,
      prompt_hash: r.promptHash,
      created_at: r.createdAt,
    }));

    return c.json(summaries);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

// GET /api/v1/runs/:id - Get run details
runsRoutes.get('/:id', async (c) => {
  const runId = c.req.param('id');

  try {
    const runRecord = await db
      .select()
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);

    if (runRecord.length === 0) {
      return c.json({ error: 'Run not found' }, 404);
    }

    const run = runRecord[0]!;
    const caseResultsRecords = await db
      .select()
      .from(caseResults)
      .where(eq(caseResults.runId, runId));

    const summary: RunSummary = {
      id: run.id,
      config: {
        strategy: run.strategy as any,
        model: run.model,
      },
      status: run.status as any,
      field_averages: run.fieldAverages as any,
      hallucination_count: run.hallucinationCount || 0,
      schema_failure_count: run.schemaFailureCount || 0,
      total_tokens: run.totalTokens as any,
      total_cost_usd: parseFloat(run.totalCostUsd || '0'),
      duration_ms: run.durationMs || 0,
      prompt_hash: run.promptHash,
      created_at: run.createdAt,
    };

    return c.json({
      ...summary,
      case_results: caseResultsRecords
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

// POST /api/v1/runs/:id/resume - Resume a run
runsRoutes.post('/:id/resume', async (c) => {
  const runId = c.req.param('id');

  try {
    await runnerService.resumeRun(runId);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

// GET /api/v1/runs/:id/stream - SSE stream for run progress
runsRoutes.get('/:id/stream', async (c) => {
  const runId = c.req.param('id');

  return new Response(
    new ReadableStream({
      start(controller) {
        const sendEvent = (data: any) => {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Send initial ping
        sendEvent({ type: 'ping' });

        // Listen for case complete events
        const onCaseComplete = (eventRunId: string, event: any) => {
          if (eventRunId === runId) {
            sendEvent({ type: 'case_complete', ...event });
          }
        };

        runnerService.onCaseComplete(onCaseComplete);

        // Clean up on client disconnect
        c.req.raw.signal.addEventListener('abort', () => {
          controller.close();
        });
      }
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    }
  );
});

// GET /api/v1/runs/:id/cases/:transcriptId - Get single case details
runsRoutes.get('/:id/cases/:transcriptId', async (c) => {
  const runId = c.req.param('id');
  const transcriptId = c.req.param('transcriptId');

  try {
    const caseResult = await db
      .select()
      .from(caseResults)
      .where(and(
        eq(caseResults.runId, runId),
        eq(caseResults.transcriptId, transcriptId)
      ))
      .limit(1);

    if (caseResult.length === 0) {
      return c.json({ error: 'Case result not found' }, 404);
    }

    return c.json(caseResult[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

// GET /api/v1/compare - Compare two runs
runsRoutes.get('/compare', async (c) => {
  const runAId = c.req.query('runA');
  const runBId = c.req.query('runB');

  if (!runAId || !runBId) {
    return c.json({ error: 'runA and runB query parameters required' }, 400);
  }

  try {
    const [runARecord, runBRecord] = await Promise.all([
      db.select().from(runs).where(eq(runs.id, runAId)).limit(1),
      db.select().from(runs).where(eq(runs.id, runBId)).limit(1),
    ]);

    if (runARecord.length === 0 || runBRecord.length === 0) {
      return c.json({ error: 'One or both runs not found' }, 404);
    }

    const runA = runARecord[0]!;
    const runB = runBRecord[0]!;

    const runASummary: RunSummary = {
      id: runA.id,
      config: { strategy: runA.strategy as any, model: runA.model },
      status: runA.status as any,
      field_averages: runA.fieldAverages as any,
      hallucination_count: runA.hallucinationCount || 0,
      schema_failure_count: runA.schemaFailureCount || 0,
      total_tokens: runA.totalTokens as any,
      total_cost_usd: parseFloat(runA.totalCostUsd || '0'),
      duration_ms: runA.durationMs || 0,
      prompt_hash: runA.promptHash,
      created_at: runA.createdAt,
    };

    const runBSummary: RunSummary = {
      id: runB.id,
      config: { strategy: runB.strategy as any, model: runB.model },
      status: runB.status as any,
      field_averages: runB.fieldAverages as any,
      hallucination_count: runB.hallucinationCount || 0,
      schema_failure_count: runB.schemaFailureCount || 0,
      total_tokens: runB.totalTokens as any,
      total_cost_usd: parseFloat(runB.totalCostUsd || '0'),
      duration_ms: runB.durationMs || 0,
      prompt_hash: runB.promptHash,
      created_at: runB.createdAt,
    };

    // Calculate deltas and winners
    const deltas = {
      chief_complaint: runASummary.field_averages.chief_complaint - runBSummary.field_averages.chief_complaint,
      vitals: runASummary.field_averages.vitals - runBSummary.field_averages.vitals,
      medications: runASummary.field_averages.medications - runBSummary.field_averages.medications,
      diagnoses: runASummary.field_averages.diagnoses - runBSummary.field_averages.diagnoses,
      plan: runASummary.field_averages.plan - runBSummary.field_averages.plan,
      follow_up: runASummary.field_averages.follow_up - runBSummary.field_averages.follow_up,
      overall: runASummary.field_averages.overall - runBSummary.field_averages.overall,
    };

    const winner_per_field = {
      chief_complaint: deltas.chief_complaint > 0 ? 'A' : deltas.chief_complaint < 0 ? 'B' : 'tie',
      vitals: deltas.vitals > 0 ? 'A' : deltas.vitals < 0 ? 'B' : 'tie',
      medications: deltas.medications > 0 ? 'A' : deltas.medications < 0 ? 'B' : 'tie',
      diagnoses: deltas.diagnoses > 0 ? 'A' : deltas.diagnoses < 0 ? 'B' : 'tie',
      plan: deltas.plan > 0 ? 'A' : deltas.plan < 0 ? 'B' : 'tie',
      follow_up: deltas.follow_up > 0 ? 'A' : deltas.follow_up < 0 ? 'B' : 'tie',
      overall: deltas.overall > 0 ? 'A' : deltas.overall < 0 ? 'B' : 'tie',
    };

    return c.json({
      runA: runASummary,
      runB: runBSummary,
      deltas,
      winner_per_field,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

export { runsRoutes };