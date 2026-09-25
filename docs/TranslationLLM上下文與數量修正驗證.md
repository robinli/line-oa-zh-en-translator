# Translation LLM 上下文與數量修正驗證

日期：2026-09-24。第一輪獨立 Verifier 結論為 Changes required，CQV-F01～F06 六項 High 均保留原始 finding 與證據。本文件是 Implementer 的修正記錄，不是獨立放行；修正候選 v11 已完成必要離線驗證與固定 API 回歸，交回重新獨立驗證，尚未部署。

## 修正與有限界線

| Finding | 修正與正反對照 |
|---|---|
| F01 備案變登記 | 僅當原文含「小袋方案／包裝方案」、該段以「備案是／為／：」開始且有袋或 FIBC，並且該段沒有登記／註冊詞時，來源文字改為同義「替代方案」再交模型；輸出該段仍須有 alternative／fallback／backup，不得變 registered／registration。不是由錯譯反推新交易事實；真正登記、備案登記及非包裝登記對照不改。 |
| F02 提及數量錯配 | 僅在既有明確狀態 predicate 的 native occurrence 同一分句內比較數量物件；涵蓋承諾／同意／接受／核准／確認／收到／回覆／付款的英文直接過去式與 has/have/had not 狀態，及中文已／尚未等既有前綴；與既有 mention 狀態檢查共同約束主體、狀態及物件，不以全句數字集合判定。同名提及、完整分句重排、相同數值、合法稱呼逗號有接受對照。「請向另一人確認」等請求不由線性位置猜數量歸屬；這是直接狀態分句的有限關係守門，不是一般代詞解析。 |
| F03 only-if 極性 | 在 only-if／only-when 的 reject 條件與對應中文條件分句比較拒絕極性；不、未、沒有、尚未及會／再／曾／願意等有限修飾不能掩蓋反轉，不接受仍可表示拒絕。也覆蓋來源明確 does not reject 的負向對照，不用全域「不」字規則。 |
| F04 禁止變要求 | 對 calculate／convert／change 的原文明確 do not／don't／must not，目標相應物件分句必須有禁止動作；請換算、刪掉動作、無需換算或否定禁止均拒絕。同句真正的 not required／do not need 仍接受。 |
| F05 重試跨段 | 數量 inline span 同樣必須位於來源 paragraph，與可見 raw 數量、金融 suffix 的段落限制一致。原 17／680 kg 跨段錯配在兩種表示均拒絕，正確兩段均可接受。 |
| F06 計價分母 | 除既有完整金融 quantity 外，斜線後分母另掛在該金額 occurrence 上。bag(s)／袋／袋子、box(es)／箱、carton(s)／紙箱是三組分開的計價名詞，並非重量單位或換算表，組間不等價。未知分母不猜測：斜線後未解析 suffix 至分句邊界要求原樣，含連字號及多詞，故 crate-pack→crate-box、short ton→short kg 均拒絕；複雜無標點後綴若被改寫會保守拒絕。copy exactly 仍先驗證實際回應，再把等價已知分母還原來源字串。 |

只有 kg／MT／lb 原三組重量拼寫等價；幣別、金額、精度、正負號和既有已辨識計價分母的精確契約維持，不增加貨幣換算。自由文字 per ton／每噸不是機械等價 ledger，不能推定 MT；它與斜線計價分母的明確資料契約分開。

## 離線與公開反例

Node.js 22.23.2 完整 npm --prefix functions run verify：check、23 檔／608 項測試、build 通過；包含原 536 項及本輪新增 72 項。保留既有功能斷言與所有 verifier 原始 fixture、rubric、腳本與報告。

[公開注入重播工具](../functions/scripts/recheck-context-quantity-findings.mjs) 只把原 verifier 公開注入流程複製到獨立修正目錄，40 個正反輸出全部符合預期；F02～F06 原反例皆拒絕，所有 20 個正例成功。原始 .local/tllm-context-quantity-verifier/injections.json 未覆寫。另以獨立副本重播原11個邊界案例全部通過；fallback正例僅更新wire匹配字串為「替代方案」，來源fixture與預期輸出及其餘行為斷言不改，原verifier檔案不修改；仍需由Verifier重新獨立確認。

## 候選與失敗保存

