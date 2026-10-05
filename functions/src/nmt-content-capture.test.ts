import {afterEach, expect, it, vi} from "vitest";
import {AuthenticatedNmtTransport, ControlledNmtClient} from "./nmt-controlled-client.js";
import {NmtDirectTranslator} from "./nmt-direct-translator.js";
import {projectNmtOutputContents, copyNmtOutputContents, type NmtContentObserver} from "./nmt-content-capture.js";
import {NMT_TEST_PROJECT, NMT_TEST_ACCOUNT, NMT_RUNTIME_ACCOUNT, NMT_TEST_BILLING} from "./nmt-isolation.js";
const parent = "projects/" + NMT_TEST_PROJECT + "/locations/us-central1";
const request = {parent, model: parent + "/models/general/nmt", contents: ["請確認裝櫃。"], mimeType: "text/plain", sourceLanguageCode: "zh-TW", targetLanguageCode: "en"};
const options = {timeout: 15000, retry: {retryCodes: []}};
const auth = {getAccessToken: async () => "PRIVATE ACCESS TOKEN", getCredentials: async () => ({}), getProjectId: async () => NMT_TEST_PROJECT};
afterEach(() => {vi.unstubAllGlobals();});
function setup(response: unknown = {translations: [{translatedText: "Please confirm loading."}], privateField: "PRIVATE SDK DATA"}) {
  const onInput = vi.fn(), onOutput = vi.fn();
  const fetch = vi.fn(async () => ({ok: true, json: async () => response})); vi.stubGlobal("fetch", fetch);
  const transport = new AuthenticatedNmtTransport(auth as never, {onInput, onOutput});
  return {transport, onInput, onOutput, fetch};
}
it.each([{contents: ["請確認。"]}, {contents: ['<div id="p0">A &amp; B <span translate="no">PP-BK</span></div>\r\n']}, {contents: ["第一段", "第二段\n😀"]}])("captures exactly the submitted contents without headers or other request fields: %j", async ({contents}) => {
  const s = setup(); await s.transport.translateText({...request, contents}, options);
  const init = (s.fetch.mock.calls as unknown[][])[0]![1] as RequestInit;
  expect(s.onInput.mock.calls[0]![0]).toEqual(JSON.parse(String(init.body)).contents);
  expect(s.onOutput.mock.calls[0]![0]).toEqual({translations: ["Please confirm loading."]});
  expect(JSON.stringify([s.onInput.mock.calls, s.onOutput.mock.calls])).not.toMatch(/PRIVATE ACCESS TOKEN|PRIVATE SDK DATA/);
});
it("records before decode and traditional conversion", async () => {
  const s = setup({translations: [{translatedText: "请确认装柜。"}]});
  const client = new ControlledNmtClient(s.transport, {reserve: async () => {}}, "smoke", async () => ({projectId: NMT_TEST_PROJECT, principal: NMT_TEST_ACCOUNT, runtimeAccount: NMT_RUNTIME_ACCOUNT, billingEnabled: true, billingAccount: "billingAccounts/" + NMT_TEST_BILLING}), false, undefined, "nmt-direct-v1");
  const translated = await new NmtDirectTranslator({projectId: NMT_TEST_PROJECT, profile: "nmt-direct-v1"}, client).translate("Please confirm loading.", "en", "zh-TW");
  expect(s.onOutput.mock.calls[0]![0]).toEqual({translations: ["请确认装柜。"]}); expect(translated).toBe("請確認裝櫃。");
});
it("keeps raw rejected output while the translator rejects it", async () => {
  const s = setup({translations: [{translatedText: "A changed protected code"}]});
  const client = new ControlledNmtClient(s.transport, {reserve: async () => {}}, "smoke", async () => ({projectId: NMT_TEST_PROJECT, principal: NMT_TEST_ACCOUNT, runtimeAccount: NMT_RUNTIME_ACCOUNT, billingEnabled: true, billingAccount: "billingAccounts/" + NMT_TEST_BILLING}), false, undefined, "nmt-direct-v1");
  await expect(new NmtDirectTranslator({projectId: NMT_TEST_PROJECT, profile: "nmt-direct-v1"}, client).translate("請確認 PP-BK。", "zh-TW", "en")).rejects.toThrow();
  expect(s.onInput.mock.calls[0]![0][0]).toContain('translate="no"'); expect(s.onOutput.mock.calls[0]![0]).toEqual({translations: ["A changed protected code"]});
});
it.each([403, 429, "timeout", "invalid_json"])("keeps attempted input without inventing output on %s", async failure => {
  const s = setup(); s.fetch.mockImplementation(async () => {if (failure === "timeout") throw new Error("private timeout"); return {ok: typeof failure !== "number", status: failure, json: async () => {throw new Error("invalid JSON");}} as never;});
  await expect(s.transport.translateText(request, options)).rejects.toThrow(); expect(s.onInput).toHaveBeenCalledTimes(1); expect(s.onOutput).not.toHaveBeenCalled(); expect(s.fetch).toHaveBeenCalledTimes(1);
});
it("does not mark input sent when credentials fail before fetch", async () => {
  const onInput = vi.fn(), onOutput = vi.fn(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const transport = new AuthenticatedNmtTransport({...auth, getAccessToken: async () => {throw new Error("private credentials");}} as never, {onInput, onOutput});
  await expect(transport.translateText(request, options)).rejects.toThrow(); expect(onInput).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("observer mutation or exceptions cannot change the sent body or provider response", async () => {
  const raw = {translations: [{translatedText: "original"}]}; const fetch = vi.fn(async () => ({ok: true, json: async () => raw})); vi.stubGlobal("fetch", fetch);
  const observer: NmtContentObserver = {onInput: contents => {contents[0] = "mutated"; throw Error("observer");}, onOutput: contents => {contents.translations![0] = "mutated"; throw Error("observer");}};
  const result = await new AuthenticatedNmtTransport(auth as never, observer).translateText(request, options);
  expect(result[0]).toEqual(raw); expect(raw.translations[0]!.translatedText).toBe("original"); expect(JSON.parse(String((fetch.mock.calls as unknown[][])[0]![1] && ((fetch.mock.calls as unknown[][])[0]![1] as RequestInit).body)).contents).toEqual(request.contents);
});
it("preserves both response sources, missing/empty strings and malformed entries without arbitrary data", () => {
  const raw = {translations: [{translatedText: "a", secret: "private"}, {}, {translatedText: ""}, {translatedText: {secret: "private"}}], glossaryTranslations: [{translatedText: "b"}], token: "private"};
  expect(projectNmtOutputContents(raw)).toEqual({translations: ["a", null, "", null], glossaryTranslations: ["b"]});
  expect(projectNmtOutputContents({translations: null, glossaryTranslations: "bad"})).toEqual({translations: null, glossaryTranslations: null});
  expect(projectNmtOutputContents(null)).toEqual({}); expect(copyNmtOutputContents({...projectNmtOutputContents(raw), secret: "private"} as never)).toEqual(projectNmtOutputContents(raw));
});
