// Creates only versioned synthetic terminology resources; never changes LINE or runtime settings.
import {mkdir, writeFile} from "node:fs/promises";
const project = process.env.GOOGLE_CLOUD_PROJECT;
const token = process.env.TRANSLATION_EVAL_TOKEN;
if (!project || !/^[a-z][a-z0-9-]{4,62}$/u.test(project) || !token) throw new Error("Set project and temporary token.");
const parent = "projects/" + project + "/locations/us-central1";
const base = "https://translation.googleapis.com/v3/";
async function request(path, body) {
  const response = await fetch(base + path, {method: body ? "POST" : "GET",
    headers: {Authorization: "Bearer " + token, "Content-Type": "application/json", "x-goog-user-project": project},
    ...(body ? {body: JSON.stringify(body)} : {}), redirect: "error", signal: AbortSignal.timeout(15000)});
  if (response.status === 404 && !body) return undefined;
  if (!response.ok) throw new Error("Glossary API HTTP " + response.status);
  return response.json();
}
const records = [];
for (const [id, source, target, file] of [
  ["trade-zh-en-v3", "zh-TW", "en", "zh-en-v3.tsv"],
  ["trade-en-zh-v3", "en", "zh-TW", "en-zh-v3.tsv"],
]) {
  const name = parent + "/glossaries/" + id;
  const inputUri = "gs://" + project + "-translation-glossaries/v3/" + file;
  let glossary = await request(name);
  if (glossary) {
    if (glossary.inputConfig?.gcsSource?.inputUri !== inputUri ||
        glossary.languagePair?.sourceLanguageCode !== source || glossary.languagePair?.targetLanguageCode !== target) {
      throw new Error("Existing glossary configuration differs; no resource was overwritten.");
    }
  } else {
    let operation = await request(parent + "/glossaries",
      {name, languagePair: {sourceLanguageCode: source, targetLanguageCode: target}, inputConfig: {gcsSource: {inputUri}}});
    console.log("Creating " + id);
    const deadline = Date.now() + 180000;
    while (!operation.done && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      operation = await request(operation.name);
    }
    if (!operation.done || operation.error) throw new Error("Glossary operation failed or timed out.");
    glossary = await request(name);
  }
  records.push({name, inputUri, entryCount: glossary.entryCount, languagePair: glossary.languagePair});
  console.log(JSON.stringify(records.at(-1)));
}
await mkdir(new URL("../../.local/tllm-evaluation/", import.meta.url), {recursive: true});
await writeFile(new URL("../../.local/tllm-evaluation/glossaries-v3.json", import.meta.url),
  JSON.stringify({createdAt: new Date().toISOString(), records}, null, 2).replace(/\n/gu,"\r\n") + "\r\n");

