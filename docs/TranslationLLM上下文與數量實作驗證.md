# Translation LLM 上下文與數量實作驗證

> 本文保留第一輪 v6 的歷史實作與驗證記錄；其後獨立 Verifier 發現六項 High，當前修正狀態見[修正驗證報告](TranslationLLM上下文與數量修正驗證.md)，不以本輪歷史表格宣稱獨立通過。

日期：2026-09-24。當時工作階段：Implementer 已完成 WI-01 至 WI-07；獨立 Verifier 尚未執行。正式仍為 linewebhook-00018-huk／candidate-v12，本次不部署。

## 實作與固定契約

主要 contents 是包含所有原始段落的單一 HTML 字串，每行均有 div id；包括空白行，輸出必須逐段保持 id、順序及來源 CRLF／LF／CR 分隔符。原生提及保留可見顯示名稱，以唯一 occurrence id 對應來源 UTF-16 範圍，不傳 LINE userId。引用輔助僅限既有有界呼叫，主要訊息仍保有全部上下文，且只補回未翻譯的引用。

重量與單位初次以可讀原文送出；金額與其他數字使用可見、不可翻譯的 span，包含真實數字，沒有用 Quantity 隨機代碼取代包裝資料。姓名、產品碼、聯絡資料、字面 markup/entity 及算式使用既有可逆保護。FIBC、CNF／C&F／CFR 保持可見並逐 occurrence 驗證。模型回應先檢查結構與實際內容，才還原來源格式；不能靠覆寫來源值掩蓋數量變化。

限定單位等價為 kg／kgs／kilogram(s)／公斤、MT／metric ton(s)／公噸、lb／lbs／pound(s)／磅；禁止跨組換算、變精度、變正負號、算袋數、改百分比、改幣別或分母。數量逐 occurrence 記錄並限定於來源段落；相同數值不以 Set 去重。英文數量格式與貨幣原樣還原；中文公斤、公噸、磅在一般英譯時固定為 kg、MT、lb，明確要求保持原樣時保留來源字串。不新增貨幣同義放寬，也不將單獨 ton／噸推定 MT。CBM／PCS／TEU／FEU 等已辨識但不屬三組的單位只作精確保護。自由文字「每噸」→「per ton」未加入機械等價 ledger，不增加 metric／MT 或換算；這類文字須逐句人工覆核，不能宣稱已由等價表證明。

品質錯誤仍至多兩次、每次15秒，SDK不自動HTTP重試，服務錯誤不重試。第二次採既有不同姓名 wire、可見重量 span。遇 price_relationship_changed 才將英→中金額改為可見原文，讓模型正確重排價格角色；其他品質失敗保留金融 span。中→英重試金額包含可見實際幣別／數字與精確 suffix；回應可保留完整 suffix 或返回原樣金額，兩者皆先驗證實際內容和 occurrence，缺失、重複或變更均拒絕。無 raw output 直接放行或跨引擎 fallback。

## 有限語意守門

延續 v12 的術語、姓名／提及主體、價格、引文、收貨／送達、可能性及 without 行為限制；新增小袋／FIBC、重量／袋數、淨毛重、空袋、紅藍同值袋標籤、only-if／otherwise、尚未承諾、包裝費／運費、禁止計算／換算／變更與成本／出廠／底價／報價歸屬、指定買／賣方付款動作的有限檢查。只有有證據的偏差會拒絕，不從錯譯重寫交易事實。

這些守門不理解任意未知句法，不能證明所有角色、未知單位、品牌或上下文均正確。全量結果仍逐句閱讀；有輸出不等於準確率。已知低影響的空格、括號或列舉逗號瑕疵會在案例註記；未用 cosmetic 問題掩蓋資料或條件錯誤。

## 驗證與候選歷史

