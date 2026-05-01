import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid, jsonb, integer, numeric, boolean, index } from "drizzle-orm/pg-core";

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(), // 'pending' | 'running' | 'completed' | 'failed' | 'paused'
    promptHash: text("prompt_hash").notNull(),
    fieldAverages: jsonb("field_averages").$type<{
      chief_complaint: number;
      vitals: number;
      medications: number;
      diagnoses: number;
      plan: number;
      follow_up: number;
      overall: number;
    }>(),
    hallucinationCount: integer("hallucination_count"),
    schemaFailureCount: integer("schema_failure_count"),
    totalTokens: jsonb("total_tokens").$type<{
      input: number;
      output: number;
      cache_read: number;
      cache_write: number;
    }>(),
    totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 4 }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("runs_strategy_model_idx").on(table.strategy, table.model),
    index("runs_status_idx").on(table.status),
    index("runs_created_at_idx").on(table.createdAt),
  ]
);

export const caseResults = pgTable(
  "case_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id").notNull(),
    prediction: jsonb("prediction").notNull(),
    gold: jsonb("gold").notNull(),
    scores: jsonb("scores").$type<{
      chief_complaint: number;
      vitals: number;
      medications: number;
      diagnoses: number;
      plan: number;
      follow_up: number;
      overall: number;
    }>().notNull(),
    attempts: integer("attempts").notNull(),
    schemaValid: boolean("schema_valid").notNull(),
    hallucinationCount: integer("hallucination_count").notNull(),
    tokens: jsonb("tokens").$type<{
      input: number;
      output: number;
      cache_read: number;
      cache_write: number;
    }>().notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    llmTrace: jsonb("llm_trace").$type<{
      attempts: Array<{
        attempt: number;
        request: any;
        response: any;
        duration_ms: number;
        timestamp: Date;
      }>;
    }>(),
  },
  (table) => [
    index("case_results_run_id_idx").on(table.runId),
    index("case_results_transcript_id_idx").on(table.transcriptId),
    index("case_results_run_transcript_idx").on(table.runId, table.transcriptId),
  ]
);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    hash: text("hash").primaryKey(),
    strategy: text("strategy").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("prompt_versions_strategy_idx").on(table.strategy),
  ]
);

// Relations
export const runsRelations = relations(runs, ({ many }) => ({
  caseResults: many(caseResults),
}));

export const caseResultsRelations = relations(caseResults, ({ one }) => ({
  run: one(runs, {
    fields: [caseResults.runId],
    references: [runs.id],
  }),
}));