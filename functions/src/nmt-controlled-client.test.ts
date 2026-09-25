import {expect, it, vi} from "vitest";
import {ControlledNmtClient} from "./nmt-controlled-client.js";
import {countNmtCharacters, initialNmtLedger, reserveNmtLedger, NMT_LIMITS} from "./nmt-budget.js";
import {NMT_TEST_PROJECT as projectId, NMT_TEST_ACCOUNT, NMT_RUNTIME_ACCOUNT, NMT_TEST_BILLING, assertNmtIdentity, assertNmtRequest} from "./nmt-isolation.js";
const identity = {projectId, principal: NMT_TEST_ACCOUNT, runtimeAccount: NMT_RUNTIME_ACCOUNT, billingEnabled: true, billingAccount: "billingAccounts/" + NMT_TEST_BILLING};
const parent = "projects/" + projectId + "/locations/us-central1";
const request = {parent, model: parent + "/models/general/nmt", contents: ['<div>😀 甲</div>', 'quote'], mimeType: "text/html", sourceLanguageCode: "en", targetLanguageCode: "zh-TW", glossaryConfig: {glossary: parent + "/glossaries/nmt-trade-en-zh-v9", ignoreCase: false as const, contextualTranslationEnabled: false as const}};
const options = {timeout: 15000, retry: {retryCodes: [] as number[]}};
it("counts all encoded contents in Unicode code points", () => {expect(countNmtCharacters(request.contents)).toBe(19);expect(countNmtCharacters(['😀'])).toBe(1);});
it.each(['\uD800','\uDC00','a\uD800b'])("rejects malformed UTF16 %s", value => expect(() => countNmtCharacters([value])).toThrow());
it.each([undefined, {}, {...initialNmtLedger(projectId), used: 1}, {...initialNmtLedger(projectId), limit: 100001}, {...initialNmtLedger(projectId), projectId: "production"}, {...initialNmtLedger(projectId), reservations: -1}])("fails closed on missing or damaged ledger", value => expect(() => reserveNmtLedger(value, projectId, "smoke", 1)).toThrow());
it("enforces each category and cumulative exact boundary without mutation", () => {
 let ledger = initialNmtLedger(projectId);
 for (const category of Object.keys(NMT_LIMITS) as Array<keyof typeof NMT_LIMITS>) ledger = reserveNmtLedger(ledger, projectId, category, NMT_LIMITS[category]);
 expect(ledger.used).toBe(100000); expect(() => reserveNmtLedger(ledger, projectId, "manual", 1)).toThrow("exhausted"); expect(ledger.used).toBe(100000);
});
it.each([0,-1,NaN,1.5,Infinity])("rejects invalid reservation %s", amount => expect(() => reserveNmtLedger(initialNmtLedger(projectId), projectId, "manual", amount)).toThrow());
it.each(["principal","projectId","billingAccount","runtimeAccount"] as const)("rejects mismatched %s", field => expect(() => assertNmtIdentity({...identity,[field]:"production"})).toThrow());
it("rejects disabled billing and human principal in runtime", () => {expect(() => assertNmtIdentity({...identity,billingEnabled:false})).toThrow();expect(() => assertNmtIdentity(identity,true)).toThrow();expect(() => assertNmtIdentity({...identity,principal:NMT_RUNTIME_ACCOUNT},true)).not.toThrow();});
it.each(["parent","model"] as const)("rejects foreign %s", field => expect(() => assertNmtRequest({...request,[field]:"projects/production/locations/global"})).toThrow());
it("requires matching general glossary and keeps Vietnamese separate", () => {
 expect(() => assertNmtRequest({...request,glossaryConfig:undefined})).toThrow();
 expect(() => assertNmtRequest({...request,glossaryConfig:{...request.glossaryConfig,contextualTranslationEnabled:true} as never})).toThrow();
 const viParent = "projects/" + projectId + "/locations/global";
 expect(() => assertNmtRequest({...request,parent:viParent,model:viParent+"/models/general/nmt",sourceLanguageCode:"vi",glossaryConfig:undefined})).not.toThrow();
});
it("reserves before sending, counts auxiliaries, and never refunds or retries failures", async () => {
 let ledger = initialNmtLedger(projectId); const calls: string[] = [];
 const budget = {async reserve(category: "smoke", characters: number) {calls.push("reserve");ledger=reserveNmtLedger(ledger,projectId,category,characters);}};
 const send = vi.fn(async () => {calls.push("send");throw Error("timeout");});
 const client = new ControlledNmtClient({translateText:send},budget,"smoke",async()=>identity);
 await expect(client.translateText(request,options)).rejects.toThrow("provider");
 expect(calls).toEqual(["reserve","send"]);expect(ledger.used).toBe(countNmtCharacters(request.contents));expect(send).toHaveBeenCalledTimes(1);
});
it("does not send when identity or persistence fails", async () => {
 const send = vi.fn(); const reserve = vi.fn(async()=>{throw Error("offline");});
 await expect(new ControlledNmtClient({translateText:send},{reserve},"smoke",async()=>identity).translateText(request,options)).rejects.toThrow("reservation");
 await expect(new ControlledNmtClient({translateText:send},{reserve},"smoke",async()=>({...identity,principal:"wrong"})).translateText(request,options)).rejects.toThrow("identity");
 expect(send).not.toHaveBeenCalled();expect(reserve).toHaveBeenCalledTimes(1);
});
it("snapshots input before asynchronous reservation and refuses retries", async () => {
 const mutable = structuredClone(request); const send=vi.fn(async()=>[{}] as [{}]);
 const client=new ControlledNmtClient({translateText:send},{async reserve(){mutable.contents.push("not counted");}},"smoke",async()=>identity);
 await client.translateText(mutable,options);expect(send.mock.calls[0]).toBeDefined();expect((send.mock.calls as unknown[][])[0]![0]).toEqual(request);
 await expect(client.translateText(request,{timeout:15000,retry:{retryCodes:[429]}})).rejects.toThrow("request_validation");
});

it('keeps v8 glossary admissible only for explicitly historical evidence, never live controlled requests',async()=>{const old={...request,glossaryConfig:{...request.glossaryConfig,glossary:parent+'/glossaries/nmt-trade-en-zh-v8'}};expect(()=>assertNmtRequest(old)).toThrow();expect(()=>assertNmtRequest(old,true)).not.toThrow();const send=vi.fn(),reserve=vi.fn();await expect(new ControlledNmtClient({translateText:send},{reserve},'smoke',async()=>identity).translateText(old,options)).rejects.toThrow('request_validation');expect(send).not.toHaveBeenCalled();expect(reserve).not.toHaveBeenCalled();});