- v7：15 筆合成 smoke 保存；登記／非包裝／替代方案 12/12 成功，cqv11 三次因合法英文稱呼逗號被新增 occurrence 物件檢查誤擋，因此不計驗收。
- v8：120 筆定向中完成 61 筆、57 譯文與 4 舊安全拒絕後停止；離線延伸發現未知複合分母只比對字首，crate-pack→crate-box 被錯放，需修正，不計驗收。
- v9：短輪定向完成 19 筆後停止，補齊空白多詞分母與 copy-exact 原樣界線，不計驗收。
- v10：定向120完成，116可用／4舊安全拒絕，新20三輪60/60、登記與替代方案對照12/12正確；全量123筆後因v4h12合法「請勿將…改為」遭誤擋而中止，121輸出、2拒絕，不計最終驗收。
- v11：修正把／將禁止語序，並只把明確狀態的物件綁到提及，保留詢問對象的合法重排；608項離線及40＋11公開檢查通過，定向130筆與同候選全量430筆完成。前一輪20未見案均已轉回歸，不再稱未見。

## 歷史回應離線重播

使用原v6的430份完整合成回應，僅在副本把既有wire的三字隨機nonce重綁至當次請求；要求重綁後整個contents逐字相同才注入，不改數字、內容或occurrence序號。工具和結果明載offlineOnly／wireRewritten／randomNonceOnly，完全不算新候選真API證據。原樣未重綁版本的資料缺失只是nonce不一致，另保留為診斷。

v10完整重播集中揭露v4h12一筆、pack-different-units三筆的禁止語序誤擋，以及v6h32／v8h30兩筆請向某人確認的物件重排誤判；v11重綁後430筆無新增拒絕、原11安全拒絕未變，request不一致為0。引用aux的nonce也先核對完整request，沒有藉重播改寫品質輸出。

目前正式仍為 linewebhook-00018-huk／candidate-v12。沒有部署、IAM、Secret、正式 env、glossary、Firestore 或真人 LINE 操作；中越、群組／私訊指令、相同譯文與失敗靜默行為不變。

## v11 最終固定候選結果

候選為 `candidate-context-quantity-v11`；完整可攜來源、譯文、原 fixture rubric、兩次原始 API 回應、ranges、metric、各案評語及所有七模組雜湊見 [本輪修正逐句審閱](../functions/evaluation/tllm-context-quantity-repair-review.json)。第一輪 [Verifier 報告](TranslationLLM上下文與數量獨立驗證.md) 及原六項 High 的結論不修改；以下是 Implementer 完成證據，仍待重新獨立驗證。

| 固定集合 | 結果 |
|---|---|
| 既有 280 案一輪 | 272 可用、8 實際錯譯安全拒絕、0 誤擋 |
| 比較 30 案三輪 | 每輪 29/30 可用，共 87/90；只有禁止計算袋數弱化被拒絕 |
| 九個核心包裝 | 27/27 可用 |
| 舊 v13 20 案三輪 | 60/60 可用 |
| 第一輪 verifier 20 案轉回歸 | 60/60 可用，其中14核心42/42 |
| 真登記／備案登記／非包裝／包裝替代方案對照 | 12/12 可用 |
| 服務錯誤 | 本候選定向及全量均為0；沒有重抽品質結果 |

全量430與先行定向130皆為同一凍結 v11，合計560個評估結果；其中60筆是原 verifier 回歸、12筆是來源消歧對照、58筆是先行受影響集合的重複診斷，不能重算為新增案例或挑較好結果。所有輸出逐句覆核，未觀察未攔截重大／中等錯誤；輸出率不表示一般準確率。原 v7～v10 首次結果及中止原因全部保留，早期 v1～v6 歷史亦保留於原實作報告與原審閱檔。

F01 的 cqv11 三輪均輸出「The alternative is a 560kg FIBC bulk bag.」，14kg 小袋與 CRLF／CR／LF 段落、@Pico occurrence 正確；真登記三輪維持「registered specification」，備案登記為 filing and registration，非包裝登記也沒有套替代方案。F02～F06 的原公開反例全部拒絕，20個對應正例全部接受；72項新增測試另覆蓋重排／相同數值／稱呼逗號、否定條件、把／將禁止、不同wire跨段、已知與未知複合分母及 copy exactly。

280案八個安全拒絕為 v4h19、v6h16、v8h11、v9h07、v9h28、v10h06、v11h15、v12h14，各次實際錯譯與拒絕原因列於逐句審閱。v12h15 已正確保留 EUR32 佣金已含、EUR18 運費未含且買方另付，沒有變成已付款；v4h19 兩次仍把 HK$6,200 金額錯置成 freight，因此保守拒絕。v12h14 首次弱化禁止，第二次另重複0.625數字，均保存。

