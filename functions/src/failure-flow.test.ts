import {createHmac} from "node:crypto";
import {expect, it, vi} from "vitest";
import {processLineWebhook, type WebhookDependencies} from "./webhook.js";
import {TranslationQualityError} from "./trade-policy.js";
import {ContentLimitError} from "./translation-failures.js";
const textEvent = (text = "你好", id = "event") => ({type: "message", replyToken: "reply", webhookEventId: id, source: {type: "group", groupId: "group"}, message: {type: "text", id: "message", text}});
const audioEvent = () => ({...textEvent(),message:{type:"audio",id:"audio",duration:1000,contentProvider:{type:"line"}}});
function setup() {
  const deps: WebhookDependencies = {channelSecret:"secret",ownerUserId:"owner", translator:{translate:vi.fn().mockResolvedValue("Hello")},
    transcriber:{transcribe:vi.fn().mockResolvedValue({text:"你好"})},audioContentLoader:{getMessageContent:vi.fn().mockResolvedValue(Buffer.from("synthetic"))},
    replier:{replyText:vi.fn().mockResolvedValue(undefined)},failureStore:{save:vi.fn().mockResolvedValue(undefined)},
    settingsStore:{getSettings:vi.fn().mockResolvedValue({textTranslationEnabled:true,audioTranscriptionEnabled:true,translationMode:"zh-en"}),setModeAndEnabled:vi.fn(),setTextTranslationEnabled:vi.fn(),setAudioTranscriptionEnabled:vi.fn()},
    logger:{info:vi.fn(),warn:vi.fn(),error:vi.fn()}};
  const call = (events: unknown[]) => {const rawBody=Buffer.from(JSON.stringify({events}));return processLineWebhook({method:"POST",rawBody,signature:createHmac("sha256","secret").update(rawBody).digest("base64")},deps);};
  return {deps,call};
}
it.each(["zh-en","zh-to-en","en-to-zh","zh-vi"] as const)("records failure with source, mode and direction in %s",async mode=>{
  const {deps,call}=setup();vi.mocked(deps.settingsStore.getSettings).mockResolvedValue({textTranslationEnabled:true,audioTranscriptionEnabled:true,translationMode:mode});
  vi.mocked(deps.translator!.translate).mockRejectedValue(new TranslationQualityError("protected_value_changed"));
  const source=mode==="en-to-zh"?"Hello":"你好";const result=await call([textEvent(source)]);
  expect(result.body).toMatchObject({failed:1,processed:0,ignored:0});
  expect(deps.failureStore.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({sourceText:source,translationMode:mode,reason:"protected_value_changed",stage:"translation",targetLanguageCode:mode==="en-to-zh"?"zh-TW":mode==="zh-vi"?"vi":"en"}));
  expect(deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("reply","🚧");
});
it.each(["download","transcription","translation","duration","size","transcript_length"])("records audio %s failure with only the available transcript",async kind=>{
  const {deps,call}=setup();const event=audioEvent();
  if(kind==="download")vi.mocked(deps.audioContentLoader.getMessageContent).mockRejectedValue(new Error("private download body"));
  if(kind==="transcription")vi.mocked(deps.transcriber.transcribe).mockRejectedValue(new Error("private transcript body"));
  if(kind==="translation")vi.mocked(deps.translator!.translate).mockRejectedValue(new Error("private translation body"));
  if(kind==="duration")event.message.duration=60000;
  if(kind==="size")vi.mocked(deps.audioContentLoader.getMessageContent).mockRejectedValue(new ContentLimitError("audio_too_large"));
  if(kind==="transcript_length")deps.maxMessageLength=1;
  expect((await call([event])).body.failed).toBe(1);
  expect(deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("reply","🚧");
  expect(deps.failureStore.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({messageType:"audio",sourceText:["translation","transcript_length"].includes(kind)?"你好":null}));
  expect(JSON.stringify(vi.mocked(deps.logger.error).mock.calls)).not.toContain("private");
});
it("does not save successful/unchanged messages or normal skips",async()=>{
  const {deps,call}=setup();vi.mocked(deps.translator!.translate).mockResolvedValueOnce("PP-BK？").mockResolvedValueOnce("Hello");
  const result=await call([textEvent("PP-BK?"),textEvent(),textEvent("OK"),textEvent("123😀"),{...textEvent(),source:{type:"user",userId:"private"}},textEvent("/翻譯狀態")]);
  expect(result.body).toMatchObject({processed:4,ignored:2,failed:0});expect(deps.failureStore.save).not.toHaveBeenCalled();expect(deps.replier.replyText).toHaveBeenNthCalledWith(1,"reply","👆");
});
it("skips disabled oversized content and unsupported directions without storing",async()=>{
  const {deps,call}=setup();deps.maxMessageLength=1;vi.mocked(deps.settingsStore.getSettings).mockResolvedValue({textTranslationEnabled:false,audioTranscriptionEnabled:false,translationMode:"zh-en"});
  expect((await call([textEvent("很長"),audioEvent()])).body).toMatchObject({processed:2,ignored:0,failed:0});
  vi.mocked(deps.settingsStore.getSettings).mockResolvedValue({textTranslationEnabled:true,audioTranscriptionEnabled:false,translationMode:"zh-to-en"});deps.maxMessageLength=2000;
  expect((await call([textEvent("Hello")])).body.processed).toBe(1);expect(deps.failureStore.save).not.toHaveBeenCalled();expect(deps.replier.replyText).toHaveBeenCalledTimes(3);expect(vi.mocked(deps.replier.replyText).mock.calls.every(call=>call[1]==="👆")).toBe(true);
});
it("preserves oversized source completely without calling the provider",async()=>{
  const {deps,call}=setup(),source="中文😀".repeat(2000);await call([textEvent(source)]);
  expect(deps.translator!.translate).not.toHaveBeenCalled();expect(deps.failureStore.save).toHaveBeenCalledWith(expect.objectContaining({sourceText:source,reason:"text_too_long"}));
});
it.each(["setup","empty","format","ranges"])("reports %s program blocking before attempting delivery",async kind=>{
  const {deps,call}=setup();const event=textEvent();
  if(kind==="setup")deps.getTranslationProgram=()=>{throw Error("private config");};
  if(kind==="empty")vi.mocked(deps.translator!.translate).mockResolvedValue("");
  if(kind==="format")vi.mocked(deps.translator!.translate).mockResolvedValue("x".repeat(24001));
  if(kind==="ranges") {event.message.text="@A 你好";Object.assign(event.message,{mention:{mentionees:[{type:"user",index:0,length:2,userId:"U"+"1".repeat(32)}]}});deps.translator!.translateWithRanges=vi.fn().mockRejectedValue(new TranslationQualityError("invalid_protected_range"));}
  expect((await call([event])).body.failed).toBe(1);expect(deps.failureStore.save).toHaveBeenCalledOnce();expect(deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("reply","🚧");
});
it.each(["normal","unchanged","failure"])("does not retry %s LINE delivery failures or misclassify them",async kind=>{
  const {deps,call}=setup();vi.mocked(deps.replier.replyText).mockRejectedValue(new Error("token and secret body"));
  if(kind==="unchanged")vi.mocked(deps.translator!.translate).mockResolvedValue("你好");
  if(kind==="failure")vi.mocked(deps.translator!.translate).mockRejectedValue(new Error("source secret"));
  expect((await call([textEvent()])).body).toMatchObject({failed:1,processed:0});expect(deps.replier.replyText).toHaveBeenCalledOnce();expect(deps.failureStore.save).toHaveBeenCalledTimes(kind==="failure"?1:0);expect(JSON.stringify(vi.mocked(deps.logger.error).mock.calls)).not.toMatch(/token|secret/);
});
it("starts the failure reply while storage is pending, then waits for both",async()=>{
  const {deps,call}=setup();let release!:()=>void;vi.mocked(deps.failureStore.save).mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));vi.mocked(deps.translator!.translate).mockRejectedValue(new Error("unavailable"));
  const pending=call([textEvent()]);await vi.waitFor(()=>expect(deps.replier.replyText).toHaveBeenCalledWith("reply","🚧"));release();expect((await pending).body.failed).toBe(1);
});
it.each([false,true])("continues the batch when storage fails (reply also fails: %s)",async replyFails=>{
  const {deps,call}=setup();vi.mocked(deps.translator!.translate).mockRejectedValueOnce(new Error("sensitive source"));vi.mocked(deps.failureStore.save).mockRejectedValue(new Error("sensitive DB payload"));if(replyFails)vi.mocked(deps.replier.replyText).mockRejectedValueOnce(new Error("sensitive LINE payload"));
  expect((await call([textEvent(),textEvent("第二則","event2")])).body).toMatchObject({failed:1,processed:1,ignored:0});expect(deps.failureStore.save).toHaveBeenCalledOnce();expect(JSON.stringify(vi.mocked(deps.logger.error).mock.calls)).not.toContain("sensitive");
});
it("does not record management or settings-read errors as translation content",async()=>{
  const {deps,call}=setup();vi.mocked(deps.settingsStore.getSettings).mockRejectedValue(new Error("private settings"));await call([textEvent("/翻譯設定"),textEvent()]);expect(deps.failureStore.save).not.toHaveBeenCalled();expect(deps.replier.replyText).not.toHaveBeenCalled();expect(JSON.stringify(vi.mocked(deps.logger.error).mock.calls)).not.toContain("private settings");
});
it("never persists arbitrary quality error text as a reason",async()=>{
  const {deps,call}=setup();vi.mocked(deps.translator!.translate).mockRejectedValue(new TranslationQualityError("confidential original"));await call([textEvent()]);expect(deps.failureStore.save).toHaveBeenCalledWith(expect.objectContaining({reason:"quality_rejected"}));expect(JSON.stringify(vi.mocked(deps.logger.error).mock.calls)).not.toContain("confidential");
});

it.each(["OK", "Yes!", "No", "123", "😀", "!!!"])("acknowledges skipped %s without providers or storage",async text=>{
  const {deps,call}=setup();expect((await call([textEvent(text)])).body).toMatchObject({processed:1,ignored:0,failed:0});
  expect(deps.replier.replyText).toHaveBeenCalledExactlyOnceWith("reply","👆");expect(deps.translator!.translate).not.toHaveBeenCalled();expect(deps.failureStore.save).not.toHaveBeenCalled();
});
it("continues after a skipped-symbol delivery failure without storing or retrying",async()=>{
  const {deps,call}=setup();vi.mocked(deps.replier.replyText).mockRejectedValueOnce(new Error("private token"));
  expect((await call([textEvent("OK"),textEvent("123")])).body).toMatchObject({processed:1,ignored:0,failed:1});
  expect(deps.replier.replyText).toHaveBeenCalledTimes(2);expect(deps.failureStore.save).not.toHaveBeenCalled();expect(deps.translator!.translate).not.toHaveBeenCalled();
});
