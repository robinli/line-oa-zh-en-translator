import "./nmt-legacy-guard.mjs";
// Evaluates only checked-in synthetic cases. Never reads customer chat or LINE credentials.
// This is an assessment harness, not an engine wired into the production webhook.
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {prepareTradeText, restoreTradeTranslationWithRanges, validateTradeTerminology}
  from "../lib/trade-policy.js";

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const accessToken = process.env.TRADE_EVAL_TOKEN;
if (!projectId || !/^[a-z][a-z0-9-]{4,62}$/u.test(projectId) || !accessToken) {
  throw new Error("Set GOOGLE_CLOUD_PROJECT and a temporary TRADE_EVAL_TOKEN.");
}
const models = ["nmt", "translation-llm"];
const variants = (process.env.TRADE_EVAL_VARIANTS ?? "raw,protected").split(",");
if (!variants.length || variants.some(item => !["raw", "protected", "protected-html"].includes(item)) ||
    new Set(variants).size !== variants.length) throw new Error("Invalid evaluation variants.");
const names = ["Alex", "Mira", "Kumar", "Kumaran", "Shan", "Niranjan", "Eric"];
const base = JSON.parse(await readFile(new URL("../evaluation/synthetic-trade-cases.json", import.meta.url), "utf8"));
const additional = JSON.parse(await readFile(new URL("../evaluation/synthetic-alternative-cases.json", import.meta.url), "utf8"));
const cases = [...base, ...additional];
if (cases.length !== 30 || new Set(cases.map(item => item.id)).size !== cases.length ||
    cases.some(item => !["zh-TW", "en", "vi"].includes(item.sourceLanguage) ||
      !["zh-TW", "en", "vi"].includes(item.targetLanguage) || typeof item.source !== "string" ||
      item.source.length > 2000)) throw new Error("Unexpected synthetic dataset.");
const resultDirectory = new URL("../../.local/translation-alternatives/", import.meta.url);
await mkdir(resultDirectory, {recursive: true});
const startedAt = new Date().toISOString();
const outputFile = new URL(startedAt.replaceAll(":", "-").replaceAll(".", "-") + ".json", resultDirectory);
const results = [];

function mentionRanges(sample) {
  return (sample.mentions ?? []).map(mention => {
    let start = -1;
    for (let i = 0; i <= mention.occurrence; i++) start = sample.source.indexOf(mention.text, start + 1);
    if (start < 0) throw new Error("Invalid synthetic mention range.");
    return {start, length: mention.text.length};
  });
}

function checkResult(sample, prepared, variant, translation) {
  const checks = [];
  let text = translation;
  let restoredRanges = [];
  if (variant !== "raw") {
    try {
      const tokenTranslation = variant === "protected-html" ? fromProtectedHtml(prepared, translation) : translation;
      const restored = restoreTradeTranslationWithRanges(prepared, tokenTranslation);
      text = restored.text;
      restoredRanges = restored.ranges;
      for (const range of mentionRanges(sample)) {
        const match = restoredRanges.filter(item => item.sourceStart === range.start);
        if (match.length !== 1 || text.slice(match[0].start, match[0].start + match[0].length) !==
            sample.source.slice(range.start, range.start + range.length)) checks.push("mention_mapping");
      }
    } catch (error) {
      checks.push(error.reason ?? "restoration_error");
      return {checks, text: null, restoredRanges};
    }
  }
  try { validateTradeTerminology(sample.source, text, sample.targetLanguage); }
  catch (error) { checks.push(error.reason ?? "terminology_error"); }
  const comparable = text.toLowerCase().replaceAll("？", "?");
  for (const fragment of sample.required ?? []) {
    if (!comparable.includes(fragment.toLowerCase())) checks.push("missing:" + fragment);
  }
  for (const fragment of sample.forbidden ?? []) {
    if (comparable.includes(fragment.toLowerCase())) checks.push("forbidden:" + fragment);
  }
  let sourceBody = sample.source;
  let targetBody = text;
  for (const range of mentionRanges(sample).sort((a, b) => b.start - a.start)) {
    sourceBody = sourceBody.slice(0, range.start) + sourceBody.slice(range.start + range.length);
  }
  for (const range of [...restoredRanges].sort((a, b) => b.start - a.start)) {
    targetBody = targetBody.slice(0, range.start) + targetBody.slice(range.start + range.length);
  }
  if (/\p{L}/u.test(sourceBody) && (sample.targetLanguage === "zh-TW" ?
    !/\p{Script=Han}/u.test(targetBody) : !/\p{Script=Latin}/u.test(targetBody))) {
    // Match the intent of the production direction check; code-only cases are exempt.
    if (sample.id !== "code-only") checks.push("wrong_target_language");
  }
  return {checks, text, restoredRanges};
}

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function decodeHtmlOnce(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/giu, entity => {
    const named = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'"};
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const hex = /^&#x/iu.test(entity);
    const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error("Invalid HTML entity");
    return String.fromCodePoint(code);
  });
}

