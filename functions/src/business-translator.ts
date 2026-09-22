import type {TranslationContext, Translator} from "./services.js";
import {
  DEFAULT_PROTECTED_NAMES,
  TRADE_TRANSLATION_POLICY,
  TranslationQualityError,
  prepareTradeText,
  restoreTradeTranslationWithRanges,
  validateTradeTerminology,
} from "./trade-policy.js";

export interface GenerationRequest {
  systemInstruction: string;
  input: string;
}

export interface TextGenerator {
  generate(request: GenerationRequest): Promise<string>;
}

export interface BusinessTranslatorOptions {
  protectedNames?: readonly string[];
  onValidationRetry?: (reason: string) => void;
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  "zh-TW": "Traditional Chinese (Taiwan)",
  en: "English",
  vi: "Vietnamese",
};

export class BusinessTranslator implements Translator {
  public constructor(
    private readonly generator: TextGenerator,
    private readonly options: BusinessTranslatorOptions = {},
  ) {}

  public async translate(text: string, sourceLanguageCode: string, targetLanguageCode: string,
    context?: TranslationContext): Promise<string> {
    return (await this.translateWithRanges(text, sourceLanguageCode, targetLanguageCode, context)).text;
  }

  public async translateWithRanges(text: string, sourceLanguageCode: string, targetLanguageCode: string,
    context?: TranslationContext) {
    if (!LANGUAGE_NAMES[sourceLanguageCode] || !LANGUAGE_NAMES[targetLanguageCode]) {
      throw new TranslationQualityError("unsupported_language");
    }
    const prepared = prepareTradeText(text, this.options.protectedNames ?? DEFAULT_PROTECTED_NAMES,
      context?.protectedRanges);

    let previousFailure: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.generator.generate({
        systemInstruction: TRADE_TRANSLATION_POLICY + (previousFailure === "negotiation_timing" ?
          "\nCorrection required: use right away or at the outset for disclosure timing, not all at once." :
          previousFailure === "unjustified_price_floor" ?
            "\nCorrection required: best price means 最優惠報價; do not invent a minimum price commitment." : ""),
        input: JSON.stringify({
          sourceLanguage: LANGUAGE_NAMES[sourceLanguageCode],
          targetLanguage: LANGUAGE_NAMES[targetLanguageCode],
          text: prepared.text,
          protectedValues: prepared.protectedValues,
          ...(previousFailure ? {validationFeedback: previousFailure} : {}),
        }),
      });
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" ||
            !("translation" in parsed) || typeof parsed.translation !== "string" ||
            Object.keys(parsed).length !== 1) {
          throw new TranslationQualityError("invalid_response_format");
        }
        const result = restoreTradeTranslationWithRanges(prepared, parsed.translation);
        const restored = result.text;
        let sourceBody = prepared.text;
        let targetBody = parsed.translation;
        for (const item of prepared.protectedValues) {
          sourceBody = sourceBody.replace(item.token, "");
          targetBody = targetBody.replace(item.token, "");
        }
        if (/\p{L}/u.test(sourceBody) && (
          targetLanguageCode === "zh-TW" ? !/\p{Script=Han}/u.test(targetBody) :
            !/\p{Script=Latin}/u.test(targetBody)
        )) throw new TranslationQualityError("wrong_target_language");
        validateTradeTerminology(text, restored, targetLanguageCode);
        return result;
      } catch (error: unknown) {
        const safeError = error instanceof TranslationQualityError ? error :
          new TranslationQualityError("invalid_response_format");
        if (attempt === 1) throw safeError;
        previousFailure = safeError.reason;
        this.options.onValidationRetry?.(safeError.reason);
      }
    }
    throw new TranslationQualityError("invalid_response_format");
  }
}

interface VertexResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {parts?: Array<{text?: string; thought?: boolean}>};
  }>;
}

export interface VertexClient {
  request(options: {
    url: string;
    method: "POST";
    data: unknown;
    timeout: number;
    retry: false;
  }): Promise<{data: VertexResponse}>;
}

export interface VertexGeneratorOptions {
  projectId: string;
  model?: string;
  location?: string;
}

export class TranslationServiceError extends Error {
  public constructor() {
    super("Business translation service is unavailable.");
    this.name = "TranslationServiceError";
  }
}

export class VertexTextGenerator implements TextGenerator {
  private client: VertexClient | undefined;
  private readonly url: string;

  public constructor(options: VertexGeneratorOptions, client?: VertexClient) {
    const model = options.model ?? "gemini-3.5-flash";
    const location = options.location ?? "global";
    if (!/^[a-z][a-z0-9-]{4,62}$/u.test(options.projectId) ||
        !/^[a-z][a-z0-9-]*$/u.test(location) || !/^gemini-[a-z0-9.-]+$/u.test(model)) {
      throw new Error("Invalid business translation configuration.");
    }
    const host = location === "global" ? "aiplatform.googleapis.com" : location + "-aiplatform.googleapis.com";
    this.url = "https://" + host + "/v1/projects/" + options.projectId + "/locations/" +
      location + "/publishers/google/models/" + model + ":generateContent";
    this.client = client;
  }

  public async generate(request: GenerationRequest): Promise<string> {
    try {
      const client = await this.getClient();
      const response = await client.request({
        url: this.url,
        method: "POST",
        timeout: 15_000,
        retry: false,
        data: {
          systemInstruction: {parts: [{text: request.systemInstruction}]},
          contents: [{role: "user", parts: [{text: request.input}]}],
          generationConfig: {
            candidateCount: 1,
            thinkingConfig: {thinkingLevel: "LOW"},
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {translation: {type: "STRING"}},
              required: ["translation"],
            },
          },
        },
      });
      const candidate = response.data.candidates?.[0];
      if (candidate?.finishReason !== "STOP") throw new TranslationServiceError();
      const text = candidate.content?.parts?.filter((part) => !part.thought)
        .map((part) => part.text ?? "").join("").trim();
      if (!text) throw new TranslationServiceError();
      return text;
    } catch {
      // SDK errors may contain credentials, request bodies or customer messages.
      throw new TranslationServiceError();
    }
  }

  private async getClient(): Promise<VertexClient> {
    if (!this.client) {
      const {GoogleAuth} = await import("google-auth-library");
      const auth = new GoogleAuth({scopes: ["https://www.googleapis.com/auth/cloud-platform"]});
      this.client = await auth.getClient();
    }
    return this.client;
  }
}
