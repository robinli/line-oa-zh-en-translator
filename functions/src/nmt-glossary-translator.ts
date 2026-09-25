import {createContextLlmHtml} from "./nmt-context-html.js";
import {prepareLlmContext} from "./nmt-context.js";
import {validateContextLlmMeaning} from "./nmt-context-meaning.js";
import {validateLlmMentionSubjects} from "./nmt-subjects.js";
import type {TranslationContext, Translator} from "./services.js";
import {DEFAULT_PROTECTED_NAMES, restoreTradeTranslationWithRanges,
  TranslationQualityError, validateTradeTerminology} from "./trade-policy.js";
import {createLlmWireText, decodeLlmTransport, validateLlmMeaning, normalizeLlmCalendar, normalizeLlmGlossaryGrammar} from "./nmt-protection.js";

export const NMT_GLOSSARY_ADAPTER_VERSION = "nmt-glossary-v21";
export interface NmtGlossaryRequest {
  parent: string; model: string; contents: string[]; mimeType: "text/plain" | "text/html";
  sourceLanguageCode: string; targetLanguageCode: string;
  glossaryConfig: {glossary: string; ignoreCase: false; contextualTranslationEnabled: false};
}
export interface NmtGlossaryClient {
  translateText(request: NmtGlossaryRequest, options: {timeout: number; retry: {retryCodes: number[]}}):
    Promise<[{glossaryTranslations?: Array<{translatedText?: string | null}> | null}, ...unknown[]]>;
}
export interface NmtGlossaryMetric {
  engine: "nmt-glossary"; direction: string; attempt: number; elapsedMs: number;
  inputCharacters: number; outputCharacters: number;
  outcome: "success" | "quality_rejected" | "service_error"; reason?: string;
}
export interface NmtGlossaryOptions {
  projectId: string; location: string; glossaryZhEn: string; glossaryEnZh: string;
  protectedNames?: readonly string[]; onMetric?: (metric: NmtGlossaryMetric) => void;
}
export class NmtGlossaryServiceError extends Error {
  public constructor() { super("NMT glossary service is unavailable."); this.name = "NmtGlossaryServiceError"; }
}
let traditional: ((text: string) => string) | undefined;
export class NmtGlossaryTranslator implements Translator {
  private readonly parent: string;
  public constructor(private readonly options: NmtGlossaryOptions, private client?: NmtGlossaryClient) {
    if (!/^[a-z][a-z0-9-]{4,62}$/u.test(options.projectId) || options.location !== "us-central1") throw new Error("Invalid NMT glossary configuration.");
    this.parent = "projects/" + options.projectId + "/locations/" + options.location;
    for (const glossary of [options.glossaryZhEn, options.glossaryEnZh]) {
      if (!glossary.startsWith(this.parent + "/glossaries/") || !/^[A-Za-z0-9_-]+$/u.test(glossary.slice((this.parent + "/glossaries/").length))) throw new Error("Invalid NMT glossary glossary configuration.");
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
    // Exactly one request: no quality retry or alternate wire.
    {
      const attempt = 1;
      const html = createContextLlmHtml(prepared);
      const auxiliaries = quotes.map(quote => {
        const subset = {...prepared, text: quote, protectedValues: prepared.protectedValues.filter(item => quote.includes(item.token)), rangeTokens: prepared.rangeTokens.filter(item => quote.includes(item.token))};
        const wire = createLlmWireText(subset);
        const exact = prepared.occurrences.filter(item => quote.includes(item.token) && (item.kind === "person" || item.kind === "trade-term"));
        const encoded = escapeHtml(quote).replace(tokenPattern, token => {
          const item = exact.find(value => value.token === token);
          return item ? '<span' + (item.kind === "person" ? ' class="notranslate"' : '') + ' translate="no" id="o' + item.id + '">' + escapeHtml(item.value) + '</span>' : escapeHtml(wire.encode(token));
        });
        const decode = (body: string) => {
          const seen = new Set<number>(); let value = "", cursor = 0;
          const append = (part: string) => {if (/[<>]/u.test(part)) throw new TranslationQualityError("paragraph_structure_changed"); value += decodeLlmTransport(part);};
          for (const span of body.matchAll(/<span\b([^>]*)>([^<>]*)<\/span>/giu)) {
            append(body.slice(cursor, span.index)); const attrs = span[1]!;
            const ids = [...attrs.matchAll(/(?:^|\s)id\s*=\s*(["'])o(\d+)\1/giu)];
            const item = ids.length === 1 ? exact.find(candidate => String(candidate.id) === ids[0]![2]) : undefined;
            if (!item || seen.has(item.id) || [...attrs.matchAll(/(?:^|\s)id\s*=/giu)].length !== 1 || attrs.replace(/\s*(?:id|class|translate)\s*=\s*(?:"[^"]*"|'[^']*')/giu, "").trim() || decodeLlmTransport(span[2]!) !== item.value) throw new TranslationQualityError("exact_occurrence_changed");
            seen.add(item.id); value += item.token; cursor = span.index + span[0].length;
          }
          append(body.slice(cursor));
          if (exact.some(item => !seen.has(item.id)) || /[<>\r\n]/u.test(value)) throw new TranslationQualityError("exact_occurrence_changed");
          const decoded = wire.decode(value);
          if (exact.some(item => decoded.split(item.token).length !== 2)) throw new TranslationQualityError("exact_occurrence_changed");
          return decoded;
        };
        return {quote, encoded, decode};
      });
      const contents = [html.encode(), ...auxiliaries.map(({encoded}, i) => '<div id="a' + i + '">' + encoded + '</div>')];
      const inputCharacters = contents.reduce((sum, part) => sum + [...part].length, 0);
      if (inputCharacters > 30000 || contents.length > 1024) throw new TranslationQualityError("encoded_input_too_long");
      const started = Date.now();
      let response: Awaited<ReturnType<NmtGlossaryClient["translateText"]>>[0];
      try {
        if (!this.client) throw new Error("A budget-controlled NMT client is required.");
        [response] = await this.client.translateText({parent: this.parent, model: this.parent + "/models/general/nmt", contents,
          mimeType: "text/html", sourceLanguageCode: source, targetLanguageCode: target,
          glossaryConfig: {glossary: source === "en" ? this.options.glossaryEnZh : this.options.glossaryZhEn, ignoreCase: false, contextualTranslationEnabled: false}}, {timeout: 15000, retry: {retryCodes: []}});
      } catch {
        this.options.onMetric?.({engine: "nmt-glossary", direction: source + ":" + target, attempt, elapsedMs: Date.now() - started, inputCharacters, outputCharacters: 0, outcome: "service_error"});
        throw new NmtGlossaryServiceError();
      }
      try {
        const translations = response?.glossaryTranslations;
        if (!Array.isArray(translations) || translations.length !== contents.length || translations.some(part => !part || typeof part.translatedText !== "string" || !part.translatedText.trim())) throw new TranslationQualityError("invalid_response_format");
        const outputCharacters = translations.reduce((sum, part) => sum + [...part.translatedText!].length, 0);
        const decoded = html.decode(translations[0]!.translatedText!);
        let masked = decoded.masked;
        // Only unchanged source quotes use their auxiliary; the complete message remains primary.
        const replacements = new Map(auxiliaries.map(({quote, decode}, i) => {
          const auxiliary = translations[i + 1]!.translatedText!;
          const match = auxiliary.match(new RegExp('^<div id="a' + i + '">(.*)</div>$', "u"));
          if (!match) throw new TranslationQualityError("paragraph_structure_changed");
          return [quote, decode(match[1]!)];
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
        this.options.onMetric?.({engine: "nmt-glossary", direction: source + ":" + target, attempt, elapsedMs: Date.now() - started, inputCharacters, outputCharacters, outcome: "success"});
        return result;
      } catch (error) {
        const failure = error instanceof TranslationQualityError ? error : new TranslationQualityError("invalid_response_format");
        const outputCharacters = Array.isArray(response?.glossaryTranslations) ? response.glossaryTranslations.reduce((sum, part) => sum + (typeof part?.translatedText === "string" ? [...part.translatedText].length : 0), 0) : 0;
        this.options.onMetric?.({engine: "nmt-glossary", direction: source + ":" + target, attempt, elapsedMs: Date.now() - started, inputCharacters, outputCharacters, outcome: "quality_rejected", reason: failure.reason});
        throw failure;
      }
    }
  }
}
