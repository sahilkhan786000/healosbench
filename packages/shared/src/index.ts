// Extraction schema types matching schema.json
export interface ExtractionResult {
  chief_complaint: string;
  vitals: {
    bp: string | null;
    hr: number | null;
    temp_f: number | null;
    spo2: number | null;
  };
  medications: Array<{
    name: string;
    dose: string | null;
    frequency: string | null;
    route: string | null;
  }>;
  diagnoses: Array<{
    description: string;
    icd10?: string;
  }>;
  plan: string[];
  follow_up: {
    interval_days: number | null;
    reason: string | null;
  };
}

// Run DTOs
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

export type PromptStrategy = 'zero_shot' | 'few_shot' | 'cot';

export interface RunConfig {
  strategy: PromptStrategy;
  model: string;
  dataset_filter?: string[];
  force?: boolean;
}

export interface CaseResult {
  transcript_id: string;
  prediction: ExtractionResult;
  gold: ExtractionResult;
  scores: FieldScores;
  attempts: number;
  schema_valid: boolean;
  hallucination_count: number;
  tokens: TokenUsage;
  cost_usd: number;
  duration_ms: number;
}

export interface FieldScores {
  chief_complaint: number;
  vitals: number;
  medications: number;
  diagnoses: number;
  plan: number;
  follow_up: number;
  overall: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export interface RunSummary {
  id: string;
  config: RunConfig;
  status: RunStatus;
  field_averages: FieldScores;
  hallucination_count: number;
  schema_failure_count: number;
  total_tokens: TokenUsage;
  total_cost_usd: number;
  duration_ms: number;
  prompt_hash: string;
  created_at: Date;
}

// Additional types for API responses
export interface CaseCompleteEvent {
  transcript_id: string;
  scores: FieldScores;
  progress: number; // 0-100
}

export interface CompareResult {
  runA: RunSummary;
  runB: RunSummary;
  deltas: FieldScores;
  winner_per_field: Record<keyof FieldScores, 'A' | 'B' | 'tie'>;
}

// LLM trace types
export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string of the tool arguments
  };
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text';
    text: string;
  } | LLMToolCall>;
}

export interface LLMAttempt {
  attempt: number;
  request: {
    messages: LLMMessage[];
    model: string;
    max_tokens: number;
    tools?: any[];
    tool_choice?: any;
  };
  response: {
    content: string | LLMToolCall[];
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    stop_reason: string;
  };
  duration_ms: number;
  timestamp: Date;
}

export interface LLMTrace {
  attempts: LLMAttempt[];
}