export const NMT_LOCAL_PHRASES_VERSION = "nmt-local-phrases-b1";
export interface LocalPhraseContext {protectedRanges?: readonly {start: number; length: number}[]}
export interface LocalPhraseTranslation {text: string; apiCalled: false; version: typeof NMT_LOCAL_PHRASES_VERSION}
// A candidate only: callers must opt in after the separate B integration review.
export function resolveNmtLocalPhrase(text: string, source: string, target: string, context?: LocalPhraseContext): LocalPhraseTranslation | null {
  if (source !== "en" || target !== "zh-TW" || context?.protectedRanges?.length) return null;
  if (!/^fine[.!。！]?$/iu.test(text.trim())) return null;
  return {text: "好的。", apiCalled: false, version: NMT_LOCAL_PHRASES_VERSION};
}
