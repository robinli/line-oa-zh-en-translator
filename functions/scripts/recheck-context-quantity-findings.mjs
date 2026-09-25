import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TranslationLlmTranslator} from '../lib/translation-llm-translator.js';
const root=new URL('../../',import.meta.url),dir=new URL('.local/tllm-context-quantity-repairs/',root);mkdirSync(dir,{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex'),read=p=>readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const review=json('functions/evaluation/tllm-context-quantity-review.json');
if(process.argv.includes('--audit')){
 const baseline=json('.local/context-quantity-baseline-20260924/manifest.json');
 const changed=baseline.filter(x=>sha(read(x.file))!==x.sha256).map(x=>x.file);
 const hashFailures=Object.entries(review.hashes).flatMap(([n,h])=>['source','compiled'].filter(k=>sha(read('functions/'+(k==='source'?'src/':'lib/')+n+(k==='source'?'.ts':'.js')))!==h[k]).map(k=>n+':'+k));
 const datasetFailures=Object.entries(review.datasetHashes).filter(([n,h])=>sha(read('functions/evaluation/'+n))!==h).map(([n])=>n);
 const evidencePaths=[...new Set(review.results.map(r=>r.evidenceFile))],raw=evidencePaths.flatMap(p=>json(p).results.map(r=>({...r,evidenceFile:p})));
 const noDecision=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['review'].includes(k)));
 const evidenceMismatch=review.results.filter(r=>!raw.some(x=>x.evidenceFile===r.evidenceFile&&x.id===r.id&&x.round===r.round&&JSON.stringify(noDecision(x))===JSON.stringify(noDecision(r)))).map(r=>r.id+':'+r.round);
 const newlineFailures=review.results.filter(r=>r.status==='output'&&JSON.stringify(r.source.trim().match(/\r\n|\r|\n/g))!==JSON.stringify(r.text.match(/\r\n|\r|\n/g))).map(r=>r.id+':'+r.round);
 const rangeFailures=review.results.filter(r=>r.status==='output'&&(r.mentions??[]).some(m=>{let start=m.start??-1;if(m.start===undefined)for(let i=0;i<=m.occurrence;i++)start=r.source.indexOf(m.text,start+1);return r.ranges.filter(t=>t.sourceStart===start&&r.text.slice(t.start,t.start+t.length)===m.text).length!==1;})).map(r=>r.id+':'+r.round);
 const counts=['regression','comparison','v13'].map(set=>({set,rounds:[1,2,3].map(round=>({round,total:review.results.filter(r=>r.set===set&&r.round===round).length,output:review.results.filter(r=>r.set===set&&r.round===round&&r.status==='output').length}))}));
 const result={at:new Date().toISOString(),baseline:baseline.length,changed,hashFailures,datasetFailures,evidenceMismatch,newlineFailures,rangeFailures,counts,rawRecords:raw.length,serviceErrors:raw.filter(r=>r.status==='service_error').map(r=>({id:r.id,round:r.round,evidenceFile:r.evidenceFile}))};
 writeFileSync(new URL('audit.json',dir),JSON.stringify(result,null,2).replace(/\n/g,'\r\n')+'\r\n');console.log(JSON.stringify(result,null,2));
} else if(process.argv.includes('--read')){const start=Number(process.argv[process.argv.indexOf('--read')+1]??0);for(const r of review.results.slice(start,start+75))console.log(JSON.stringify({i:review.results.indexOf(r),id:r.id,round:r.round,source:r.source,status:r.status,text:r.text,reason:r.reason,ranges:r.ranges,...(r.status==='output'?{}:{attempts:r.attempts.map(a=>a.response?.glossaryTranslations)})}));}
else {
 const parent='projects/test-project/locations/us-central1',options={projectId:'test-project',location:'us-central1',glossaryZhEn:parent+'/glossaries/zh-en',glossaryEnZh:parent+'/glossaries/en-zh'};
 const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const atom=(req,value,index=0)=>[...req.contents[0].matchAll(/<span\b[^>]*>([^<>]*)<\/span>/g)].filter(m=>m[1]===value)[index]?.[0]??value;
 const span=(req,index)=>[...req.contents[0].matchAll(/<span\b[^>]*>[^<>]*<\/span>/g)][index]?.[0];
 const div=s=>'<div id="p0">'+s+'</div>';
 const cases=[
 {id:'retry-paragraph-quantity-swap',source:'The first order uses 17 kg bags.\nThe second order uses 680 kg bags.',good:r=>'<div id="p0">首筆訂單使用'+atom(r,'17 kg')+'袋子。</div><div id="p1">第二筆訂單使用'+atom(r,'680 kg')+'袋子。</div>',bad:r=>'<div id="p0">首筆訂單使用'+atom(r,'680 kg')+'袋子。</div><div id="p1">第二筆訂單使用'+atom(r,'17 kg')+'袋子。</div>'},
 {id:'currency-inference',source:'Keep the price ¥8.',good:r=>div('保留價格'+atom(r,'¥8')+'。'),bad:r=>div('保留價格'+atom(r,'¥8').replace('¥8','JPY 8')+'。')},
 {id:'numeric-precision',source:'Keep 1.20 kg.',good:r=>div('保留'+atom(r,'1.20 kg')+'。'),bad:r=>div('保留'+atom(r,'1.20 kg').replace('1.20','1.2')+'。')},
 {id:'unknown-occurrence-id',source:'Please confirm USD 8.',good:r=>div('請確認'+atom(r,'USD 8')+'。'),bad:r=>div('請確認'+atom(r,'USD 8').replace('id="o0"','id="o99"')+'。')},
 {id:'duplicate-occurrence-id',source:'Please confirm USD 8.',good:r=>div('請確認'+atom(r,'USD 8')+'。'),bad:r=>div('請確認'+atom(r,'USD 8')+atom(r,'USD 8')+'。')},
 {id:'quantity-object-swap',source:'@Nora has confirmed 15 kg; @Nora has not confirmed 45 kg.',ranges:[{start:0,length:5},{start:27,length:5}],good:r=>div(atom(r,'@Nora',0)+'已確認'+atom(r,'15 kg')+'；'+atom(r,'@Nora',1)+'尚未確認'+atom(r,'45 kg')+'。'),bad:r=>div(atom(r,'@Nora',0)+'已確認'+atom(r,'45 kg')+'；'+atom(r,'@Nora',1)+'尚未確認'+atom(r,'15 kg')+'。')},
 {id:'condition-negated-reject',source:'Use 600 kg FIBC bags only if the buyer rejects the 20 kg bags. Otherwise, keep the 20 kg bags.',good:r=>div('只有買方拒絕'+atom(r,'20 kg',0)+'袋子時才使用'+atom(r,'600 kg')+' FIBC袋；否則保留'+atom(r,'20 kg',1)+'袋。'),bad:r=>div('只有買方不拒絕'+atom(r,'20 kg',0)+'袋子時才使用'+atom(r,'600 kg')+' FIBC袋；否則保留'+atom(r,'20 kg',1)+'袋。')},
 {id:'prohibition-removed',source:'Do not convert the units; you do not need to calculate the number of bags.',good:r=>div('不要換算單位；無需計算袋數。'),bad:r=>div('請換算單位；無需計算袋數。')},
 {id:'no-obligation-unrelated-without',source:'Copy the units without converting them; you are not required to calculate the total.',good:r=>div('複製單位時不得換算；無需計算總量。'),bad:r=>div('複製單位時無需換算；不必計算總量。')},
 {id:'denominator-known',source:'The price is USD 34.20/MT.',good:r=>div('價格為'+atom(r,'USD 34.20/MT')+'。'),bad:r=>div('價格為'+atom(r,'USD 34.20/MT').replace('/MT','/kg')+'。')},
 {id:'denominator-bag-carton',source:'The packaging charge is USD 8/bag.',good:r=>div('包裝費為'+atom(r,'USD 8')+'/袋。'),bad:r=>div('包裝費為'+atom(r,'USD 8')+'/箱。')},
 {id:'unit-count',source:'Use 17 kg bags.',good:r=>div('使用'+atom(r,'17 kg')+'的袋子。'),bad:r=>div('使用'+atom(r,'17 kg')+'個袋子。')},
 {id:'net-gross',source:'Net weight is 880 kg; gross weight is 884 kg.',good:r=>div('淨重'+atom(r,'880 kg')+'；毛重'+atom(r,'884 kg')+'。'),bad:r=>div('淨重'+atom(r,'884 kg')+'；毛重'+atom(r,'880 kg')+'。')},
 {id:'same-value-label',source:'The red bag holds 12 kg; the blue bag holds 12 kg. Only the red bag needs a label.',good:r=>div('紅袋'+atom(r,'12 kg',0)+'；藍袋'+atom(r,'12 kg',1)+'。只有紅袋需要標籤。'),bad:r=>div('紅袋'+atom(r,'12 kg',0)+'；藍袋'+atom(r,'12 kg',1)+'。只有藍袋需要標籤。')},
 {id:'paragraph-merged',source:'Use 17 kg bags.\n\nUse 680 kg FIBC bags.',good:r=>'<div id="p0">使用'+atom(r,'17 kg')+'袋子。</div><div id="p1"></div><div id="p2">使用'+atom(r,'680 kg')+' FIBC袋。</div>',bad:r=>div('使用'+atom(r,'17 kg')+'袋子，以及'+atom(r,'680 kg')+' FIBC袋。')},
 {id:'same-mention-status-swap',source:'@Nora has confirmed; @Nora has not confirmed.',ranges:[{start:0,length:5},{start:21,length:5}],good:r=>div(atom(r,'@Nora',0)+'已確認；'+atom(r,'@Nora',1)+'尚未確認。'),bad:r=>div(atom(r,'@Nora',1)+'已確認；'+atom(r,'@Nora',0)+'尚未確認。')},
 {id:'literal-entity-double-decode',source:'@A&amp; please confirm &amp;amp;.',ranges:[{start:0,length:7}],good:r=>r.contents[0].replace('please confirm','請確認'),bad:r=>r.contents[0].replace('please confirm','請確認').replace('@A&amp;amp;','@A&amp;')},
 {id:'paragraph-id-reorder',source:'Use 17 kg bags.\nUse 680 kg FIBC bags.',good:r=>'<div id="p0">使用'+atom(r,'17 kg')+'袋子。</div><div id="p1">使用'+atom(r,'680 kg')+' FIBC袋。</div>',bad:r=>'<div id="p1">使用'+atom(r,'17 kg')+'袋子。</div><div id="p0">使用'+atom(r,'680 kg')+' FIBC袋。</div>'},
 {id:'negative-value-sign',source:'Keep the adjustment -2.50 kg.',good:r=>div('保留調整量'+atom(r,'-2.50 kg')+'。'),bad:r=>div('保留調整量'+atom(r,'-2.50 kg').replace('-2.50','+2.50')+'。')},
 {id:'unknown-new-unit',source:'Keep 7 kg.',good:r=>div('保留'+atom(r,'7 kg')+'。'),bad:r=>div('保留'+atom(r,'7 kg').replace('7 kg','7 lb')+'。')}
 ];
 const results=[];
 for(const c of cases){for(const kind of ['good','bad']){const attempts=[],metrics=[];const client={async translateText(req,contract){const output=c[kind](req);attempts.push({request:req,contract,output});return[{glossaryTranslations:[{translatedText:output}]}];}};const r={id:c.id,source:c.source,kind,expected:kind==='good'?'output':'rejected',attempts,metrics};try{Object.assign(r,await new TranslationLlmTranslator({...options,onMetric:m=>metrics.push(m)},client).translateWithRanges(c.source,'en','zh-TW',{protectedRanges:c.ranges??[]}));r.status='output';}catch(e){r.status='rejected';r.reason=e.reason??e.name;}r.passed=r.status===r.expected;results.push(r);}}
 const output={at:new Date().toISOString(),syntheticOnly:true,results};writeFileSync(new URL('injections.json',dir),JSON.stringify(output,null,2).replace(/\n/g,'\r\n')+'\r\n');if(results.some(r=>!r.passed))process.exitCode=1;for(const r of results)console.log(JSON.stringify({id:r.id,kind:r.kind,passed:r.passed,status:r.status,reason:r.reason,text:r.text}));
}
