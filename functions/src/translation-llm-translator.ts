import {createContextLlmHtml} from "./translation-llm-context-html.js";
import {prepareLlmContext} from "./translation-llm-context.js";
import {validateContextLlmMeaning} from "./translation-llm-context-meaning.js";
import {validateLlmMentionSubjects} from "./translation-llm-subjects.js";
import type {TranslationContext, Translator} from "./services.js";
import {DEFAULT_PROTECTED_NAMES, restoreTradeTranslationWithRanges,
  TranslationQualityError, validateTradeTerminology} from "./trade-policy.js";
import {createLlmWireText, decodeLlmTransport, validateLlmMeaning, normalizeLlmCalendar, normalizeLlmGlossaryGrammar} from "./translation-llm-protection.js";

export const TRANSLATION_LLM_ADAPTER_VERSION = "candidate-context-quantity-v13";
export interface TranslationLlmRequest {
  parent: string; model: string; contents: string[]; mimeType: "text/plain" | "text/html";
  sourceLanguageCode: string; targetLanguageCode: string;
  glossaryConfig: {glossary: string; ignoreCase: false; contextualTranslationEnabled: false};
}
export interface TranslationLlmClient {
  translateText(request: TranslationLlmRequest, options: {timeout: number; retry: {retryCodes: number[]}}):
    Promise<[{glossaryTranslations?: Array<{translatedText?: string | null}> | null}, ...unknown[]]>;
}
export interface TranslationLlmMetric {
  engine: "translation-llm"; direction: string; attempt: number; elapsedMs: number;
  inputCharacters: number; outputCharacters: number;
  outcome: "success" | "quality_rejected" | "service_error"; reason?: string;
}
export interface TranslationLlmOptions {
  projectId: string; location: string; glossaryZhEn: string; glossaryEnZh: string;
  protectedNames?: readonly string[]; onMetric?: (metric: TranslationLlmMetric) => void;
}
export class TranslationLlmServiceError extends Error {
  public constructor() { super("Translation LLM service is unavailable."); this.name = "TranslationLlmServiceError"; }
}
let traditional: ((text: string) => string) | undefined;
export class TranslationLlmTranslator implements Translator {
  private readonly parent: string;
  public constructor(private readonly options: TranslationLlmOptions, private client?: TranslationLlmClient) {
    if (!/^[a-z][a-z0-9-]{4,62}$/u.test(options.projectId) || !/^[a-z]+-[a-z]+\d$/u.test(options.location)) throw new Error("Invalid Translation LLM configuration.");
    this.parent = "projects/" + options.projectId + "/locations/" + options.location;
    for (const glossary of [options.glossaryZhEn, options.glossaryEnZh]) {
      if (!glossary.startsWith(this.parent + "/glossaries/") || !/^[A-Za-z0-9_-]+$/u.test(glossary.slice((this.parent + "/glossaries/").length))) throw new Error("Invalid Translation LLM glossary configuration.");
    }
  }
  public async translate(text: string, source: string, target: string, context?: TranslationContext): Promise<string> {
    return (await this.translateWithRanges(text, source, target, context)).text;
  }
  public async translateWithRanges(text: string, source: string, target: string, context?: TranslationContext) {
    if (!((source === "en" && target === "zh-TW") || (source === "zh-TW" && target === "en"))) throw new TranslationQualityError("unsupported_language");
    if (!text.trim() || text.length > 2000) throw new TranslationQualityError("invalid_input_length");
    let end = 0;
    for (const range of [...context?.protectedRanges ?? []].sort((a, b) => a.start - b.start)) {
      if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.length) || range.start < end || range.length <= 0 || range.start + range.length > text.length) throw new TranslationQualityError("invalid_protected_range");
      end = range.start + range.length;
    }
    const prepared = prepareLlmContext(text, this.options.protectedNames ?? DEFAULT_PROTECTED_NAMES, context?.protectedRanges, target);
    const tokenPattern = new RegExp(prepared.prefix + "\\d+__", "gu");
    if (!/\p{L}/u.test(prepared.text.replace(tokenPattern, ""))) return restoreTradeTranslationWithRanges(prepared, prepared.text);
    const quotePattern = /[“「"]([^”」"\r\n]+)[”」"]/gu;
    const quotes = source === "en" ? [...new Set([...prepared.text.matchAll(quotePattern)].map(match => match[1]!).filter(value => /[A-Za-z]/u.test(value.replace(tokenPattern, ""))))] : [];
    const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    let previousFailure: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const html = createContextLlmHtml(prepared, attempt > 1, previousFailure === "price_relationship_changed");
      const auxiliaries = quotes.map(quote => {
        const subset = {...prepared, text: quote, protectedValues: prepared.protectedValues.filter(item => quote.includes(item.token)), rangeTokens: prepared.rangeTokens.filter(item => quote.includes(item.token))};
        return {quote, wire: createLlmWireText(subset)};
      });
      const contents = [html.encode(), ...auxiliaries.map(({quote, wire}, i) => '<div id="a' + i + '">' + escapeHtml(wire.encode(quote)) + '</div>')];
      const inputCharacters = contents.reduce((sum, part) => sum + [...part].length, 0);
      if (inputCharacters > 30000 || contents.length > 1024) throw new TranslationQualityError("encoded_input_too_long");
      const started = Date.now();
      let response: Awaited<ReturnType<TranslationLlmClient["translateText"]>>[0];
      try {
        if (!this.client) {const {v3} = await import("@google-cloud/translate"); this.client = new v3.TranslationServiceClient();}
        [response] = await this.client.translateText({parent: this.parent, model: this.parent + "/models/general/translation-llm", contents,
          mimeType: "text/html", sourceLanguageCode: source, targetLanguageCode: target,
          glossaryConfig: {glossary: source === "en" ? this.options.glossaryEnZh : this.options.glossaryZhEn, ignoreCase: false, contextualTranslationEnabled: false}}, {timeout: 15000, retry: {retryCodes: []}});
      } catch {
        this.options.onMetric?.({engine: "translation-llm", direction: source + ":" + target, attempt, elapsedMs: Date.now() - started, inputCharacters, outputCharacters: 0, outcome: "service_error"});
        throw new TranslationLlmServiceError();
      }
      try {
        const translations = response?.glossaryTranslations;
        if (!Array.isArray(translations) || translations.length !== contents.length || translations.some(part => !part || typeof part.translatedText !== "string" || !part.translatedText.trim())) throw new TranslationQualityError("invalid_response_format");
        const outputCharacters = translations.reduce((sum, part) => sum + [...part.translatedText!].length, 0);
        const decoded = html.decode(translations[0]!.translatedText!);
        let masked = decoded.masked;
        // Only unchanged source quotes use their auxiliary; the complete message remains primary.
        const replacements = new Map(auxiliaries.map(({quote, wire}, i) => {
          const auxiliary = translations[i + 1]!.translatedText!;
          const match = auxiliary.match(new RegExp('^<div id="a' + i + '">([^<>]*)</div>$', "u"));
          if (!match) throw new TranslationQualityError("paragraph_structure_changed");
          return [quote, wire.decode(decodeLlmTransport(match[1]!))];
        }));
        masked = masked.replace(quotePattern, (whole, inner: string) => replacements.has(inner) ? whole.slice(0, 1) + (replacements.get(inner) ?? inner) + whole.slice(-1) : whole);
        if (target === "zh-TW") {
          traditional ??= (await import("opencc-js/cn2t")).Converter({from: "cn", to: "tw"});
          if (!traditional) throw new Error("Traditional Chinese converter unavailable.");
          masked = traditional(masked);
        }
        masked = normalizeLlmGlossaryGrammar(masked, target);
        masked = normalizeLlmCalendar(text, masked, target);
        const result = restoreTradeTranslationWithRanges(decoded.restoration, masked);
        validateLlmMentionSubjects(prepared, masked, source, target);
        validateContextLlmMeaning(prepared, masked, result.text, target);
        const sourceBody = prepared.text.replace(tokenPattern, ""), targetBody = masked.replace(tokenPattern, "");
        if (/\p{L}/u.test(sourceBody) && (target === "zh-TW" ? !/\p{Script=Han}/u.test(targetBody) : (!/\p{Script=Latin}/u.test(targetBody) || /\p{Script=Han}/u.test(targetBody)))) throw new TranslationQualityError("wrong_target_language");
        validateTradeTerminology(text, result.text, target);
        validateLlmMeaning(text, result.text, target, prepared.protectedValues.filter(item => item.kind === "person" || item.kind === "person-mention").map(item => item.value), prepared.protectedValues.filter(item => item.kind === "quantity").map(item => item.value));
        if (target === "en" && result.ranges.length) {
          const original = result.text; let spaced = "", position = 0;
          for (const range of result.ranges) {
            const start = range.start; spaced += original.slice(position, start);
            if (/[\p{L}\p{N}]$/u.test(spaced)) spaced += " ";
            range.start = spaced.length; position = start + range.length; spaced += original.slice(start, position);
            if (/^[\p{L}\p{N}]/u.test(original.slice(position))) spaced += " ";
          }
          result.text = spaced + original.slice(position);
          if (result.text.length > 4500) throw new TranslationQualityError("output_too_long");
        }
        this.options.onMetric?.({engine: "translation-llm", direction: source + ":" + target, attempt, elapsedMs: Date.now() - started, inputCharacters, outputCharacters, outcome: "success"});
        return result;
      } catch (error) {
        const failure = error instanceof TranslationQualityError ? error : new TranslationQualityError("invalid_response_format");
        const outputCharacters = Array.isArray(response?.glossaryTranslations) ? response.glossaryTranslations.reduce((sum, part) => sum + (typeof part?.translatedText === "string" ? [...part.translatedText].length : 0), 0) : 0;
        this.options.onMetric?.({engine: "translation-llm", direction: source + ":" + target, attempt, elapsedMs: Date.now() - started, inputCharacters, outputCharacters, outcome: "quality_rejected", reason: failure.reason});
        previousFailure = failure.reason;
        if (attempt === 2) throw failure;
      }
    }
    throw new TranslationQualityError("invalid_response_format");
  }
}
