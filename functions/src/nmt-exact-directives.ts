import type {TextRange} from "./message-text.js";

export interface ExactDirective extends TextRange {
  id: string; paragraph: number; state: "resolved" | "ambiguous";
  operand?: TextRange; evidence?: "quoted" | "trusted";
}

// This grammar declares one immediate operand per cue; it never infers units or scope from other literals.
export function resolveExactDirectives(text: string, paragraphs: readonly {start: number; text: string}[], trusted: readonly TextRange[]): ExactDirective[] {
  const directives: ExactDirective[] = [];
  const opaque: TextRange[] = [...trusted];
  const cues = /保持原樣|原樣保留|不要改單位|不(?:要)?(?:更改|改變)單位|(?<![A-Za-z])copy[ \t]+exactly(?![A-Za-z])|(?<![A-Za-z])do[ \t]+not[ \t]+(?:change|convert)[ \t]+(?:the[ \t]+)?units(?![A-Za-z])/giu;
  const quotes: Record<string, string> = {"“": "”", "「": "」"};
  for (const [paragraph, part] of paragraphs.entries()) {
    for (const cue of part.text.matchAll(cues)) {
      const start = part.start + cue.index, end = start + cue[0].length;
      if (opaque.some(range => start >= range.start && end <= range.start + range.length)) continue;
      const directive: ExactDirective = {id: "d" + directives.length, start, length: cue[0].length, paragraph, state: "ambiguous"};
      directives.push(directive);
      const tail = part.text.slice(cue.index + cue[0].length);
      const separator = /^[ \t]*(?:[:：][ \t]*)?/u.exec(tail)![0];
      const position = end + separator.length;
      const explicit = trusted.find(range => range.start === position);
      if (explicit) {
        directive.state = "resolved"; directive.operand = {...explicit}; directive.evidence = "trusted";
        continue;
      }
      const open = text[position] ?? "", close = quotes[open];
      if (!close) continue;
      const limit = part.start + part.text.length, finish = text.indexOf(close, position + 1);
      if (finish < 0 || finish >= limit) continue;
      const value = text.slice(position + 1, finish);
      // Nested typographic pairs and escaped delimiters have no supported source-range grammar.
      if (!value.trim() || value.endsWith("\\") || value.includes("\\" + open) ||
          (open !== close && value.includes(open))) continue;
      const operand = {start: position + 1, length: value.length};
      directive.state = "resolved"; directive.operand = operand; directive.evidence = "quoted";
      opaque.push(operand);
    }
  }
  return directives;
}
