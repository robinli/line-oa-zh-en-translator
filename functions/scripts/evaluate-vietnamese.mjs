import {readFile, writeFile, mkdir} from "node:fs/promises";
import {VietnameseNmtTranslator} from "../lib/vietnamese-nmt-translator.js";

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) throw new Error("Set GOOGLE_CLOUD_PROJECT.");
const token = process.env.TRANSLATION_EVAL_TOKEN;
const client = token ? {async translateText({parent, ...body}, {timeout}) {
  const response = await fetch("https://translation.googleapis.com/v3/" + parent + ":translateText", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(timeout),
    headers: {"Content-Type": "application/json", "x-goog-user-project": projectId, Authorization: "Bearer " + token},
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error("Synthetic NMT request returned HTTP " + response.status + ".");
    throw new Error("Translation API unavailable.");
  }
  return [await response.json()];
}} : undefined;
const translator = new VietnameseNmtTranslator(projectId, client);
const cases = JSON.parse(await readFile(new URL("../evaluation/synthetic-vietnamese-cases.json", import.meta.url), "utf8"));
const results = [];
for (const sample of cases) {
  let cursor = 0;
  const protectedRanges = (sample.mentions ?? []).map(name => {
    const start = sample.source.indexOf(name, cursor);
    if (start < 0) throw new Error("Invalid synthetic mention.");
    cursor = start + name.length;
    return {start, length: name.length};
  });
  const started = Date.now();
  try {
    const result = await translator.translateWithRanges(sample.source,
      sample.sourceLanguage, sample.targetLanguage, {protectedRanges});
    const mentionsPreserved = protectedRanges.every(range => result.ranges.some(restored =>
      range.start === restored.sourceStart &&
      result.text.slice(restored.start, restored.start + restored.length) ===
      sample.source.slice(range.start, range.start + range.length)));
    results.push({...sample, ...result, mentionsPreserved, completed: true,
      elapsedMs: Date.now() - started, semanticReview: "pending"});
    console.log(sample.id + ": completed; mentions=" + mentionsPreserved);
  } catch {
    results.push({id: sample.id, completed: false, elapsedMs: Date.now() - started});
    console.log(sample.id + ": failed");
    break;
  }
}
const directory = new URL("../../.local/vietnamese-evaluation/", import.meta.url);
await mkdir(directory, {recursive: true});
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
await writeFile(new URL(stamp + ".json", directory), JSON.stringify({
  generatedAt: new Date().toISOString(), syntheticOnly: true, model: "general/nmt",
  expected: cases.length, results,
}, null, 2).replace(/\n/gu, "\r\n") + "\r\n");
if (results.length !== cases.length || results.some(result => !result.completed || !result.mentionsPreserved)) process.exitCode = 1;
