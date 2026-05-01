import { createHash } from 'crypto';
import type { PromptStrategy } from '@test-evals/shared';

export function buildPromptHash(systemPrompt: string, userPromptTemplate: string): string {
  const content = systemPrompt + userPromptTemplate;
  return createHash('sha256').update(content).digest('hex');
}

export function getStrategyModule(strategy: PromptStrategy) {
  switch (strategy) {
    case 'zero_shot':
      return import('./strategies/zero_shot');
    case 'few_shot':
      return import('./strategies/few_shot');
    case 'cot':
      return import('./strategies/cot');
    default:
      throw new Error(`Unknown strategy: ${strategy}`);
  }
}