function toProtectedHtml(prepared) {
  let html = escapeHtml(prepared.text);
  for (const item of prepared.protectedValues) {
    html = html.replace(item.token, '<span class="notranslate" translate="no" id="' + item.token + '">' +
      escapeHtml(item.value) + "</span>");
  }
  return html;
}

function fromProtectedHtml(prepared, html) {
  const expected = new Map(prepared.protectedValues.map(item => [item.token, item.value]));
  const observed = new Set();
  // Strict assessment prototype: unfamiliar markup is rejected, never executed.
  const tokenText = html.replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/giu, (whole, attributes, body) => {
    const id = /\bid=["']([^"']+)["']/iu.exec(attributes)?.[1];
    if (!id || !expected.has(id) || observed.has(id) || /<[^>]*>/u.test(body) ||
        decodeHtmlOnce(body) !== expected.get(id)) throw new Error("Changed protected HTML span");
    observed.add(id);
    return id;
  });
  if (observed.size !== expected.size || /<[^>]*>/u.test(tokenText)) throw new Error("Unrecognized HTML markup");
  return decodeHtmlOnce(tokenText);
}

async function translate(sample, prepared, variant, model) {
  const input = variant === "protected-html" ? toProtectedHtml(prepared) :
    variant === "protected" ? prepared.text : sample.source;
  const started = performance.now();
  const record = {id: sample.id, model, variant, source: sample.source,
    sourceLanguage: sample.sourceLanguage, targetLanguage: sample.targetLanguage,
    rubric: sample.rubric, requestCharacters: [...input].length,
    protectedValueCount: prepared.protectedValues.length, mentionCount: mentionRanges(sample).length};
  try {
    const response = await fetch("https://translation.googleapis.com/v3/projects/" + projectId +
      "/locations/global:translateText", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: {"Content-Type": "application/json", "x-goog-user-project": projectId,
        Authorization: "Bearer " + accessToken},
      body: JSON.stringify({contents: [input], mimeType: variant === "protected-html" ? "text/html" : "text/plain",
        sourceLanguageCode: sample.sourceLanguage, targetLanguageCode: sample.targetLanguage,
        model: "projects/" + projectId + "/locations/global/models/general/" + model}),
    });
    record.httpStatus = response.status;
    if (!response.ok) return {...record, serviceOk: false, elapsedMs: Math.round(performance.now() - started)};
    const data = await response.json();
    const translation = data.translations?.[0]?.translatedText;
    if (typeof translation !== "string" || !translation.trim() || data.translations.length !== 1) {
      return {...record, serviceOk: false, serviceError: "invalid_response", elapsedMs: Math.round(performance.now() - started)};
    }
    return {...record, serviceOk: true, elapsedMs: Math.round(performance.now() - started),
      responseModel: data.translations[0].model, rawTranslation: translation,
      responseCharacters: [...translation].length, ...checkResult(sample, prepared, variant, translation)};
  } catch (error) {
    return {...record, serviceOk: false, serviceError: error.name === "TimeoutError" ? "timeout" : "request_failed",
      elapsedMs: Math.round(performance.now() - started)};
  }
}

function summarize() {
  return models.flatMap(model => variants.map(variant => {
    const items = results.filter(item => item.model === model && item.variant === variant);
    const successful = items.filter(item => item.serviceOk);
    const sorted = successful.map(item => item.elapsedMs).sort((a, b) => a - b);
    return {model, variant, attempted: items.length, httpSuccess: successful.length,
      mechanicalChecksPassed: successful.filter(item => !item.checks.length).length,
      restorationPassed: variant !== "raw" ? successful.filter(item => item.text !== null).length : null,
      latencyP50Ms: sorted[Math.ceil(sorted.length * .5) - 1] ?? null,
      latencyP95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? null,
      requestCharacters: items.reduce((sum, item) => sum + item.requestCharacters, 0),
      responseCharacters: successful.reduce((sum, item) => sum + item.responseCharacters, 0)};
  }));
}

async function save() {
  await writeFile(outputFile, JSON.stringify({startedAt, finishedAt: new Date().toISOString(),
    syntheticOnly: true, location: "global", models, expectedCases: cases.length,
    variants, automaticRetries: 0, parallelRequests: 2,
    note: "Mechanical checks are not a semantic quality score. Protected mode tests existing opaque tokens without supplied values. Protected-html is a strict experimental span adapter retaining values as context. No variant uses a system prompt, glossary or a production integration.",
    summary: summarize(), results}, null, 2).replace(/\r?\n/g, "\r\n") + "\r\n");
}

for (const sample of cases) {
  const prepared = prepareTradeText(sample.source, names, mentionRanges(sample));
  for (const variant of variants) {
    const pair = await Promise.all(models.map(model => translate(sample, prepared, variant, model)));
    results.push(...pair);
    console.log(sample.id + " " + variant + ": " + pair.map(item => item.model + " " +
      (item.serviceOk ? "HTTP 200 checks=" + (item.checks.join(",") || "OK") :
        "FAILED " + (item.httpStatus ?? item.serviceError))).join("; "));
    await save();
  }
}
console.log(JSON.stringify({outputFile: outputFile.pathname, summary: summarize()}, null, 2));
if (results.some(item => !item.serviceOk)) process.exitCode = 1;