- Node.js 22.23.2：npm --prefix functions run verify，check、22個test files／536項測試、build通過。
- v1兩次中止：第一次verify失敗後shell誤續評估，實際保存25筆；第二次121筆發現span結構問題而停止，兩者不計驗收。
- v2全量430：409輸出、21品質拒絕，Incoterm、混合重量清單等問題仍未通過。
- v3定向11：10輸出、1安全拒絕，不能視為全量驗收。
- v4全量430：387輸出、11品質拒絕、32服務429；全文審閱另發現成本／出廠價對調、付款動作錯譯，因此不放行。
- v5三案定向後啟動全量，71筆時因h12重複重量安全拒絕而停止；保存70輸出與1拒絕，不計凍結候選驗收。
- v6受影響48筆：44可用，v4h19一次及pack-do-not-calculate三次實際錯譯安全拒絕，無服務錯誤；涵蓋6個Incoterm、混合清單、價格與付款、9項核心包裝三輪。同 SHA 全量430結果完成：280案272可用／8安全拒絕；30案三輪每輪29可用／1安全拒絕；舊v13三輪60/60可用，核心9案27/27可用。

所有舊synthetic資料與rubric均依 SHA-256 鎖定，舊v13及歷史審閱檔保留。評估只用合成資料、example網域及虛構顯示名稱；憑證僅暫存程序環境。不呼叫真人LINE、不改Firestore、IAM、Secret、env或glossary。評估工具單worker、每次開始至少相隔2.5秒；429保存安全錯誤診斷並延後下一個不同案例60秒，不在adapter中重試。

## 交付與未執行項目

完整 source／compiled／dataset／result 雜湊、最終文字、ranges、rubric、逐句結論及失敗前後證據存於[可攜審閱檔](../functions/evaluation/tllm-context-quantity-review.json)。419筆產生譯文均經全文審閱，另11筆實際錯譯安全拒絕；本輪未觀察誤擋或未攔截重大／中等錯誤。此為 Implementer 的審閱結論，仍須獨立覆核。

獨立 Verifier、未見20案三輪、正式部署與真人LINE顯示／通知驗收尚未執行。本文件不宣告獨立verification passed。

## 最終數量與證據

| 固定集合 | 邏輯結果 | 產生且審閱為可用 | 安全拒絕 | 未解服務錯誤 |
|---|---:|---:|---:|---:|
| 既有回歸一輪 | 280 | 272 | 8 | 0 |
| 本次30案三輪 | 90 | 87（每輪29） | 3 | 0 |
| 舊v13三輪 | 60 | 60 | 0 | 0 |

首次全量在 v6h19 收到 HTTP401／UNAUTHENTICATED 後停止，原因未進一步推定；更新暫時憑證後，以相同來源／編譯／資料 SHA 續跑該服務失敗與未執行項目。保留原134筆已完成輸出／品質拒絕及原401，沒有重抽既有結果。合計430個邏輯結果、431次case-evaluation紀錄、449次API呼叫（含品質重試與一次401）。正式adapter服務錯誤不重試。

8筆回歸安全拒絕為 v4h19、v6h16、v8h11、v9h07、v9h28、v10h06、v11h15、v12h14。相較舊v12，v12h15改善並完整保留佣金／運費與付款責任；v4h19兩次均仍把未含運費的總價格當作運費，新增拒絕有實際錯譯證據。未用總數抵消誤擋。

| 證據檔 | SHA-256 |
|---|---|
| 初段135筆：.local/tllm-context-quantity/regression-2026-09-24T04-05-16-942Z.json | 51497cfb9c9e1155d40fd83a823810df61b81fdb5a49ebc271224b0f70a23b12 |
| 續跑296筆：.local/tllm-context-quantity/regression-2026-09-24T04-13-21-647Z.json | fd99d624a764b4eaefd3164d6bb9bec7d2993d91d627f9ea2e437f50cd92b7cc |
| 凍結adapter來源 | 8264986e300d83415d3aed48fcf17257ce2dc6cae167f2fef5a5c4438a2c28e1 |
| 凍結adapter編譯檔 | 77211955bf90647ef9c8a136872dc95794c9abbc6cc6076f65fff3bbc4e62553 |

其他6個實作模組及13組資料集的完整SHA列於可攜審閱檔。所有舊資料和rubric與root baseline一致；不得把舊v13稱為本次未見資料。

## 重現命令與工作項目

在 Node.js 22.23.2 的 PATH 下執行：

