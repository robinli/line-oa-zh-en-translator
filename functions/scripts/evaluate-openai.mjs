import "./nmt-legacy-guard.mjs";
// Only fixed, synthetic Chinese-English examples; no LINE or production configuration.
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {BusinessTranslator} from "../lib/business-translator.js";
import {OpenAiTextGenerator, OPENAI_EVALUATION_MODELS} from "../lib/openai-text-generator.js";

const allCases = [
  ...JSON.parse(await readFile(new URL("../evaluation/synthetic-trade-cases.json", import.meta.url), "utf8")),
  ...JSON.parse(await readFile(new URL("../evaluation/synthetic-alternative-cases.json", import.meta.url), "utf8")),
];
const cases = allCases.filter(sample =>
  (sample.sourceLanguage === "zh-TW" && sample.targetLanguage === "en") ||
  (sample.sourceLanguage === "en" && sample.targetLanguage === "zh-TW"));
const models = (process.env.OPENAI_EVAL_MODELS ?? "gpt-6-luna,gpt-6-sol,gpt-6-astra").split(",");
if (models.some(model => !OPENAI_EVALUATION_MODELS.includes(model)) ||
    new Set(models).size !== models.length) throw new Error("Unsupported evaluation model.");
if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({syntheticOnly: true, cases: cases.length, models,
    maximumRequests: cases.length * models.length * 2, liveCalls: 0}, null, 2));
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not configured. No API request was sent.");
  process.exit(2);
}
const results = [];
for (const model of models) {
  for (const sample of cases) {
    let retries = 0;
    const usage = [];
    const generator = new OpenAiTextGenerator({model, apiKey: process.env.OPENAI_API_KEY,
      onUsage: item => usage.push(item)});
    const translator = new BusinessTranslator(generator, {
      protectedNames: ["Alex", "Mira", "Kumar", "Kumaran", "Shan", "Niranjan", "Eric"],
      onValidationRetry: () => retries++,
    });
    const protectedRanges = (sample.mentions ?? []).map(mention => {
      let start = -1;
      for (let i = 0; i <= mention.occurrence; i++) start = sample.source.indexOf(mention.text, start + 1);
      if (start < 0) throw new Error("Invalid synthetic mention.");
      return {start, length: mention.text.length};
    });
    const started = Date.now();
    try {
      const translation = await translator.translateWithRanges(sample.source,
        sample.sourceLanguage, sample.targetLanguage, {protectedRanges});
      const comparison = translation.text.toLowerCase().replaceAll("？", "?");
      const missing = (sample.required ?? []).filter(value => !comparison.includes(value.toLowerCase()));
      const forbidden = (sample.forbidden ?? []).filter(value => comparison.includes(value.toLowerCase()));
      const mappingPassed = protectedRanges.every(range => translation.ranges.some(restored =>
        restored.sourceStart === range.start &&
        translation.text.slice(restored.start, restored.start + restored.length) ===
        sample.source.slice(range.start, range.start + range.length)));
      results.push({model, ...sample, ...translation, missing, forbidden, mappingPassed,
        mechanicalPassed: !missing.length && !forbidden.length && mappingPassed,
        humanSemanticReview: "pending", retries, usage, elapsedMs: Date.now() - started});
      console.log(model + " " + sample.id + ": completed; semantic review pending");
    } catch (error) {
      results.push({model, id: sample.id, mechanicalPassed: false,
        error: error.reason ?? "service_unavailable", status: error.status,
        retries, usage, elapsedMs: Date.now() - started});
      console.log(model + " " + sample.id + ": failed");
      // Avoid repeatedly spending on an unavailable model or exhausted quota.
      if (!error.reason) break;
    }
  }
}
const directory = new URL("../../.local/openai-evaluation/", import.meta.url);
await mkdir(directory, {recursive: true});
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
await writeFile(new URL(stamp + ".json", directory), JSON.stringify({
  generatedAt: new Date().toISOString(), syntheticOnly: true, expectedCasesPerModel: cases.length,
  models, reasoning: "low", semanticApproval: false, results,
}, null, 2).replace(/\n/gu, "\r\n") + "\r\n");
if (results.length !== cases.length * models.length || results.some(result => !result.mechanicalPassed)) {
  process.exitCode = 1;
}
