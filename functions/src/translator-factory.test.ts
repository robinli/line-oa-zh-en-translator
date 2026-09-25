import {describe, expect, it} from "vitest";
import {createTranslator} from "./translator-factory.js";
import {TranslationLlmTranslator} from "./translation-llm-translator.js";
import {BusinessTranslator} from "./business-translator.js";
const parent = "projects/test-project/locations/us-central1";
const config = {engine: "translation-llm", projectId: "test-project", model: "gemini-3.5-flash", location: "global", protectedNames: "Alex,Mira"};
const translationLlm = {location: "us-central1", glossaryZhEn: parent + "/glossaries/zh-en-v8", glossaryEnZh: parent + "/glossaries/en-zh-v8"};
describe("Translation LLM engine integration", () => {
  it("selects Translation LLM using separate regional parameters without calling a provider", () => {
    expect(createTranslator({...config, translationLlm})).toBeInstanceOf(TranslationLlmTranslator);
  });
  it("fails closed for missing or cross-project glossary configuration", () => {
    expect(() => createTranslator(config)).toThrow("Missing Translation LLM configuration");
    expect(() => createTranslator({...config, translationLlm: {...translationLlm, glossaryEnZh: "projects/other-project/locations/us-central1/glossaries/other"}})).toThrow();
  });
  it("keeps an explicit Gemini rollback independent of Translation LLM configuration", () => {
    expect(createTranslator({...config, engine: "business", translationLlm: {...translationLlm, location: "invalid"}})).toBeInstanceOf(BusinessTranslator);
  });
});

it("adds NMT glossary selection without changing the legacy google meaning",async()=>{
 const {NmtGlossaryTranslator}=await import('./nmt-glossary-translator.js');const {GoogleCloudTranslator}=await import('./services.js');
 const client={async translateText(){return [{}] as [{}];}};
 expect(createTranslator({...config,engine:'nmt-glossary',nmtGlossary:{...translationLlm,client}})).toBeInstanceOf(NmtGlossaryTranslator);
 expect(createTranslator({...config,engine:'google'})).toBeInstanceOf(GoogleCloudTranslator);
 expect(()=>createTranslator({...config,engine:'nmt-glossary'})).toThrow('Missing NMT');
});
