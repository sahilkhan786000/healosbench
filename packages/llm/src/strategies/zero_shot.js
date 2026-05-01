export function buildSystemPrompt() {
    return `You are a clinical data extractor. Extract structured data from doctor-patient transcripts using the extract_clinical_data tool.
Always use the tool. Never respond with free text.`;
}
export function buildUserPrompt(transcript) {
    return `Extract clinical data from this transcript:

<transcript>
${transcript}
</transcript>`;
}
export const ZERO_SHOT_CACHE_CONTROL = {
    type: 'ephemeral'
};
