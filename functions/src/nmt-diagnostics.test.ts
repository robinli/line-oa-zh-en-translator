import {afterEach,expect,it,vi} from "vitest";
import {AuthenticatedNmtTransport,ControlledNmtClient} from "./nmt-controlled-client.js";
import {nmtFailure} from "./nmt-diagnostics.js";
import {NMT_TEST_PROJECT as projectId,NMT_TEST_ACCOUNT as principal,NMT_TEST_BILLING,NMT_RUNTIME_ACCOUNT as runtimeAccount} from "./nmt-isolation.js";
const identity={projectId,principal,runtimeAccount,billingEnabled:true,billingAccount:"billingAccounts/"+NMT_TEST_BILLING};
const parent="projects/"+projectId+"/locations/us-central1";
const request={parent,model:parent+"/models/general/nmt",contents:['<div>😀 甲</div>'],mimeType:"text/html",sourceLanguageCode:"en",targetLanguageCode:"zh-TW",glossaryConfig:{glossary:parent+"/glossaries/nmt-trade-en-zh-v9",ignoreCase:false as const,contextualTranslationEnabled:false as const}};
const options={timeout:15000,retry:{retryCodes:[]}};
const auth=()=>({getAccessToken:vi.fn(async()=>"secret-token"),getCredentials:vi.fn(async()=>({})),getProjectId:vi.fn(async()=>projectId)});
const responses=[{email:principal},{billingEnabled:true,billingAccountName:identity.billingAccount},{email:runtimeAccount}];
afterEach(()=>{vi.unstubAllGlobals();});
it.each([[0,"identity.token_info"],[1,"identity.billing"],[2,"identity.runtime_account"]] as const)("reports exact identity failure phase %s without retaining response data",async(index,stage)=>{
 let calls=0;const fetch=vi.fn(async()=>{const i=calls++;return i===index?{ok:false,status:403,json:async()=>{throw Error('must not inspect private body');}}:{ok:true,json:async()=>responses[i]};});vi.stubGlobal('fetch',fetch);
 const transport=new AuthenticatedNmtTransport(auth() as never),reserve=vi.fn(),send=vi.fn();const client=new ControlledNmtClient({translateText:send},{reserve},'smoke',()=>transport.identity());
 await expect(client.translateText(request,options)).rejects.toMatchObject({diagnostic:{stage,category:'permission',httpStatus:403,reservation:'not_started',provider:'not_started'}});
 expect(fetch).toHaveBeenCalledTimes(index+1);expect(reserve).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
it('accepts complete identity and performs one reservation before one unchanged provider request',async()=>{
 let calls=0;const fetch=vi.fn(async()=>{const i=calls++;return{ok:true,json:async()=>i<3?responses[i]:{glossaryTranslations:[{translatedText:'ok'}]}};});vi.stubGlobal('fetch',fetch);
 const transport=new AuthenticatedNmtTransport(auth() as never);const reserve=vi.fn(async()=>{expect(fetch).toHaveBeenCalledTimes(3);});
 await expect(new ControlledNmtClient(transport,{reserve},'smoke',()=>transport.identity()).translateText(request,options)).resolves.toEqual([{glossaryTranslations:[{translatedText:'ok'}]}]);
 expect(reserve).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(4);const init=(fetch.mock.calls as unknown[][])[3]![1] as RequestInit;
 expect(JSON.parse(String(init.body))).toEqual((({parent:_,...body})=>body)(request));expect(init.method).toBe('POST');
});
it.each(['getAccessToken','getCredentials','getProjectId'] as const)('sanitizes credential/project exception in %s',async(method)=>{
 const a=auth();a[method].mockRejectedValue(Object.assign(Error('secret-token source raw headers'),{response:{status:401,data:'secret-token'},code:'SECRET_TOKEN'}));let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>responses[calls++]})));
 const transport=new AuthenticatedNmtTransport(a as never);let failure;try{await transport.identity();}catch(error){failure=error;}
 expect(failure).toMatchObject({diagnostic:{stage:method==='getProjectId'?'identity.project':'identity.credentials',category:'authentication',httpStatus:401}});expect(JSON.stringify(failure)).not.toMatch(/secret-token|source|headers|SECRET_TOKEN/);expect(String(failure)).not.toContain('secret-token');
});
it('marks uncertain reservation failure separately and never sends or retries',async()=>{
 const reserve=vi.fn(async()=>{throw Object.assign(Error('private transaction details'),{code:14});}),send=vi.fn();
 await expect(new ControlledNmtClient({translateText:send},{reserve},'smoke',async()=>identity).translateText(request,options)).rejects.toMatchObject({diagnostic:{stage:'reservation',category:'unavailable',code:14,reservation:'not_confirmed',provider:'not_started'}});
 expect(reserve).toHaveBeenCalledTimes(1);expect(send).not.toHaveBeenCalled();
});
it('records committed reservation on a provider failure without a retry or refund',async()=>{
 const reserve=vi.fn(async()=>{});vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:429})));const transport=new AuthenticatedNmtTransport(auth() as never);
 await expect(new ControlledNmtClient(transport,{reserve},'smoke',async()=>identity).translateText(request,options)).rejects.toMatchObject({diagnostic:{stage:'provider',httpStatus:429,reservation:'committed',provider:'transport_started'}});
 expect(reserve).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
});
it('retains fail-closed target and principal validation with no reservation',async()=>{
 const reserve=vi.fn(),send=vi.fn();await expect(new ControlledNmtClient({translateText:send},{reserve},'smoke',async()=>({...identity,principal:'wrong'})).translateText(request,options)).rejects.toMatchObject({diagnostic:{stage:'identity.validation',category:'guard'}});
 await expect(new ControlledNmtClient({translateText:send},{reserve},'smoke',async()=>identity).translateText({...request,model:'wrong'},options)).rejects.toMatchObject({diagnostic:{stage:'request_validation',category:'guard'}});expect(reserve).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
it.each([{message:'source secret-token',code:'https://private/?token=secret-token',headers:{authorization:'secret-token'}},{code:1234567,status:1234567,response:{status:'secret-token',body:'source'}},new Error('raw HTTP headers')])('drops arbitrary diagnostic fields rather than copying errors',error=>{
 const value=nmtFailure(error,'identity').diagnostic;expect(Object.keys(value).sort()).toEqual(['category','provider','reservation','stage']);expect(JSON.stringify(value)).not.toMatch(/secret-token|source|headers/);
});

it('uses only the fixed isolated consumer on billing/IAM native fetch, regardless of a foreign quota override',async()=>{
 const prior=process.env.GOOGLE_CLOUD_QUOTA_PROJECT;process.env.GOOGLE_CLOUD_QUOTA_PROJECT='production-project';
 try{let calls=0;const fetch=vi.fn(async()=>({ok:true,json:async()=>responses[calls++]}));vi.stubGlobal('fetch',fetch);
 await expect(new AuthenticatedNmtTransport(auth() as never).identity()).resolves.toEqual(identity);
 const requests=fetch.mock.calls as unknown[][];expect(requests).toHaveLength(3);
 for(const index of [1,2]){const headers=(requests[index]![1] as RequestInit).headers as Record<string,string>;expect(headers['x-goog-user-project']).toBe(projectId);expect(headers.Authorization).toBe('Bearer secret-token');expect(JSON.stringify(headers)).not.toContain('production-project');}
 const oauthHeaders=(requests[0]![1] as RequestInit).headers as Record<string,string>;expect(oauthHeaders['x-goog-user-project']).toBeUndefined();
 }finally{if(prior===undefined)delete process.env.GOOGLE_CLOUD_QUOTA_PROJECT;else process.env.GOOGLE_CLOUD_QUOTA_PROJECT=prior;}
});
it.each([403,429])('a %s after setting the quota consumer still fails closed without retry or reservation',async status=>{
 let calls=0;const fetch=vi.fn(async(_url:string,init:RequestInit)=>{const index=calls++;if(index===0)return{ok:true,json:async()=>responses[0]};expect((init.headers as Record<string,string>)['x-goog-user-project']).toBe(projectId);return{ok:false,status};});vi.stubGlobal('fetch',fetch);
 const transport=new AuthenticatedNmtTransport(auth() as never),reserve=vi.fn(),send=vi.fn();await expect(new ControlledNmtClient({translateText:send},{reserve},'smoke',()=>transport.identity()).translateText(request,options)).rejects.toMatchObject({diagnostic:{stage:'identity.billing',httpStatus:status,reservation:'not_started',provider:'not_started'}});
 expect(fetch).toHaveBeenCalledTimes(2);expect(reserve).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
