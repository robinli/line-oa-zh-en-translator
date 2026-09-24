import type {Translator, TranslationContext} from "./services.js";
import type {RestoredTextRange} from "./message-text.js";

export interface NmtClient {
  translateText(request: {
    parent: string; model: string; contents: string[]; mimeType: string;
    sourceLanguageCode: string; targetLanguageCode: string;
  }, options: {timeout: number; retry: {retryCodes: number[]}}): Promise<[
    {translations?: Array<{translatedText?: string | null}> | null}, ...unknown[],
  ]>;
}
export class NmtTranslationError extends Error {
  public constructor() { super("Vietnamese translation service is unavailable."); this.name = "NmtTranslationError"; }
}
function escapeHtml(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");
}
function decodeTransportHtml(text: string): string {
  // One pass only: source literal "&#x20;" was escaped to "&amp;#x20;" and stays literal.
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/giu, entity => {
    const known: Record<string, string> = {"&amp;": "&", "&lt;": "<", "&gt;": ">",
      "&quot;": '"', "&apos;": "'", "&nbsp;": "\u00a0"};
    if (known[entity.toLowerCase()]) return known[entity.toLowerCase()]!;
    const hex = entity[2]?.toLowerCase() === "x";
    const value = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    if (!Number.isSafeInteger(value) || value < 0 || value > 0x10ffff ||
        (value >= 0xd800 && value <= 0xdfff)) throw new NmtTranslationError();
    return String.fromCodePoint(value);
  });
}

// NMT receives the complete paragraph. Only native mention spans are marked notranslate.
// This module has no trade policy, model prompt, terminology checks or person-name list.
export class VietnameseNmtTranslator implements Translator {
  private client: NmtClient | undefined;
  public constructor(private readonly projectId: string, client?: NmtClient) {
    if (!/^[a-z][a-z0-9-]{4,62}$/u.test(projectId)) throw new Error("Invalid NMT project.");
    this.client = client;
  }
  public async translate(text: string, source: string, target: string,
    context?: TranslationContext): Promise<string> {
    return (await this.translateWithRanges(text, source, target, context)).text;
  }
  public async translateWithRanges(text: string, source: string, target: string,
    context?: TranslationContext): Promise<{text: string; ranges: RestoredTextRange[]}> {
    if (!((source === "zh-TW" && target === "vi") || (source === "vi" && target === "zh-TW"))) {
      throw new Error("Vietnamese program only supports Chinese and Vietnamese.");
    }
    if (!text || text.length > 2000) throw new NmtTranslationError();
    const protectedRanges = [...context?.protectedRanges ?? []].sort((a, b) => a.start - b.start);
    type Paragraph = {html: string; translatable: boolean; separator: string};
    const paragraphs: Paragraph[] = [];
    let paragraph: Paragraph = {html: "", translatable: false, separator: ""};
    const appendBody = (body: string) => {
      for (const piece of body.split(/(\r\n|\r|\n)/u)) {
        if (/^(?:\r\n|\r|\n)$/u.test(piece)) {
          paragraph.separator = piece;
          paragraphs.push(paragraph);
          paragraph = {html: "", translatable: false, separator: ""};
        } else {
          paragraph.html += escapeHtml(piece);
          paragraph.translatable ||= /\p{L}/u.test(piece);
        }
      }
    };
    let cursor = 0;
    for (const [id, range] of protectedRanges.entries()) {
      if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.length) ||
          range.start < cursor || range.length <= 0 || range.start + range.length > text.length) {
        throw new NmtTranslationError();
      }
      appendBody(text.slice(cursor, range.start));
      paragraph.html += '<span translate="no" class="notranslate" id="m' + id + '">' +
        escapeHtml(text.slice(range.start, range.start + range.length)) + "</span>";
      cursor = range.start + range.length;
    }
    appendBody(text.slice(cursor));
    paragraphs.push(paragraph);
    try {
      const contents = paragraphs.filter(item => item.translatable).map(item => item.html);
      let translations: string[] = [];
      if (contents.length) {
        if (!this.client) {
          const {v3} = await import("@google-cloud/translate");
          this.client = new v3.TranslationServiceClient();
        }
        const parent = "projects/" + this.projectId + "/locations/global";
        const [response] = await this.client.translateText({
          parent, model: parent + "/models/general/nmt", contents, mimeType: "text/html",
          sourceLanguageCode: source, targetLanguageCode: target,
        }, {timeout: 15_000, retry: {retryCodes: []}});
        if (response.translations?.length !== contents.length) throw new NmtTranslationError();
        translations = response.translations.map(item => {
          if (typeof item.translatedText !== "string" || !item.translatedText.trim()) throw new NmtTranslationError();
          return item.translatedText;
        });
      }
      let translatedText = "";
      let translationIndex = 0;
      const ranges: RestoredTextRange[] = [];
      const seen = new Set<number>();
      const appendPlain = (html: string) => {
        if (/[<>]/u.test(html)) throw new NmtTranslationError();
        translatedText += decodeTransportHtml(html);
      };
      for (const item of paragraphs) {
        const html = item.translatable ? translations[translationIndex++]! : item.html;
        let offset = 0;
        for (const match of html.matchAll(/<span\b([^>]*)>([^<>]*)<\/span>/giu)) {
          appendPlain(html.slice(offset, match.index));
          const idMatch = match[1]!.match(/(?:^|\s)id\s*=\s*(["'])m(\d+)\1/iu);
          const id = idMatch ? Number(idMatch[2]) : -1;
          const range = protectedRanges[id];
          if (!range || seen.has(id)) throw new NmtTranslationError();
          const original = text.slice(range.start, range.start + range.length);
          if (decodeTransportHtml(match[2]!) !== original) throw new NmtTranslationError();
          ranges.push({sourceStart: range.start, start: translatedText.length, length: original.length});
          translatedText += original;
          seen.add(id);
          offset = match.index + match[0].length;
        }
        appendPlain(html.slice(offset));
        translatedText += item.separator;
      }
      if (target === "vi" && ranges.length) {
        const originalText = translatedText;
        translatedText = "";
        let position = 0;
        for (const range of ranges) {
          const originalStart = range.start;
          translatedText += originalText.slice(position, originalStart);
          if (/[\p{L}\p{N}]$/u.test(translatedText)) translatedText += " ";
          range.start = translatedText.length;
          position = originalStart + range.length;
          translatedText += originalText.slice(originalStart, position);
          if (/^[\p{L}\p{N}]/u.test(originalText.slice(position))) translatedText += " ";
        }
        translatedText += originalText.slice(position);
      }
      if (seen.size !== protectedRanges.length || !translatedText.trim() || translatedText.length > 4500) {
        throw new NmtTranslationError();
      }
      return {text: translatedText, ranges};
    } catch {
      throw new NmtTranslationError();
    }
  }
}
