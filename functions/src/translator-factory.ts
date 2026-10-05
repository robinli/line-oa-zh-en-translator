import {NmtDirectTranslator, type NmtDirectMetric, type NmtDirectOptions} from "./nmt-direct-translator.js";
import type {NmtTransport} from "./nmt-controlled-client.js";
import {NmtGlossaryTranslator, type NmtGlossaryClient, type NmtGlossaryMetric} from "./nmt-glossary-translator.js";
import {BusinessTranslator, VertexTextGenerator} from "./business-translator.js";
import {TranslationLlmTranslator, type TranslationLlmMetric} from "./translation-llm-translator.js";
import {GoogleCloudTranslator, type Translator} from "./services.js";

export interface TranslationConfiguration {
  engine: string;
  projectId: string;
  model: string;
  location: string;
  protectedNames: string;
  onValidationRetry?: (reason: string) => void;
  nmtGlossary?: {location: string; glossaryZhEn: string; glossaryEnZh: string; client: NmtGlossaryClient};
  onNmtMetric?: (metric: NmtGlossaryMetric) => void;
  nmtDirect?: {profile: NmtDirectOptions["profile"]; client: NmtTransport};
  onNmtDirectMetric?: (metric: NmtDirectMetric) => void;
  translationLlm?: {location: string; glossaryZhEn: string; glossaryEnZh: string};
  onTranslationMetric?: (metric: TranslationLlmMetric) => void;
}

export function createTranslator(config: TranslationConfiguration): Translator {
  if (config.engine === "nmt-direct") {
    if (!config.nmtDirect) throw new Error("Missing NMT direct configuration.");
    return new NmtDirectTranslator({projectId: config.projectId, profile: config.nmtDirect.profile,
      protectedNames: config.protectedNames.split(",").map(name => name.trim()).filter(Boolean), onMetric: config.onNmtDirectMetric}, config.nmtDirect.client);
  }
  if (config.engine === "nmt-glossary") {
    if (!config.nmtGlossary) throw new Error("Missing NMT glossary configuration.");
    return new NmtGlossaryTranslator({projectId: config.projectId, ...config.nmtGlossary,
      protectedNames: config.protectedNames.split(",").map(name => name.trim()).filter(Boolean), onMetric: config.onNmtMetric}, config.nmtGlossary.client);
  }
  if (config.engine === "google") return new GoogleCloudTranslator(config.projectId);
  if (config.engine === "translation-llm") {
    if (!config.translationLlm) throw new Error("Missing Translation LLM configuration.");
    return new TranslationLlmTranslator({
      projectId: config.projectId,
      ...config.translationLlm,
      protectedNames: config.protectedNames.split(",").map(name => name.trim()).filter(Boolean),
      onMetric: config.onTranslationMetric,
    });
  }
  if (config.engine !== "business") throw new Error("Unknown translation engine.");
  return new BusinessTranslator(new VertexTextGenerator({
    projectId: config.projectId,
    model: config.model,
    location: config.location,
  }), {
    protectedNames: config.protectedNames.split(",").map((name) => name.trim()).filter(Boolean),
    onValidationRetry: config.onValidationRetry,
  });
}
