export function buildSystemPrompt(): string {
  return `You are a clinical data extractor. Extract structured data from doctor-patient transcripts using the extract_clinical_data tool.
Always use the tool. Never respond with free text.

Before calling the tool, think step by step:
1. What is the patient's chief complaint?
2. What vitals were mentioned?
3. What medications were prescribed?
4. What diagnoses were made?
5. What is the follow-up plan?
Then call extract_clinical_data with your findings.`;
}

export function buildUserPrompt(transcript: string): string {
  return `Extract clinical data from this transcript:

<transcript>
${transcript}
</transcript>`;
}

export const COT_CACHE_CONTROL = {
  type: 'ephemeral' as const
};