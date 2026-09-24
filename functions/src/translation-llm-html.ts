import {TranslationQualityError, type PreparedTradeText} from "./trade-policy.js";
import {decodeLlmTransport} from "./translation-llm-protection.js";

const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

// Only native mention text is visible in a notranslate span. All financial and
// literal-source protection still uses the plain wire protocol. IDs identify
// source occurrences, never LINE users; HTML is discarded before returning text.
export function createLlmHtmlWireText(prepared: PreparedTradeText, wire: {encode(text: string): string}) {
  const values = new Map(prepared.protectedValues.map(item => [item.token, item]));
  const ids = new Map(prepared.rangeTokens.map((item, id) => [item.token, id]));
  return {
    encode(text: string): string {
      return escapeHtml(text).replace(new RegExp(prepared.prefix + "\\d+__", "gu"), token => {
        const id = ids.get(token);
        return id === undefined ? escapeHtml(wire.encode(token)) :
          '<span class="notranslate" translate="no" id="m' + id + '">' + escapeHtml(values.get(token)!.value) + "</span>";
      });
    },
    decodeTransport(html: string): string {
      let body = "", offset = 0;
      const appendBody = (text: string) => {
        if (/[<>]/u.test(text)) throw new TranslationQualityError("invalid_response_format");
        body += text;
      };
      for (const span of html.matchAll(/<span\b([^>]*)>([^<>]*)<\/span>/giu)) {
        appendBody(html.slice(offset, span.index));
        const matches = [...span[1]!.matchAll(/(?:^|\s)id\s*=\s*(["'])m(\d+)\1/giu)];
        if (matches.length !== 1) throw new TranslationQualityError("protected_value_changed");
        const entry = prepared.rangeTokens[Number(matches[0]![2])];
        if (!entry || decodeLlmTransport(span[2]!) !== values.get(entry.token)!.value) {
          throw new TranslationQualityError("protected_value_changed");
        }
        body += wire.encode(entry.token);
        offset = span.index + span[0].length;
      }
      appendBody(html.slice(offset));
      const decoded = decodeLlmTransport(body);
      if (/<\/?[A-Za-z][^<>]*>/u.test(decoded)) throw new TranslationQualityError("invalid_response_format");
      return decoded;
    },
  };
}
