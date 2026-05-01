import { extractWithRetry } from '@test-evals/llm';
import type { CaseResult, PromptStrategy } from '@test-evals/shared';
import { evaluateCase } from './evaluate.service';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function extractTranscript(
  transcriptId: string,
  transcript: string,
  strategy: PromptStrategy,
  model: string
): Promise<CaseResult> {
  const startTime = Date.now();

  // Load gold data for comparison
  const goldPath = join(process.cwd(), '..', '..', 'data', 'gold', `${transcriptId}.json`);
  const gold: any = JSON.parse(readFileSync(goldPath, 'utf-8'));

  // Extract with retry
  const extractResult = await extractWithRetry(transcript, strategy, model);

  const duration = Date.now() - startTime;

  // Calculate cost (rough estimate for Haiku)
  const inputCostPerToken = 0.00000025; // $0.25 per million tokens
  const outputCostPerToken = 0.00000125; // $1.25 per million tokens
  const cost = (extractResult.tokens.input * inputCostPerToken) +
               (extractResult.tokens.output * outputCostPerToken);

  // Evaluate the result
  const evaluation = extractResult.result
    ? evaluateCase(extractResult.result, gold, transcript)
    : { scores: {
        chief_complaint: 0,
        vitals: 0,
        medications: 0,
        diagnoses: 0,
        plan: 0,
        follow_up: 0,
        overall: 0
      }, hallucination_count: 0 };

  const caseResult: CaseResult = {
    transcript_id: transcriptId,
    prediction: extractResult.result || {} as any,
    gold,
    scores: evaluation.scores,
    attempts: extractResult.attempts,
    schema_valid: extractResult.schema_valid,
    hallucination_count: evaluation.hallucination_count,
    tokens: extractResult.tokens,
    cost_usd: cost,
    duration_ms: duration
  };

  return caseResult;
}