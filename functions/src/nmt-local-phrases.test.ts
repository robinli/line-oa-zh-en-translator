import {expect, it} from "vitest";
import {resolveNmtLocalPhrase} from "./nmt-local-phrases.js";
it.each(["Fine", "fine", "FINE.", " Fine! ", "fine。", "Fine！", "\r\nfInE\t"])("translates only the complete affirmative phrase %s locally", text => {
  expect(resolveNmtLocalPhrase(text, "en", "zh-TW")).toMatchObject({text: "好的。", apiCalled: false});
});
it.each(["Fine?", "Fine？", "a fine", "fine powder", "I'm fine", "Fine @Lee", "Fine 1", "Fine😀", "Fine..", "Fine!!", "Fine.!", "Fine .", "Ｆｉｎｅ", "OK", "Yes", "No", "", "Fine\nFine"])("leaves adjacent phrase %s outside the local candidate", text => {
  expect(resolveNmtLocalPhrase(text, "en", "zh-TW")).toBeNull();
});
it.each([["zh-TW", "en"], ["en", "vi"], ["vi", "zh-TW"], ["en", "zh-CN"]])("keeps direction %s:%s outside the candidate", (source, target) => {
  expect(resolveNmtLocalPhrase("Fine", source, target)).toBeNull();
});
it("excludes any protected occurrence and permits an empty range list", () => {
  expect(resolveNmtLocalPhrase("Fine", "en", "zh-TW", {protectedRanges: [{start: 0, length: 4}]})).toBeNull();
  expect(resolveNmtLocalPhrase("Fine", "en", "zh-TW", {protectedRanges: []})?.text).toBe("好的。");
});
