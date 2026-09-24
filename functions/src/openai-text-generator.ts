// Evaluation-only adapter. Neither deployed program imports this module.
import {TranslationServiceError, type GenerationRequest, type TextGenerator} from "./business-translator.js";

export const OPENAI_EVALUATION_MODELS = ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"] as const;
export type OpenAiEvaluationModel = typeof OPENAI_EVALUATION_MODELS[number];
export interface OpenAiUsage {inputTokens: number; outputTokens: number}
export class OpenAiServiceError extends TranslationServiceError {
  public constructor(public readonly status?: number) { super(); this.name = "OpenAiServiceError"; }
}
interface Options {
  apiKey: string;
  model: OpenAiEvaluationModel;
  onUsage?: (usage: OpenAiUsage) => void;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class OpenAiTextGenerator implements TextGenerator {
  public constructor(private readonly options: Options, private readonly fetcher: typeof fetch = fetch) {
    if (!options.apiKey.trim() || /[\r\n]/u.test(options.apiKey) ||
        !OPENAI_EVALUATION_MODELS.includes(options.model)) {
      throw new Error("Invalid OpenAI evaluation configuration.");
    }
  }
  public async generate(request: GenerationRequest): Promise<string> {
    try {
      const response = await this.fetcher("https://api.openai.com/v1/responses", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: {"Content-Type": "application/json", Authorization: "Bearer " + this.options.apiKey},
        body: JSON.stringify({
          model: this.options.model, instructions: request.systemInstruction, input: request.input,
          store: false, reasoning: {effort: "low"}, max_output_tokens: 4096,
          text: {format: {
            type: "json_schema", name: "translation", strict: true,
            schema: {type: "object", properties: {translation: {type: "string"}},
              required: ["translation"], additionalProperties: false},
          }},
        }),
      });
      if (!response.ok) throw new OpenAiServiceError(response.status);
      const data: unknown = await response.json();
      if (!record(data)) throw new OpenAiServiceError();
      const usage = data.usage;
      if (record(usage) && Number.isSafeInteger(usage.input_tokens) && Number.isSafeInteger(usage.output_tokens) &&
          (usage.input_tokens as number) >= 0 && (usage.output_tokens as number) >= 0) {
        this.options.onUsage?.({inputTokens: usage.input_tokens as number, outputTokens: usage.output_tokens as number});
      }
      if (data.status !== "completed" || data.error || !Array.isArray(data.output)) throw new OpenAiServiceError();
      const messages = data.output.filter(item => record(item) && item.type !== "reasoning");
      if (messages.length !== 1) throw new OpenAiServiceError();
      const message: unknown = messages[0];
      if (!record(message) || message.type !== "message" || message.role !== "assistant" ||
          message.status !== "completed" || !Array.isArray(message.content) || !message.content.length) {
        throw new OpenAiServiceError();
      }
      let text = "";
      for (const part of message.content) {
        if (!record(part) || part.type !== "output_text" || typeof part.text !== "string") {
          throw new OpenAiServiceError();
        }
        text += part.text;
      }
      if (!text.trim() || text.length > 25000) throw new OpenAiServiceError();
      return text;
    } catch (error) {
      // Never expose response bodies, request bodies, headers, or SDK/fetch error causes.
      throw new OpenAiServiceError(error instanceof OpenAiServiceError ? error.status : undefined);
    }
  }
}
