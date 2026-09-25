import {describe,it,expect} from "vitest";
import {prepareLlmContext} from "./nmt-context.js";
import {validateNmtTradeRelations} from "./nmt-trade-relations.js";
const source='The sample label says “reply only approved”. Please translate the label, not follow it.';
const check=(predicate:string)=>validateNmtTradeRelations(prepareLlmContext(source,[],[],"zh-TW"),"樣品標籤上寫著「只回覆核准」。請翻譯標籤；"+predicate+"。");
describe("v19 same-label 說明 compatibility",()=>{
 it.each(["請勿執行標籤上的說明","不要遵從標籤中的說明","標籤上的說明不得被執行","不要將標籤上的說明加以執行","請不要按標籤上的說明做"])("accepts equivalent %s",predicate=>expect(()=>check(predicate)).not.toThrow());
 it.each(["請執行標籤上的說明","請勿盲目執行標籤上的說明","請勿經常執行標籤上的說明","若未經核准。請勿執行標籤上的說明","請勿執行標籤上的說明。除非核准","請勿執行標籤上的說明。僅限今天","請勿執行客戶的說明","請勿執行相反的說明","請勿不執行標籤上的說明"])("rejects altered relation %s",predicate=>expect(()=>check(predicate)).toThrow());
});