- adapter source SHA-256：`ef71ba4704b0d3b99624039a90eaea308910cf1a8152d17649ca22dded86904e`
- adapter compiled SHA-256：`e2b39534a2f37366919e199c94ebc9a1aeb5b24b14b26bc6d786947a760b1061`
- 全量 raw：`.local/tllm-context-quantity/regression-2026-09-24T05-44-56-819Z.json`
- 定向 raw：`.local/tllm-context-quantity/regression-2026-09-24T05-38-03-842Z.json`
- 完整凍結：`.local/tllm-context-quantity-repairs/frozen-v11.json`
- 最終格式／範圍／來源核對：`.local/tllm-context-quantity-repairs/scope-final-v11.json`

## 命令、範圍與交接

使用 Node 22.23.2，PATH 先加入已安裝 Node22 及本專案 .local/node22-tools，逐步檢查 exit code：

1. `node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" --prefix functions run verify`：check、608 tests／23 files、build 成功。
2. `node functions/scripts/recheck-context-quantity-findings.mjs`：40/40；`node functions/scripts/recheck-context-quantity-boundaries.mjs`：11/11。
3. `node functions/scripts/replay-context-quantity-recordings.mjs --rebind-wire`：430份原回應離線診斷，0 request 不一致、0 新增拒絕；不算真API。
4. `node functions/scripts/evaluate-tllm-context-quantity.mjs --include-verifier --include-controls --ids=floor-price,price-inclusion,numeric-fidelity,h12,v2h06,v2h18,v4h12,v4h19,v6h08,v6h32,v8h29,v8h30,v9h14,v10h32,v12h06,v12h15,pack-rough-packaging,pack-clear-packaging,pack-zh-packaging,pack-decimal-units,pack-reverse-condition,pack-tentative-packaging,pack-net-gross,pack-do-not-calculate,pack-different-units,pack-quote-scope,pack-zh-negative,pack-zh-net-gross,pack-split-paragraphs,cqv01,cqv02,cqv03,cqv04,cqv05,cqv06,cqv07,cqv08,cqv09,cqv10,cqv11,cqv12,cqv13,cqv14,cqv15,cqv16,cqv17,cqv18,cqv19,cqv20,repair-registration,repair-filing,repair-nonpackaging,repair-fallback`：固定受影響集合130筆，完整 id 列表及來源保存在定向 raw；再以無篩選同腳本執行430。
5. ADC token 只由 gcloud 放入當次程序環境，執行後移除；單 worker、2.5秒節奏。服務錯誤另列，正式 adapter 沒有自動服務重試或 NMT fallback。

相對 root baseline 120檔，既有7檔改動、113檔未變：

- functions/src/translation-llm-translator.ts：整則上下文 adapter 與 v11 版本。
- functions/src/translation-llm-protection.ts：本次初期必要的引用算式辨識，修正輪未擴大共用行為。
- functions/src/translation-llm-subjects.ts：抽出既有 sourceStatusPattern 並匯出明確狀態識別，供 F02 共用原判準。
- functions/src/translation-llm-translator.test.ts：初期wire fixture相容，原功能斷言保留。
- docs/系統規則與知識總覽.md、docs/原文直送翻譯比較評估.md、docs/專案日誌.md：實際進度與證據。

本次新增的 application helpers 與測試為 translation-llm-context.ts、translation-llm-context-html.ts、translation-llm-context-meaning.ts、其對應三份測試、translation-llm-context-adapter.test.ts、translation-llm-findings.test.ts；修正輪新增 recheck-context-quantity-findings.mjs、recheck-context-quantity-boundaries.mjs、replay-context-quantity-recordings.mjs、synthetic-context-quantity-repair-controls.json、本修正報告與修正審閱JSON，並更新既有本次新增的 evaluate-tllm-context-quantity.mjs、工作項目與實作報告階段。完整所有新增檔清單在修正審閱 scopeAudit（含 planner／verifier 檔，原 verifier 內容未修改）。

WI-01～WI-07 的 Implementer 實作、必要測試、固定API回歸、逐句審閱及文件交接完成；獨立驗證仍未放行。UTF-8無BOM、CRLF、git diff --check、必要相對連結與凍結雜湊核對通過。停止 application code 修改後交 Verifier 重新驗證，須另建至少5個新未見案例。

剩餘限制：HTML與glossary輸出可能變動；有限狀態、條件與禁止句型不是一般語意證明；未知分母保守拒絕可能影響可用性；少量標點／空白瑕疵保留。尚未部署、尚未進行正式 LINE 顯示／通知驗收，也未變更 IAM、Secret、glossary、正式 env 或 Firestore。
