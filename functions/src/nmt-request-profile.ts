import {assertNmtRequest, NMT_GLOSSARIES, NMT_TEST_PROJECT, type ControlledNmtRequest} from "./nmt-isolation.js";

import {PRODUCTION_PROJECT} from "./production-target.js";

export const NMT_REQUEST_PROFILES = ["legacy-glossary", "nmt-direct-v1", "nmt-direct-glossary-v1"] as const;
export type NmtRequestProfile = typeof NMT_REQUEST_PROFILES[number];
export type DirectNmtProfile = Exclude<NmtRequestProfile, "legacy-glossary">;

export function resolveNmtRuntimeProfile(engine: string, profile: string): NmtRequestProfile {
  if (engine === "nmt-glossary" && profile === "legacy-glossary") return profile;
  if (engine === "nmt-direct" && (profile === "nmt-direct-v1" || profile === "nmt-direct-glossary-v1")) return profile;
  throw new Error("Isolated NMT engine/profile mismatch");
}

// The profile is trusted configuration, never inferred from a request or source text.
export function assertNmtProfileRequest(request: ControlledNmtRequest, profile: NmtRequestProfile, projectId: string = NMT_TEST_PROJECT): void {
  if (projectId !== NMT_TEST_PROJECT && projectId !== PRODUCTION_PROJECT) throw new Error("Unknown NMT project");
  if (projectId === PRODUCTION_PROJECT) {
    if (profile !== "nmt-direct-v1" && profile !== "legacy-glossary") throw new Error("Production glossary prohibited");
    if (request.glossaryConfig !== undefined) throw new Error("Production glossary prohibited");
    if (request.sourceLanguageCode === "vi" || request.targetLanguageCode === "vi") {
      const parent = "projects/" + projectId + "/locations/global";
      if (Object.keys(request).some(key => !["parent", "model", "contents", "mimeType", "sourceLanguageCode", "targetLanguageCode"].includes(key)) ||
          request.parent !== parent || request.model !== parent + "/models/general/nmt" || request.mimeType !== "text/html" ||
          !(request.sourceLanguageCode === "vi" && request.targetLanguageCode === "zh-TW" || request.sourceLanguageCode === "zh-TW" && request.targetLanguageCode === "vi") ||
          !Array.isArray(request.contents) || !request.contents.length || request.contents.some(value => typeof value !== "string" || !value.trim())) throw new Error("Production Vietnamese request mismatch");
      return;
    }
    if (profile !== "nmt-direct-v1") throw new Error("Production English profile mismatch");
  }
  const vietnamese = request.sourceLanguageCode === "vi" || request.targetLanguageCode === "vi";
  if (profile === "legacy-glossary" || vietnamese) {assertNmtRequest(request); return;}
  if (profile !== "nmt-direct-v1" && profile !== "nmt-direct-glossary-v1") throw new Error("Unknown NMT request profile");
  const parent = "projects/" + projectId + "/locations/us-central1";
  if (Object.keys(request).some(key => !["parent", "model", "contents", "mimeType", "sourceLanguageCode", "targetLanguageCode", "glossaryConfig"].includes(key)) ||
      request.parent !== parent || request.model !== parent + "/models/general/nmt" ||
      !["text/plain", "text/html"].includes(request.mimeType) ||
      !(request.sourceLanguageCode === "en" && request.targetLanguageCode === "zh-TW" ||
        request.sourceLanguageCode === "zh-TW" && request.targetLanguageCode === "en") ||
      !Array.isArray(request.contents) || request.contents.length !== 1 || request.contents.some(value => typeof value !== "string" || !value.trim())) {
    throw new Error("NMT direct request target mismatch");
  }
  if (profile === "nmt-direct-v1") {
    if (request.glossaryConfig !== undefined) throw new Error("Direct profile prohibits glossary");
  } else {
    const glossary = request.glossaryConfig;
    if (!glossary || glossary.glossary !== parent + "/glossaries/" + (request.sourceLanguageCode === "en" ? NMT_GLOSSARIES.enZh : NMT_GLOSSARIES.zhEn) ||
        glossary.ignoreCase !== false || glossary.contextualTranslationEnabled !== false ||
        Object.keys(glossary).sort().join() !== "contextualTranslationEnabled,glossary,ignoreCase") throw new Error("NMT glossary mismatch");
  }
}
