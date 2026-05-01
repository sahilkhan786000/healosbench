import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from 'fs';
import { anthropic, EXTRACT_TOOL } from './index';
import { getStrategyModule } from './utils';
const schema = JSON.parse(readFileSync(new URL('../../../../data/schema.json', import.meta.url), 'utf-8'));
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateSchema = ajv.compile(schema);
export async function extractWithRetry(transcript, strategy, model, maxAttempts = 3) {
    const strategyModule = await getStrategyModule(strategy);
    const systemPrompt = strategyModule.buildSystemPrompt();
    const userPrompt = strategyModule.buildUserPrompt(transcript);
    const messages = [
        {
            role: 'system',
            content: [
                {
                    type: 'text',
                    text: systemPrompt,
                    cache_control: { type: 'ephemeral' }
                }
            ]
        },
        {
            role: 'user',
            content: userPrompt
        }
    ];
    const trace = { attempts: [] };
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const startTime = Date.now();
        try {
            const response = await anthropic.messages.create({
                model,
                max_tokens: 4096,
                messages,
                tools: [EXTRACT_TOOL],
                tool_choice: { type: 'tool', name: 'extract_clinical_data' }
            });
            const duration = Date.now() - startTime;
            // Track token usage
            totalInputTokens += response.usage.input_tokens;
            totalOutputTokens += response.usage.output_tokens;
            if (response.usage.cache_read_input_tokens) {
                totalCacheReadTokens += response.usage.cache_read_input_tokens;
            }
            if (response.usage.cache_creation_input_tokens) {
                totalCacheWriteTokens += response.usage.cache_creation_input_tokens;
            }
            const attemptTrace = {
                attempt,
                request: {
                    messages: messages.map(msg => ({ ...msg })),
                    model,
                    max_tokens: 4096,
                    tools: [EXTRACT_TOOL],
                    tool_choice: { type: 'tool', name: 'extract_clinical_data' }
                },
                response: {
                    content: response.content,
                    usage: response.usage,
                    stop_reason: response.stop_reason
                },
                duration_ms: duration,
                timestamp: new Date()
            };
            trace.attempts.push(attemptTrace);
            // Check if tool was called
            const toolCalls = response.content.filter((c) => c.type === 'tool_use');
            if (toolCalls.length === 0) {
                // No tool call, add instruction to use tool
                messages.push({
                    role: 'assistant',
                    content: response.content
                });
                messages.push({
                    role: 'user',
                    content: 'Please use the extract_clinical_data tool to extract the clinical data.'
                });
                continue;
            }
            // Extract tool arguments
            const toolCall = toolCalls[0];
            let extraction;
            try {
                extraction = JSON.parse(toolCall.input);
            }
            catch (e) {
                // Invalid JSON, add feedback
                messages.push({
                    role: 'assistant',
                    content: response.content
                });
                messages.push({
                    role: 'user',
                    content: `The tool call arguments are not valid JSON. Please fix and call the tool again. Error: ${e}`
                });
                continue;
            }
            // Validate against schema
            const isValid = validateSchema(extraction);
            if (!isValid) {
                const errors = validateSchema.errors?.map(e => `${e.instancePath} ${e.message}`).join('; ') || 'Unknown validation error';
                messages.push({
                    role: 'assistant',
                    content: response.content
                });
                messages.push({
                    role: 'user',
                    content: `Schema validation failed: ${errors}. Please fix the extraction and call the tool again.`
                });
                continue;
            }
            // Success!
            return {
                result: extraction,
                schema_valid: true,
                attempts: attempt,
                trace,
                tokens: {
                    input: totalInputTokens,
                    output: totalOutputTokens,
                    cache_read: totalCacheReadTokens,
                    cache_write: totalCacheWriteTokens
                }
            };
        }
        catch (error) {
            console.error(`Attempt ${attempt} failed:`, error);
            // For rate limits or other errors, we could add backoff here
            // For now, just continue to next attempt
            continue;
        }
    }
    // All attempts failed
    return {
        result: null,
        schema_valid: false,
        attempts: maxAttempts,
        trace,
        tokens: {
            input: totalInputTokens,
            output: totalOutputTokens,
            cache_read: totalCacheReadTokens,
            cache_write: totalCacheWriteTokens
        }
    };
}
