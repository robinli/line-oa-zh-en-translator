# DEV 品質候選 2026-09-30

本目錄為未啟用的本機評估資料；不是雲端 glossary，也不改 runtime 的 zh-en-v12／en-zh-v9 或隔離白名單。

- synthetic-cases.json：40 筆合成題目及語意 rubric，沒有真人對話；前 12 筆為初期高風險正反案例，後續加入保護交界。這是已見開發集，不能算 verifier 未見集。
- zh-en-candidate.tsv：沿用 v12 的 17 項，加 12 項明確詞組，共 29 項。
- en-zh-candidate.tsv：沿用 v9 的 32 項，加 7 項明確詞組，共 39 項。
- 大小寫、長詞組優先序、HTML occurrence 保護與 glossary 命中需真 API 驗證，不能由 TSV 檔案存在宣稱改善。
- 刻意不加入單獨 container、balance、call、tax number、Fine 或櫃門；各自多義反例見 cases。

目前字元基準是既有建置 v21 加 v12/v9 的離線 mock capture：39 個擬議請求、2,654 個 contents 碼點，US$20／百萬輸入字元下約 US$0.05308，實際新增翻譯 API 呼叫 0。完整 wire 及來源基準只存 .local/dev-improvement-20260930/；候選改動後須重新產生並納入 verifier 未見集，再提供付費評估 manifest。

啟用前必須核對 DEV 專案、目前 glossary 名稱與 hash，建立新的不可變雲端資源及 provenance；不可直接改舊檔或繞過 nmt-isolation／nmt-local-guard。付費 API、部署與真人訊息測試分開授權。13 筆歷史中英問題、既有 v21 未解控制與兩筆中越問題的完整狀態以開發計畫及評估報告為準；本目錄不代表任何品質放行。
候選審查補充：『稅則』也可能指整套 tariff schedule，因此本機候選收窄為『海關稅則號碼／稅則編號』，不全域把稅則改成代碼；整套稅則／tariff schedule 的多義反例另見 terminology-counterexamples.json；DEVQ-01 原題明確包含『海關稅號與稅則號列』，仍須保留分類代碼／稅則號列，不能把它放寬成整套制度或納稅人識別號，原始 40 案與 rubric 不回寫。新增相鄰反例記於 terminology-counterexamples.json；尚未加入原 39 請求的費用估算，最終 manifest 必須一併納入。

另以合成 wire 核對『問 AI』沒有被保護 token 切開，加入問／詢問 AI 的有空白與無空白 4 個候選（新增詞組共 19 個）；長詞／短詞交界與『研究 AI』反例必須真 API 驗證，不宣稱已改善歷史第 102 筆。開發集仍為原 40 案，額外術語控制共 6 案，需納入後續新 manifest。

最終本機候選為 nmt-glossary-v22／nmt-confirmation-core-v1，限縮功能已獨立驗證，整體品質未放行。精確付費提案現為 73 案（原 40＋6 術語＋18 verifier＋8 相鄰＋BR2-S4），每組去重後 65 請求／4,352 碼點，現行與候選詞表兩組最多 130 請求／8,704 碼點，估算 NMT US$0.17408、提議翻譯上限 US$0.20，零自動重試；上文 39／2,654 是歷史基準。候選 TSV 仍未建立為雲端資源、未啟用、未經真 API 品質驗證。詳 [完整處置與限制](../../../docs/DEV中英品質候選與未解項目.md)。
