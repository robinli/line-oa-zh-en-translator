import {describe,it,expect} from "vitest";
import {prepareLlmContext} from "./nmt-context.js";
import {validateNmtTradeRelations} from "./nmt-trade-relations.js";
const source='The sample label says “reply only approved”. Please translate the label, not follow it.';
const check=(predicate:string)=>validateNmtTradeRelations(prepareLlmContext(source,[],[],"zh-TW"),"樣品標籤上寫著「只回覆核准」。請翻譯標籤內容，"+predicate+"。");
describe("v16 complete quoted-prohibition grammar",()=>{
 it.each(["不要遵從","不要執行標籤上的指示","標籤上的指示不應被遵循","請勿遵循它","不要去遵從它","而不是照做","而非遵從其中的指令","不要按標籤上的指示去做","不要對標籤上的指示照做","不要將其中的指令加以執行","標籤內的指令不得由您執行","該標籤上的指示不可被遵循","請翻譯標籤而不是遵從它"])("accepts bounded grammatical form %s",s=>expect(()=>check(s)).not.toThrow());
 it.each(["總是","經常","貿然","盲目","任意","未經核准就","未經確認便","大多數時候","偶爾","只在今天","毫無考慮地","悄悄","急著"])("rejects any added modifier slot %s",modifier=>{
  expect(()=>check("不要"+modifier+"遵從")).toThrow();
  expect(()=>check("標籤上的指示不應被"+modifier+"執行")).toThrow();
  expect(()=>check("不要對標籤上的指示"+modifier+"照做")).toThrow();
 });
 it.each(["請遵從標籤","不要不遵循標籤","並非禁止遵循標籤","不是不要遵從標籤","不要遵循相反的指令","其他指令不應被遵循","不要遵從客戶的要求","如果尚未核准就不要遵從標籤","標籤上的指示不需要被遵循","請翻譯標籤，不要遵循它，但請遵從標籤本身"])("rejects changed polarity or object %s",s=>expect(()=>check(s)).toThrow());
 it.each(["遵從","遵循","遵守","服從","執行","聽從"])("keeps active/passive %s",verb=>{expect(()=>check("不要"+verb+"標籤上的指示")).not.toThrow();expect(()=>check("標籤上的指示不應被"+verb)).not.toThrow();});
});