```powershell
npm --prefix functions run verify
node functions/scripts/evaluate-tllm-context-quantity.mjs --dry-run
node functions/scripts/evaluate-tllm-context-quantity.mjs
# 僅在先前服務錯誤或未完成時，指定原始完整結果檔：
node functions/scripts/evaluate-tllm-context-quantity.mjs --resume=.local/tllm-context-quantity/regression-2026-09-24T04-05-16-942Z.json
```

API命令需要已授權合成評估的暫時 TRADE_EVAL_TOKEN 和 GOOGLE_CLOUD_PROJECT 程序環境；不得將token輸出或落盤。實際verify用上述Node22執行 C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js，不能直接呼叫verify.mjs而漏掉npm_execpath。

| WI | Implementer 狀態 | 證據 |
|---|---|---|
| WI-01 | 完成 | occurrence/段落契約、固定資料SHA與正反例 |
| WI-02 | 完成 | 7案結構smoke、完整主contents、段落/提及/字面還原測試 |
| WI-03 | 完成 | 先驗證回應再還原、精度/符號/單位/幣別/重複反例 |
| WI-04 | 完成 | 既有語意守門＋新包裝、價格角色、付款責任一般化對照 |
| WI-05 | 完成 | check＋536 tests／22 files＋build；既有範圍外整合測試維持 |
| WI-06 | 完成 | 同候選430邏輯結果、逐句審閱、服務失敗與歷史失敗分列 |
| WI-07 | 完成 | 總覽、比較後續、日誌、本報告與差異/格式核對 |

獨立Verifier須重新核對本表，不以完成標記代替AC。沒有部署、真人LINE、IAM/env/Secret/glossary/Firestore變更。

## 相對 root baseline 的改動與格式核對

基準為 .local/context-quantity-baseline-20260924/manifest.json 的120檔快照。原有檔案僅6個改變，另14個本次新增檔（含Planner工作項目）；既有 .codex/ 未動。所有範圍外來源、舊資料、舊rubric及舊v13審閱檔與baseline相同。

| 檔案 | 改動目的 |
|---|---|
| functions/src/translation-llm-translator.ts | 單一主要HTML上下文、TLLM專屬驗證、依品質原因選重試表示及v6版本 |
| functions/src/translation-llm-protection.ts | 算式原式檢查納入尾端百分比符號，其他共用保護行為維持 |
| functions/src/translation-llm-translator.test.ts | 更新舊wire fixture，保留原53項行為及反例 |
| functions/src/translation-llm-context.ts、translation-llm-context.test.ts | 每段與每個數量/精確值occurrence ledger |
| functions/src/translation-llm-context-html.ts、translation-llm-context-html.test.ts | 可見資料的整則HTML及嚴格解碼/還原 |
| functions/src/translation-llm-context-meaning.ts、translation-llm-context-meaning.test.ts | 包裝、禁止、價格及付款關係的有限正反例守門 |
| functions/src/translation-llm-context-adapter.test.ts | 公開adapter的段落、公斤、資料毀損、私隱與重試注入驗證 |
| functions/scripts/smoke-tllm-context-quantity.mjs | 每次最多8案的結構smoke |
| functions/scripts/evaluate-tllm-context-quantity.mjs | 固定合成集、候選SHA、低頻完整證據及同候選續跑 |
| functions/evaluation/context-quantity-dataset-lock.json | 舊資料集SHA固定 |
| functions/evaluation/synthetic-context-quantity-controls.json | 已知失敗的合成正反對照 |
| functions/evaluation/tllm-context-quantity-review.json | 全文、rubric、原始attempts、逐句審閱及失敗前後證據 |
| docs/TranslationLLM上下文與數量改進工作項目.md | Planner契約，僅更新完成階段與證據；AC不變 |
| docs/TranslationLLM上下文與數量實作驗證.md | 本報告及限制 |
| docs/系統規則與知識總覽.md、原文直送翻譯比較評估.md、專案日誌.md | 更新本機開發/測試狀態，保留歷史結果與正式版本 |

最終檢查：7個來源與編譯模組SHA仍與API凍結值相同；419筆輸出的來源換行序列與UTF-16提及ranges機械核對無誤；UTF-8無BOM、CRLF、行尾空白與本次文件連結檢查通過；git diff --check通過。評估腳本Node22語法檢查通過。這些檢查不取代獨立Verifier。
