export const NMT_TEST_PROJECT = "line-auto-translate-bot-dev";
export const NMT_TEST_PROJECT_NUMBER = "371659743970";
export const NMT_TEST_ACCOUNT = "ruibbin@gmail.com";
export const NMT_TEST_BILLING = "014734-3FA407-25CF9A";
export const NMT_RUNTIME_ACCOUNT = "nmt-test-runtime@" + NMT_TEST_PROJECT + ".iam.gserviceaccount.com";
export const NMT_GLOSSARIES = {zhEn: "nmt-trade-zh-en-v12", enZh: "nmt-trade-en-zh-v9"} as const;
export interface NmtIdentity {projectId: string; principal: string; billingAccount: string; billingEnabled: boolean; runtimeAccount: string}
export function assertNmtIdentity(identity: NmtIdentity, runtime = false): void {
  if (identity.projectId !== NMT_TEST_PROJECT || identity.principal !== (runtime ? NMT_RUNTIME_ACCOUNT : NMT_TEST_ACCOUNT) ||
      identity.billingAccount !== "billingAccounts/" + NMT_TEST_BILLING || identity.billingEnabled !== true || identity.runtimeAccount !== NMT_RUNTIME_ACCOUNT) throw new Error("NMT test identity mismatch");
}
export interface ControlledNmtRequest {
  parent: string; model: string; contents: string[]; mimeType: string; sourceLanguageCode: string; targetLanguageCode: string;
  glossaryConfig?: {glossary: string; ignoreCase: false; contextualTranslationEnabled: false};
}
export function assertNmtRequest(request: ControlledNmtRequest, legacyGlossary = false, priorGlossary = false): void {
  const allowed = ["parent", "model", "contents", "mimeType", "sourceLanguageCode", "targetLanguageCode", "glossaryConfig"];
  if (Object.keys(request).some(key => !allowed.includes(key))) throw new Error("Unknown NMT request option");
  const vietnamese = request.sourceLanguageCode === "vi" && request.targetLanguageCode === "zh-TW" || request.sourceLanguageCode === "zh-TW" && request.targetLanguageCode === "vi";
  const english = request.sourceLanguageCode === "en" && request.targetLanguageCode === "zh-TW" || request.sourceLanguageCode === "zh-TW" && request.targetLanguageCode === "en";
  const parent = "projects/" + NMT_TEST_PROJECT + "/locations/" + (vietnamese ? "global" : "us-central1");
  if ((!vietnamese && !english) || request.parent !== parent || request.model !== parent + "/models/general/nmt" || request.mimeType !== "text/html") throw new Error("NMT request target mismatch");
  if (vietnamese) {if (request.glossaryConfig) throw new Error("Vietnamese glossary is prohibited");}
  else if (!request.glossaryConfig || request.glossaryConfig.glossary !== parent + "/glossaries/" + (request.sourceLanguageCode === "en" ? (legacyGlossary ? "nmt-trade-en-zh-v8" : NMT_GLOSSARIES.enZh) : (legacyGlossary || priorGlossary ? "nmt-trade-zh-en-v8" : NMT_GLOSSARIES.zhEn)) ||
      request.glossaryConfig.ignoreCase !== false || request.glossaryConfig.contextualTranslationEnabled !== false ||
      Object.keys(request.glossaryConfig).sort().join() !== "contextualTranslationEnabled,glossary,ignoreCase") throw new Error("NMT glossary mismatch");
}

// Only the independently verified test project ID/number pair is equivalent.
export function canonicalNmtResourceName(name: string): string {
 const match = /^projects\/([^/]+)(\/.*)$/u.exec(name);
 if (!match || ![NMT_TEST_PROJECT, NMT_TEST_PROJECT_NUMBER].includes(match[1]!)) throw new Error("Foreign NMT project resource");
 return "projects/" + NMT_TEST_PROJECT + match[2];
}
