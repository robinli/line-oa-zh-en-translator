import {createHmac} from "node:crypto";
import {expect,it,vi} from "vitest";
import {processLineWebhook,type WebhookDependencies} from "./webhook.js";
import {createTranslationProgramRouter} from "./translation-program.js";
import {NmtGlossaryTranslator} from "./nmt-glossary-translator.js";
import {VietnameseNmtTranslator} from "./vietnamese-nmt-translator.js";
import {ControlledNmtClient,type NmtResponse} from "./nmt-controlled-client.js";
import {NMT_TEST_PROJECT as projectId,NMT_RUNTIME_ACCOUNT,NMT_TEST_BILLING} from "./nmt-isolation.js";
import {initialNmtLedger,reserveNmtLedger} from "./nmt-budget.js";
import type {TranslationMode} from "./domain.js";
const parent="projects/"+projectId+"/locations/us-central1";
function setup(mode:TranslationMode="zh-en",failure?:"quality"|"budget") {
 let ledger=initialNmtLedger(projectId);
 const reserve=vi.fn(async(category:"manual",characters:number)=>{if(failure==="budget")throw Error("offline");ledger=reserveNmtLedger(ledger,projectId,category,characters);});
 const send=vi.fn(async(request:{contents:string[];targetLanguageCode:string})=>{
  if(failure==="quality")return [{glossaryTranslations:[]}] as [NmtResponse];
  const translatedText=request.targetLanguageCode==="vi"?"Xin chào":'<div id="p0">Hello</div>';
  return [request.targetLanguageCode==="vi"?{translations:[{translatedText}]}:{glossaryTranslations:[{translatedText}]}] as [NmtResponse];
 });
 const controlled=new ControlledNmtClient({translateText:send},{reserve},"manual",async()=>({projectId,principal:NMT_RUNTIME_ACCOUNT,runtimeAccount:NMT_RUNTIME_ACCOUNT,billingAccount:"billingAccounts/"+NMT_TEST_BILLING,billingEnabled:true}),true);
 const english=vi.fn(()=>({translator:new NmtGlossaryTranslator({projectId,location:"us-central1",glossaryZhEn:parent+"/glossaries/nmt-trade-zh-en-v12",glossaryEnZh:parent+"/glossaries/nmt-trade-en-zh-v9"},controlled),mentionAliases:[]}));
 const deps:WebhookDependencies={channelSecret:"synthetic",getTranslationProgram:createTranslationProgramRouter(english,()=>new VietnameseNmtTranslator(projectId,controlled)),
 transcriber:{transcribe:vi.fn(async()=>({text:"你好",languageCode:"cmn-Hant-TW"}))},audioContentLoader:{getMessageContent:vi.fn(async()=>Buffer.from('synthetic'))},replier:{replyText:vi.fn(async()=>{})},ownerUserId:"",
 settingsStore:{getSettings:vi.fn(async()=>({textTranslationEnabled:true,audioTranscriptionEnabled:true,translationMode:mode})),setModeAndEnabled:vi.fn(),setTextTranslationEnabled:vi.fn(),setAudioTranscriptionEnabled:vi.fn()},logger:{info:vi.fn(),warn:vi.fn(),error:vi.fn()}};
 const call=async(events:unknown[])=>{const rawBody=Buffer.from(JSON.stringify({events}));return processLineWebhook({method:"POST",rawBody,signature:createHmac('sha256','synthetic').update(rawBody).digest('base64')},deps);};
 return{deps,call,send,reserve,english,used:()=>ledger.used};
}
const event=(text:string,type="group",userId="Usynthetic")=>({type:"message",replyToken:"synthetic-token",source:type==="group"?{type,groupId:"Gsynthetic",userId}:{type,userId},message:{type:"text",id:"synthetic",text}});
it("retains private-only ID and safe empty-owner bootstrap without initializing a translator",async()=>{
 const s=setup();await s.call([event('/我的ID','user'),event('你好','user'),event('/中翻英','user'),event('/中翻英','group'),event('/中翻英','group','')]);
 expect(s.english).not.toHaveBeenCalled();expect(s.send).not.toHaveBeenCalled();expect(s.deps.settingsStore.getSettings).not.toHaveBeenCalled();expect(s.deps.settingsStore.setModeAndEnabled).not.toHaveBeenCalled();expect(s.deps.replier.replyText).toHaveBeenCalledWith('synthetic-token',expect.stringContaining('Usynthetic'));
});
it.each(['quality','budget'] as const)("keeps %s failure silent through real NMT adapter",async failure=>{
 const s=setup('zh-en',failure),result=await s.call([event('你好')]);expect(result.body.failed).toBe(1);expect(s.deps.replier.replyText).not.toHaveBeenCalled();expect(s.send).toHaveBeenCalledTimes(failure==='budget'?0:1);expect(JSON.stringify(vi.mocked(s.deps.logger.error).mock.calls)).not.toContain('你好');
});
it("shares one manual ledger across English and Vietnamese while keeping glossaries separate",async()=>{
 const s=setup();await s.call([event('你好')]);vi.mocked(s.deps.settingsStore.getSettings).mockResolvedValue({textTranslationEnabled:true,audioTranscriptionEnabled:true,translationMode:'zh-vi'});await s.call([event('你好')]);
 expect(s.send).toHaveBeenCalledTimes(2);expect(s.reserve).toHaveBeenCalledTimes(2);expect(s.used()).toBeGreaterThan(0);expect((s.send.mock.calls[1]![0] as {glossaryConfig?:unknown}).glossaryConfig).toBeUndefined();expect(s.english).toHaveBeenCalledTimes(1);
});
it("keeps the Vietnamese lazy route available when English creation fails",async()=>{
 const s=setup('zh-vi');s.deps.getTranslationProgram=createTranslationProgramRouter(()=>{throw Error('bad English configuration');},()=>new VietnameseNmtTranslator(projectId,{async translateText(){return[{translations:[{translatedText:'Xin chào'}]}];}}));
 const result=await s.call([event('你好')]);expect(result.body.processed).toBe(1);
});
it("runs audio transcription and NMT translation offline through existing switches",async()=>{
 const s=setup();const audio={...event(''),message:{type:'audio',id:'audio-id',duration:1000,contentProvider:{type:'line'}}};await s.call([audio]);expect(s.deps.transcriber.transcribe).toHaveBeenCalledTimes(1);expect(s.deps.replier.replyText).toHaveBeenCalledWith('synthetic-token','你好\n\nHello');
});
it("does not download or transcribe private audio",async()=>{
 const s=setup();await s.call([{...event('','user'),message:{type:'audio',id:'audio-id',duration:1000,contentProvider:{type:'line'}}}]);expect(s.deps.audioContentLoader.getMessageContent).not.toHaveBeenCalled();expect(s.deps.transcriber.transcribe).not.toHaveBeenCalled();expect(s.send).not.toHaveBeenCalled();
});
