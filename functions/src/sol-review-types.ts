export type SolStage = "review" | "rewrite";
export type SolStageStatus = "not_started" | "started" | "succeeded" | "unknown" | "service_error" | "rejected";
export type SolVerdict = "OK" | "NOT_GOOD" | "UNCERTAIN";
export type QuoteContext = {status: "not_quoted" | "unknown"} | {status: "known"; text: string};
export interface SolUsage {inputTokens: number; outputTokens: number; cachedInputTokens: number; reasoningTokens: number}
export interface SolStageRecord {status: SolStageStatus; elapsedMs?: number; usage?: SolUsage}
export interface SolReviewRecord {
  sourceLanguageCode?: string; targetLanguageCode?: string;
  version: "sol-review-v1"; model: "gpt-6.1-sol"; nmtCheck: "passed" | "rejected" | "service_error" | "local";
  nmtReason: string | null; review: SolStageRecord; rewrite: SolStageRecord;
  verdict: SolVerdict | null; reason: string | null; finalSource: "nmt" | "gpt" | "local" | null;
  semanticEvaluation: "not_evaluated" | "nmt_accepted" | "nmt_rejected" | "uncertain";
  quoteStatus: QuoteContext["status"];
}
export function newSolReviewRecord(): SolReviewRecord {
  return {version: "sol-review-v1", model: "gpt-6.1-sol", nmtCheck: "service_error", nmtReason: null,
    review: {status: "not_started"}, rewrite: {status: "not_started"}, verdict: null, reason: null,
    finalSource: null, semanticEvaluation: "not_evaluated", quoteStatus: "not_quoted"};
}
// Explicit projection prevents provider payloads, rejected candidates and identity metadata entering stage records.
export function copySolReviewRecord(value: SolReviewRecord): SolReviewRecord {
  const stage = (item: SolStageRecord): SolStageRecord => ({status: item.status,
    ...(item.elapsedMs === undefined ? {} : {elapsedMs: item.elapsedMs}),
    ...(item.usage ? {usage: {inputTokens: item.usage.inputTokens, outputTokens: item.usage.outputTokens,
      cachedInputTokens: item.usage.cachedInputTokens, reasoningTokens: item.usage.reasoningTokens}} : {})});
  return {version: value.version, model: value.model, nmtCheck: value.nmtCheck, nmtReason: value.nmtReason,
    ...(value.sourceLanguageCode === undefined ? {} : {sourceLanguageCode: value.sourceLanguageCode}),
    ...(value.targetLanguageCode === undefined ? {} : {targetLanguageCode: value.targetLanguageCode}),
    review: stage(value.review), rewrite: stage(value.rewrite), verdict: value.verdict, reason: value.reason,
    finalSource: value.finalSource, semanticEvaluation: value.semanticEvaluation, quoteStatus: value.quoteStatus};
}
export interface SolStageControl {
  begin(stage: SolStage, record: SolReviewRecord): Promise<void>;
  finish(stage: SolStage, record: SolReviewRecord): Promise<void>;
}
export class SolServiceError extends Error {
  constructor(public readonly stage: SolStage, public readonly code: "sol_unavailable" | "sol_invalid_response" | "sol_stage_store_error") {
    super(code); this.name = "SolServiceError";
  }
}
