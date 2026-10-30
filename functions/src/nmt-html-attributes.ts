// Both carriers require a complete attribute parse with unique, allowed names.
export function readNmtHtmlAttributes(text: string, allowed: readonly string[], decode: (text: string) => string): Record<string, string> {
  const result: Record<string, string> = {}; let cursor = 0;
  for (const match of text.matchAll(/\s+([A-Za-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    if (text.slice(cursor, match.index).trim()) throw new Error("Invalid NMT attributes");
    const name = match[1]!.toLowerCase();
    if (!allowed.includes(name) || Object.hasOwn(result, name)) throw new Error("Invalid NMT attributes");
    result[name] = decode(match[2] ?? match[3]!); cursor = match.index + match[0].length;
  }
  if (text.slice(cursor).trim()) throw new Error("Invalid NMT attributes");
  return result;
}
