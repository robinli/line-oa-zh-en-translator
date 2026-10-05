// Only text content crosses this observer boundary; transport headers and arbitrary response fields do not.
export interface NmtOutputContents {
  translations?: Array<string | null> | null;
  glossaryTranslations?: Array<string | null> | null;
}
export interface NmtContentObserver {
  onInput(contents: string[]): void;
  onOutput(contents: NmtOutputContents): void;
}
export function projectNmtOutputContents(response: unknown): NmtOutputContents {
  const result: NmtOutputContents = {};
  if (!response || typeof response !== "object") return result;
  for (const key of ["translations", "glossaryTranslations"] as const) {
    if (!Object.hasOwn(response, key)) continue;
    const value = (response as Record<string, unknown>)[key];
    result[key] = Array.isArray(value) ? value.map(item => item && typeof item === "object" && typeof item.translatedText === "string" ? item.translatedText : null) : null;
  }
  return result;
}
export function copyNmtOutputContents(contents: NmtOutputContents): NmtOutputContents {
  const result: NmtOutputContents = {};
  for (const key of ["translations", "glossaryTranslations"] as const) {
    if (!Object.hasOwn(contents, key)) continue;
    const value = contents[key];
    result[key] = Array.isArray(value) ? value.map(text => typeof text === "string" ? text : null) : null;
  }
  return result;
}
