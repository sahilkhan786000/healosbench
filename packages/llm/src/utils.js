import { createHash } from 'crypto';
export function buildPromptHash(systemPrompt, userPromptTemplate) {
    const content = systemPrompt + userPromptTemplate;
    return createHash('sha256').update(content).digest('hex');
}
export function getStrategyModule(strategy) {
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
