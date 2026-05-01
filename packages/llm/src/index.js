import Anthropic from '@anthropic-ai/sdk';
import { env } from '@test-evals/env/server';
// Initialize Anthropic client
export const anthropic = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
});
// Tool definition for extract_clinical_data
export const EXTRACT_TOOL = {
    name: 'extract_clinical_data',
    description: 'Extract structured clinical data from a doctor-patient transcript',
    input_schema: {
        type: 'object',
        properties: {
            chief_complaint: {
                type: 'string',
                description: 'The patient\'s primary reason for the visit, in their words or a brief clinical summary.'
            },
            vitals: {
                type: 'object',
                properties: {
                    bp: {
                        type: ['string', 'null'],
                        description: 'Blood pressure as systolic/diastolic mmHg, e.g. "128/82".'
                    },
                    hr: {
                        type: ['integer', 'null'],
                        description: 'Heart rate in beats per minute.'
                    },
                    temp_f: {
                        type: ['number', 'null'],
                        description: 'Temperature in degrees Fahrenheit.'
                    },
                    spo2: {
                        type: ['integer', 'null'],
                        description: 'Oxygen saturation, percent.'
                    }
                },
                required: ['bp', 'hr', 'temp_f', 'spo2']
            },
            medications: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        dose: { type: ['string', 'null'] },
                        frequency: { type: ['string', 'null'] },
                        route: { type: ['string', 'null'] }
                    },
                    required: ['name', 'dose', 'frequency', 'route']
                }
            },
            diagnoses: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        description: { type: 'string' },
                        icd10: { type: 'string' }
                    },
                    required: ['description']
                }
            },
            plan: {
                type: 'array',
                items: { type: 'string' }
            },
            follow_up: {
                type: 'object',
                properties: {
                    interval_days: { type: ['integer', 'null'] },
                    reason: { type: ['string', 'null'] }
                },
                required: ['interval_days', 'reason']
            }
        },
        required: ['chief_complaint', 'vitals', 'medications', 'diagnoses', 'plan', 'follow_up']
    }
};
// Re-export utilities and functions
export { extractWithRetry } from './extract';
export { buildPromptHash, getStrategyModule } from './utils';
