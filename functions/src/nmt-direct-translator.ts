import type {Translator, TranslationContext} from "./services.js";
import {TranslationQualityError} from "./trade-policy.js";
import {NMT_LITERAL_POLICY_VERSION, createLiteralManifest} from "./nmt-literal-policy.js";
import {createNmtTransport} from "./nmt-transport-codec.js";
import {resolveNmtLocalPhrase} from "./nmt-local-phrases.js";
import {assertNmtProfileRequest, type DirectNmtProfile} from "./nmt-request-profile.js";
import {NMT_TEST_PROJECT, NMT_GLOSSARIES} from "./nmt-isolation.js";
import type {NmtTransport} from "./nmt-controlled-client.js";

export const NMT_DIRECT_ADAPTER_VERSION = "nmt-direct-v1.2";
export interface NmtDirectMetric {
  engine: "nmt-direct"; profile: DirectNmtProfile; adapterVersion: string; protectionVersion: string;
  validationScope: "literal-integrity"; semanticEvaluation: "not_evaluated";
  direction: string; attempt: number; elapsedMs: number; inputCharacters: number; outputCharacters: number;
  outcome: "success" | "quality_rejected" | "service_error"; reason?: string; apiCalled?: boolean | "unknown"; protectedCounts: Record<string, number>;
}
export interface NmtDirectOptions {
  projectId: string; profile: DirectNmtProfile; protectedNames?: readonly string[]; onMetric?: (metric: NmtDirectMetric) => void;
}
export class NmtDirectServiceError extends Error {
  public constructor() {super("NMT direct service is unavailable."); this.name = "NmtDirectServiceError";}
}
let traditional: ((text: string) => string) | undefined;
export class NmtDirectTranslator implements Translator {
  public constructor(private readonly options: NmtDirectOptions, private readonly client: NmtTransport) {
    if (options.projectId !== NMT_TEST_PROJECT || !["nmt-direct-v1", "nmt-direct-glossary-v1"].includes(options.profile) || !client) throw new Error("Invalid isolated NMT direct configuration");
  }
  public async translate(text: string, source: string, target: string, context?: TranslationContext): Promise<string> {
    return (await this.translateWithRanges(text, source, target, context)).text;
  }
  public async translateWithRanges(text: string, source: string, target: string, context?: TranslationContext) {
    const started = Date.now(); let attempt = 0, apiCalled: boolean | "unknown" = false, inputCharacters = 0, outputCharacters = 0;
    let outcome: NmtDirectMetric["outcome"] = "quality_rejected", reason: string | undefined;
    const protectedCounts: Record<string, number> = {};
    try {
      if (!(source === "en" && target === "zh-TW" || source === "zh-TW" && target === "en")) throw new TranslationQualityError("unsupported_language");
      if (!text.trim() || text.length > 2000) throw new TranslationQualityError("invalid_input_length");
      const manifest = createLiteralManifest(text, this.options.protectedNames, context);
      for (const item of manifest.occurrences) for (const kind of item.reasons) protectedCounts[kind] = (protectedCounts[kind] ?? 0) + 1;
      const wire = createNmtTransport(manifest);
      const local = manifest.occurrences.length ? null : resolveNmtLocalPhrase(text, source, target, context);
      if (local || !wire.hasTranslatableBody) {
        outcome = "success"; outputCharacters = [...(local?.text ?? text)].length;
        return {text: local?.text ?? text, ranges: manifest.occurrences.flatMap(item => item.nativeRanges.map(range => ({...range, sourceStart: range.start})))};
      }
      const parent = "projects/" + this.options.projectId + "/locations/us-central1";
      const request = {parent, model: parent + "/models/general/nmt", contents: wire.contents, mimeType: wire.mimeType, sourceLanguageCode: source, targetLanguageCode: target,
        ...(this.options.profile === "nmt-direct-glossary-v1" ? {glossaryConfig: {glossary: parent + "/glossaries/" + (source === "en" ? NMT_GLOSSARIES.enZh : NMT_GLOSSARIES.zhEn), ignoreCase: false as const, contextualTranslationEnabled: false as const}} : {})};
      assertNmtProfileRequest(request, this.options.profile);
      inputCharacters = request.contents.reduce((sum, part) => sum + [...part].length, 0);
      if (inputCharacters > 30000) throw new TranslationQualityError("encoded_input_too_long");
      attempt = 1; apiCalled = "unknown";
      let response;
      try {[response] = await this.client.translateText(request, {timeout: 15000, retry: {retryCodes: []}});}
      catch {outcome = "service_error"; throw new NmtDirectServiceError();}
      apiCalled = true;
      const translations = this.options.profile === "nmt-direct-glossary-v1" ? response?.glossaryTranslations : response?.translations;
      if (!Array.isArray(translations) || translations.length !== 1 || typeof translations[0]?.translatedText !== "string" || !translations[0].translatedText.trim()) throw new TranslationQualityError("invalid_response_format");
      const translated = translations[0].translatedText;
      outputCharacters = [...translated].length;
      if (target === "zh-TW") traditional ??= (await import("opencc-js/cn2t")).Converter({from: "cn", to: "tw"});
      const result = wire.decode(translated, target === "zh-TW" ? traditional : undefined);
      outcome = "success"; return result;
    } catch (error) {reason = error instanceof TranslationQualityError ? error.reason : undefined; throw error;}
    finally {
      try {this.options.onMetric?.({engine: "nmt-direct", profile: this.options.profile, adapterVersion: NMT_DIRECT_ADAPTER_VERSION,
        protectionVersion: NMT_LITERAL_POLICY_VERSION, validationScope: "literal-integrity", semanticEvaluation: "not_evaluated",
        direction: source + ":" + target, attempt, elapsedMs: Date.now() - started, inputCharacters, outputCharacters,
        outcome, ...(reason ? {reason} : {}), apiCalled, protectedCounts});} catch { /* Advisory observation cannot change the result. */ }
    }
  }
}
