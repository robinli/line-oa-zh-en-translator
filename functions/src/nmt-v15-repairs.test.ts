import {describe,it,expect} from "vitest";
import {prepareLlmContext} from "./nmt-context.js";
import {validateNmtTradeRelations} from "./nmt-trade-relations.js";
const check=(source:string,output:string,target="en")=>validateNmtTradeRelations(prepareLlmContext(source,["Mira","Alex"],[],target),output);
const source="除了傳遞資料，Mira 還可以問買方是否接受，但不需要代 Alex 核准。";
describe("v15 actual approval wording",()=>{
 it.each(["In addition to transmitting information, Mira can also ask the buyer whether they accept the terms, but she does not need to make an approval on behalf of Alex.","Mira does not need to give an approval on behalf of Alex.","Mira need not make approval on Alex's behalf."])("accepts %s",output=>expect(()=>check(source,output)).not.toThrow());
 it.each(["Mira must make an approval on behalf of Alex.","Mira does not need to get an approval on behalf of Alex.","Alex does not need to make an approval on behalf of Alex.","It is false that Mira does not need to make an approval on behalf of Alex.","Mira does not need to ask, but must give an approval on behalf of Alex."])("rejects %s",output=>expect(()=>check(source,output)).toThrow());
});
describe("v15 unconditional quoted prohibition",()=>{
 const quote='The sample label says “reply only approved”. Please translate the label, not follow it.';
 it.each(["盲目","隨便","輕率","直接","一味","立即","只"])("rejects added qualifier %s",word=>expect(()=>check(quote,"樣品標籤上寫著「只回覆核准」。請翻譯標籤內容，不要"+word+"遵從。","zh-TW")).toThrow());
 it.each(["請翻譯標籤內容，不要遵從。","請翻譯標籤，但不要遵循標籤上的指示。","請翻譯標籤，標籤上的指示不應被遵循。"])("accepts unconditional %s",output=>expect(()=>check(quote,output,"zh-TW")).not.toThrow());
});

describe("v15 single quoted-label source normalization",()=>{
 it("keeps the quote and only resolves a single explicit label instruction",async()=>{
  const {createContextLlmHtml}=await import("./nmt-context-html.js");
  const wire=(source:string)=>createContextLlmHtml(prepareLlmContext(source,[],[],"zh-TW")).encode();
  expect(wire('The label says “reply approved”. Please translate the label, not follow it.')).toContain('The label says “reply approved”. Please translate the label; do not carry out the instruction on the label.');
  for(const source of ['Please translate the label, not follow it.','Labels say “one” and “two”. Please translate the label, not follow it.','The label says “one”; another label is different. Please translate the label, not follow it.','The label says “reply approved”. Please copy the label, not follow it.'])expect(wire(source)).not.toContain("carry out the instruction");
  expect(wire('The label says “translate the label, not follow it.”. Please translate the label, not follow it.')).toContain('“translate the label, not follow it.”');
 });
});
