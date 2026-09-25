import {TranslationQualityError} from "./trade-policy.js";

export const UNCHANGED_TRANSLATION_REPLY = "👆";
export const TRANSLATION_FAILURE_REPLY = "🚧";
export type FailureStage = "input" | "audio_download" | "transcription" | "translation_setup" | "translation" | "reply_validation";
export type ContentLimitReason = "text_too_long" | "audio_too_long" | "audio_too_large" | "transcript_too_long";
export class ContentLimitError extends Error {
  constructor(public readonly reason: ContentLimitReason, message: string = reason) {
    super(message);
    this.name = "ContentLimitError";
  }
}

// Only code-owned diagnostic values may leave the error object. Never retain SDK messages/causes.
const qualityReasons = new Set([
  "protected_value_changed", "pricing_terminology", "invalid_input_length", "invalid_protected_range",
  "encoded_input_too_long", "invalid_response_format", "wrong_target_language", "output_too_long",
  "empty_output", "paragraph_structure_changed", "exact_occurrence_changed", "actor_role_changed",
  "quantity_relationship_changed", "price_relationship_changed", "mention_quantity_changed",
  "packaging_commitment_changed", "packaging_object_changed", "packaging_condition_changed",
  "unjustified_tax_inclusion", "unexpected_number_or_token", "unprotected_trade_data", "duplicated_person",
]);
export function failureReason(error: unknown, stage: FailureStage): string {
  if (error instanceof ContentLimitError) return error.reason;
  if (error instanceof TranslationQualityError) return qualityReasons.has(error.reason) ? error.reason : "quality_rejected";
  return {input: "input_processing_error", audio_download: "audio_download_error",
    transcription: "transcription_error", translation_setup: "translation_configuration_error",
    translation: "translation_service_error", reply_validation: "reply_format_rejected"}[stage];
}
