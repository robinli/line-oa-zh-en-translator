// Fixed synthetic data only. Raw responses here are synthetic; production never logs them.
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {TranslationLlmTranslator, TRANSLATION_LLM_ADAPTER_VERSION} from "../lib/translation-llm-translator.js";
const implementationHashes = {};
for (const name of ["translation-llm-translator.js", "translation-llm-protection.js", "trade-policy.js"]) {
  implementationHashes[name] = createHash("sha256").update(await readFile(new URL("../lib/" + name, import.meta.url))).digest("hex");
}
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const token = process.env.TRANSLATION_EVAL_TOKEN;
const rounds = Number(process.env.TLLM_EVAL_ROUNDS ?? "3");
if (!projectId || !/^[a-z][a-z0-9-]{4,62}$/u.test(projectId) || !token ||
    ![1,3].includes(rounds)) throw new Error("Set project, temporary evaluation token and rounds (1 or 3).");
const parent = "projects/" + projectId + "/locations/us-central1";
const cases = [];
for (const file of ["synthetic-trade-cases.json", "synthetic-alternative-cases.json", "synthetic-tllm-holdout.json", "synthetic-tllm-v2-holdout.json", "synthetic-tllm-v4-holdout.json"]) {
  const data = JSON.parse(await readFile(new URL("../evaluation/" + file, import.meta.url), "utf8"));
  cases.push(...data.filter(sample => sample.sourceLanguage !== "vi" && sample.targetLanguage !== "vi")
    .map(sample => ({...sample, set: "regression"})));
}
if (cases.length !== 116 || new Set(cases.map(sample => sample.id)).size !== 116 ||
    cases.some(sample => typeof sample.source !== "string" || sample.source.length > 2000 ||
    !["en","zh-TW"].includes(sample.sourceLanguage) || !["en","zh-TW"].includes(sample.targetLanguage))) {
  throw new Error("Unexpected fixed synthetic dataset.");
}
const directory = new URL("../../.local/tllm-evaluation/", import.meta.url);
await mkdir(directory, {recursive: true});
const startedAt = new Date().toISOString();
const output = new URL(startedAt.replaceAll(":", "-").replaceAll(".", "-") + ".json", directory);
const results = [];
async function save() {
  const apiCalls = results.flatMap(row => row.attempts);
  const inputCharacters = results.flatMap(row => row.metrics).reduce((sum, row) => sum + row.inputCharacters, 0);
  const outputCharacters = results.flatMap(row => row.metrics).reduce((sum, row) => sum + row.outputCharacters, 0);
  await writeFile(output, JSON.stringify({startedAt, adapterVersion: TRANSLATION_LLM_ADAPTER_VERSION, implementationHashes, model: "general/translation-llm", glossaryVersion: "v7", glossaryMode: "standard-plain-semantic-markers-traditional-quotes",
    syntheticOnly: true, expected: 116 * rounds, rounds, apiCalls: apiCalls.length,
    inputCharacters, outputCharacters, estimatedUsd: (inputCharacters + outputCharacters) * 10 / 1e6,
    semanticGate: "pending_manual_review", results}, null, 2).replace(/\n/gu, "\r\n") + "\r\n");
}
let serviceFailure = false;
for (let round = 1; round <= rounds; round++) {
  for (const sample of cases) {
    const attempts = [], metrics = [];
    const ranges = (sample.mentions ?? []).map(mention => {
      let start = -1;
      for (let i=0; i<=mention.occurrence; i++) start = sample.source.indexOf(mention.text, start + 1);
      if (start < 0) throw new Error("Invalid synthetic mention range.");
      return {start, length: mention.text.length};
    });
    const client = {async translateText({parent, ...body}, {timeout}) {
      const response = await fetch("https://translation.googleapis.com/v3/" + parent + ":translateText", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(timeout),
        headers: {"Content-Type": "application/json", "x-goog-user-project": projectId, Authorization: "Bearer " + token},
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const diagnostic = await response.json().catch(() => ({})); attempts.push({status: response.status, syntheticDiagnostic: diagnostic.error?.message});
        throw new Error("Translation API unavailable.");
      }
      const data = await response.json();
      attempts.push({status: response.status, glossaryTranslations: data.glossaryTranslations});
      return [data];
    }};
    const translator = new TranslationLlmTranslator({projectId, location: "us-central1",
      glossaryZhEn: parent + "/glossaries/trade-zh-en-v7", glossaryEnZh: parent + "/glossaries/trade-en-zh-v7",
      protectedNames: ["Alex", "Mira", "Kumar", "Kumaran", "Shan", "Niranjan", "Eric"],
      onMetric: metric => metrics.push(metric)}, client);
    const started = Date.now();
    try {
      const result = await translator.translateWithRanges(sample.source, sample.sourceLanguage,
        sample.targetLanguage, {protectedRanges: ranges});
      const comparable = result.text.toLowerCase().replaceAll("？", "?");
      const fragmentWarnings = [
        ...(sample.required ?? []).filter(value => !comparable.includes(value.toLowerCase())).map(value => "missing:" + value),
        ...(sample.forbidden ?? []).filter(value => comparable.includes(value.toLowerCase())).map(value => "forbidden:" + value),
      ];
      const mentionsPreserved = ranges.every(range => result.ranges.filter(item => item.sourceStart === range.start &&
        result.text.slice(item.start, item.start + item.length) === sample.source.slice(range.start, range.start + range.length)).length === 1);
      results.push({...sample, round, ...result, completed: true, mentionsPreserved, fragmentWarnings,
        elapsedMs: Date.now() - started, attempts, metrics, semanticReview: "pending"});
    } catch (error) {
      serviceFailure = metrics.some(metric => metric.outcome === "service_error");
      results.push({...sample, round, completed: false, reason: error.reason ?? "service_error",
        elapsedMs: Date.now() - started, attempts, metrics, semanticReview: "pending"});
    }
    await save();
    if (results.length % 10 === 0 || serviceFailure) console.log(JSON.stringify({done: results.length,
      expected: 116 * rounds, completed: results.filter(row => row.completed).length, serviceFailure}));
    if (serviceFailure) break;
  }
  if (serviceFailure) break;
}
console.log(JSON.stringify({file: output.pathname, results: results.length, completed: results.filter(row => row.completed).length,
  semanticReview: "pending", serviceFailure}));
if (serviceFailure) process.exitCode = 1;

