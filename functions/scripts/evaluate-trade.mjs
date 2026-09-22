// Only this checked-in synthetic dataset is sent. Never accepts a customer-chat input file.
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {BusinessTranslator, VertexTextGenerator} from "../lib/business-translator.js";

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) throw new Error("Set GOOGLE_CLOUD_PROJECT before running the synthetic evaluation.");
const model = process.env.TRANSLATION_MODEL ?? "gemini-3.5-flash";
const token = process.env.TRADE_EVAL_TOKEN;
const client = token ? {
  async request({url, method, data, timeout}) {
    const response = await fetch(url, {
      method,
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      console.error("Synthetic provider request failed with HTTP " + response.status + ".");
      throw new Error("Provider unavailable.");
    }
    return {data: await response.json()};
  },
} : undefined;
const generator = new VertexTextGenerator({projectId, model}, client);
const cases = JSON.parse(await readFile(new URL("../evaluation/synthetic-trade-cases.json", import.meta.url), "utf8"));
const results = [];
for (const sample of cases) {
  let retries = 0;
  const translator = new BusinessTranslator(generator, {
    protectedNames: ["Alex", "Mira"],
    onValidationRetry: () => { retries++; },
  });
  const started = Date.now();
  try {
    const translation = await translator.translate(sample.source, sample.sourceLanguage, sample.targetLanguage);
    const comparison = translation.toLowerCase().replaceAll("？", "?");
    const missing = sample.required.filter((fragment) => !comparison.includes(fragment.toLowerCase()));
    const forbidden = sample.forbidden.filter((fragment) => comparison.includes(fragment.toLowerCase()));
    const passed = !missing.length && !forbidden.length;
    results.push({...sample, translation, passed, missing, forbidden, retries, elapsedMs: Date.now() - started});
    console.log(sample.id + ": " + (passed ? "PASS" : "FAIL") + " (" + retries + " retries)");
  } catch (error) {
    results.push({...sample, passed: false, error: error.message, retries, elapsedMs: Date.now() - started});
    console.log(sample.id + ": FAIL (" + error.message + ")");
    if (error.message === "Business translation service is unavailable.") break;
  }
}
const directory = new URL("../../.local/", import.meta.url);
await mkdir(directory, {recursive: true});
await writeFile(new URL("trade-evaluation.json", directory), JSON.stringify({
  generatedAt: new Date().toISOString(), model, syntheticOnly: true,
  expected: cases.length, passed: results.filter((result) => result.passed).length, results,
}, null, 2).replace(/\n/g, "\r\n") + "\r\n");
if (results.length !== cases.length || results.some((result) => !result.passed)) process.exitCode = 1;
