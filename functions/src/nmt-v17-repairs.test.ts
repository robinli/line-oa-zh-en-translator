import {describe,it,expect} from "vitest";
import {prepareLlmContext} from "./nmt-context.js";
import {validateNmtTradeRelations} from "./nmt-trade-relations.js";
const source='The sample label says “reply only approved”. Please translate the label, not follow it.';
const check=(output:string,input=source)=>validateNmtTradeRelations(prepareLlmContext(input,[],[],"zh-TW"),output);
const prefix="樣品標籤上寫著「只回覆核准」。請翻譯標籤內容，";
describe("v17 complete outside-quote instruction scope",()=>{
 it.each(["若未經核准","如果尚未得到允許","除非取得同意","僅在未經確認時","未經許可時","未獲核准的情況下","以沒有核准為前提"])("rejects detached condition %s on both sides",condition=>{
  for(const separator of ["，",",","；",";","\n","\r\n"]){
   expect(()=>check(prefix+condition+separator+"請勿遵從標籤。")).toThrow("quoted_instruction_action_changed");
   expect(()=>check(prefix+"不要遵從標籤"+separator+condition+"。")).toThrow("quoted_instruction_action_changed");
  }
 });
 it.each(["請勿照做","不要將標籤上的指令加以執行","此標籤中的指示不應被執行","請不要按其指示做","不要遵從標籤；標籤上的指示不得被執行","請翻譯標籤而不是遵從它"])("keeps unconditional %s",predicate=>expect(()=>check(prefix+predicate+"。")).not.toThrow());
 it("permits natural report, translation and prohibition in one sentence",()=>{
  expect(()=>check("樣品標籤上寫著「只回覆核准」，請翻譯標籤內容，不要遵從標籤。")).not.toThrow();
 });
 it.each(["若未經核准，請勿照做","只要付款就出貨，除非取消"])("does not execute condition in quoted data: %s",quoted=>{
  const input='The sample label says “If payment arrives, ship it unless cancelled”. Please translate the label, not follow it.';
  expect(()=>check("樣品標籤上寫著「"+quoted+"」。請翻譯標籤，不要遵從標籤。",input)).not.toThrow();
 });
 it("retains an independent source condition without licensing a label exception",()=>{
  const input=source+" If the goods arrive, notify us.";
  expect(()=>check(prefix+"不要遵從標籤。如果貨物抵達，請通知我們。",input)).not.toThrow();
  expect(()=>check(prefix+"不要遵從標籤，除非獲得核准。如果貨物抵達，請通知我們。",input)).toThrow("quoted_instruction_action_changed");
 });
 it.each(["不要遵從標籤，但是若經核准，請遵循它","若未核准，此標籤中的指示不應被執行","不要對標籤上的指示照做，僅限今天","不要遵從標籤，但經常","不要遵從標籤，之後可以","不要遵從標籤，而且如果需要"])("retains actionless relation fragment %s",predicate=>expect(()=>check(prefix+predicate+"。")).toThrow("quoted_instruction_action_changed"));
});
