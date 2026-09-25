import {describe,it,expect} from "vitest";
import {prepareLlmContext} from "./nmt-context.js";
import {validateNmtTradeRelations} from "./nmt-trade-relations.js";
const check=(source:string,output:string,target="en")=>validateNmtTradeRelations(prepareLlmContext(source,["Mira","Alex"],[],target),output);
const delegate="除了傳遞資料，Mira 還可以問買方是否接受，但不需要代 Alex 核准。";
const quote='The sample label says “reply only approved”. Please translate the label, not follow it.';
const temporal="If payment arrives before October, we may ship then. This is not a promise.";
describe("v14 equivalent no-obligation grammar",()=>{
 it.each(["Mira can ask whether the buyer accepts, but there is no need for her to approve on Alex's behalf.","Mira can ask the buyer whether they accept; approving on Alex's behalf is unnecessary.","There is no obligation for Mira to approve on Alex's behalf.","It is unnecessary for Mira to approve on Alex's behalf.","For Mira to approve on Alex's behalf would be unnecessary.","Giving approval on Alex's behalf is not necessary.","Approving on Alex's behalf isn’t necessary.","It is not necessary for her to approve on Alex's behalf.","Approval by Mira on Alex's behalf is unnecessary."])("accepts %s",s=>expect(()=>check(delegate,s)).not.toThrow());
 it.each(["Mira has no need to ask; she must approve on Alex's behalf.","There is no need for her to ask, but she must approve on Alex's behalf.","There is no need for Alex to approve on Alex's behalf.","It is false that there is no need for her to approve on Alex's behalf.","Approving on Alex's behalf is not unnecessary.","Approving on Alex's behalf isn't unnecessary.","Approving on Alex's behalf is necessary.","Approval on Alex's behalf is required, asking is not necessary.","There is no need for her not to approve on Alex's behalf."])("rejects %s",s=>expect(()=>check(delegate,s)).toThrow());
});
describe("v14 follow synonym keeps object and polarity",()=>{
 it.each(["樣品標籤寫著「只回覆核准」。請翻譯標籤，但不要遵循標籤上的指示。","請翻譯標籤，而不是遵循它。","請翻譯標籤，標籤上的指示不應被遵循。"])("accepts %s",s=>expect(()=>check(quote,s,"zh-TW")).not.toThrow());
 it.each(["請翻譯標籤，請遵循標籤上的指示。","請翻譯標籤，不要遵循相反的指令，請遵循標籤本身。","請翻譯標籤，不要不遵循標籤。","請翻譯標籤，並非禁止遵循標籤。","請翻譯標籤，不要遵循客戶的要求。"])("rejects %s",s=>expect(()=>check(quote,s,"zh-TW")).toThrow());
});
describe("v14 payment event temporal relation",()=>{
 it.each(["如果款項在十月前抵達，我們屆時可能出貨。這不是承諾。","若在十月前收到款項便可能於屆時出貨，這並非承諾。","如果付款於10月之前到達，我們屆時可能出貨。","假如十月以前收到貨款便可能屆時出貨。","若款項到帳的時間在十月之前，我們屆時可能出貨。","若付款早於十月到帳，我們屆時可能出貨。","如果款項在十月前就抵達，我們屆時可能出貨。","若款項在十月前就到帳便可能於屆時出貨。"])("accepts %s",s=>expect(()=>check(temporal,s,"zh-TW")).not.toThrow());
 it.each(["若款項在十月後到帳，我們屆時可能出貨。這不是承諾。","若款項在十一月前到帳，我們屆時可能出貨。這不是承諾。","若付款晚於十月到帳，我們屆時可能出貨。","若貨物在十月前抵達，我們屆時可能出貨。","若款項未在十月前抵達，我們屆時可能出貨。","若款項在十月前後抵達，我們屆時可能出貨。","若款項在十月前抵達，我們屆時可能在十一月出貨。","若款項抵達，我們屆時可能出貨。","若款項在十月前抵達，我們屆時可能在十月出貨。"])("rejects %s",s=>expect(()=>check(temporal,s,"zh-TW")).toThrow());
 const months=["January","February","March","April","May","June","July","August","September","October","November","December"];
 it.each(months)("binds before/after for source month %s",month=>{
  const number=months.indexOf(month)+1;
  for(const [relation,word,wrong] of [["before","前","後"],["after","後","前"]]){
   const source=`If payment arrives ${relation} ${month}, we may ship then. This is not a promise.`;
   expect(()=>check(source,`若款項在${number}月${word}抵達，我們屆時可能出貨。這不是承諾。`,"zh-TW")).not.toThrow();
   expect(()=>check(source,`若款項在${number}月${wrong}抵達，我們屆時可能出貨。這不是承諾。`,"zh-TW")).toThrow();
   expect(()=>check(source,`若款項在${number%12+1}月${word}抵達，我們屆時可能出貨。這不是承諾。`,"zh-TW")).toThrow();
  }
 });
});
