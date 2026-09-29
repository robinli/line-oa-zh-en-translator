# Action Plan 翻譯拒絕：診斷與離線重現

2026-09-29，依使用者「先做診斷與離線重現」要求完成；本次沒有修改應用程式、放寬品質規則、部署、呼叫翻譯 API 或發送 LINE 訊息。

## 已確認的歷史事件

- 事件時間：2026-09-28 12:07:36.038（Asia/Taipei）。
- DEV revision：`linewebhook-00006-wol`；模式 `zh-en`，實際方向 `en:zh-TW`。
- NMT 已回傳結果，安全診斷為 `quality_rejected / quantity_unit_or_content_changed`；翻譯階段失敗後成功回覆 🚧。
- 同一 Cloud Logging trace 的 NMT 指標：attempt 1、耗時 1,972 ms、輸入 1,005 Unicode code points、輸出 846；Firestore 的 reason 只有 `quality_rejected`。
- 歷史候選譯文未保存，無法逐字重播當時的 NMT 回應；原生 mention metadata 也未保存。

上述時間、方向與代碼來自本次對話前段的唯讀 Firestore／Cloud Logging 查詢；此次僅再讀取已定位的單一事件原文供離線重現。未匯出其他對話、身分 ID 或憑證。

## 重現方法與來源

使用 `.local/quality-recording-20260926/deploy/functions/lib/` 的已部署封裝，載入的 5 個模組逐一核對當時的 `deployed-source-comparison.json` SHA-256；未修改封裝檔案。

先用使用者貼文建立案例，再核對已保存原文：貼文為 364 UTF-16 code units，歷史原文為 357，差異在提及顯示名稱與末尾空白／換行。以歷史原文及三處行尾提及重建範圍後，編碼內容為 1,005 code points，與歷史指標相符。字數相符不能證明原始 metadata 或請求逐 byte 一致。

診斷腳本只在記憶體中替兩個拋錯位置附加「階段、行號、來源項目、回傳項目、可比對候選」；每個案例同時執行未修改的原版及診斷版，確認判斷一致。腳本拒絕載入部署模組之外的依賴（僅准用必要的 crypto），並阻擋 fetch；不載入翻譯服務、SDK 或 webhook。

所有回應案例都是手工合成，明確標記為非歷史 NMT 回應；測試範圍是 HTML 解碼、內容驗證與還原，不代表整套翻譯服務的端對端品質通過。

## 已定位的檢查機制

1. `28/09/26` 被歸為 `formula-or-date`，但不符合四位數年開頭的日期格式，因此送往模型時保留為普通明文，沒有禁止翻譯的 span。
2. 還原器只接受原日期字串及運算符兩側空白變體；`28 / 09 / 26` 可還原，`2026年9月28日`、`2026-09-28`、`28/9/26` 不可還原。
3. 未還原的數字／日期進入後續內容掃描。第一行沒有可用的 visible 候選；即使只是同一天的格式改寫，也會拋出 `quantity_unit_or_content_changed`。
4. 因此「日期明文允許改寫」與「還原只接受有限字面形式」存在相容缺口。這是已重現的拒絕機制，仍不能斷言就是歷史事件的唯一觸發原因。

相關原始碼：[日期傳輸與還原](../functions/src/nmt-protection.ts)、[HTML 解碼與回傳內容掃描](../functions/src/nmt-context-html.ts)、[數值與日期辨識](../functions/src/nmt-context.ts)。

## 離線結果

15 個案例均符合事先列出的原版預期結果；「通過測試」包括正確重現預期拒絕，並不表示 15 則譯文都被放行。原版與診斷版的結果全部一致，另確認 LF／CRLF 往返還原（原版會去除首尾空白）。

| 合成情境 | 結果 | 診斷位置 |
|---|---|---|
| 原文往返、中文敘述且保留日期、日期斜線兩側空白 | 放行 | — |
| 日期改為中文年月日、ISO、去掉月份前導零 | 與歷史相同代碼拒絕 | 第 1 行 |
| 日期刻意改錯一天 | 與歷史相同代碼拒絕 | 第 1 行 |
| 日期遺漏 | `exact_occurrence_changed` | 未還原項目 |
| 百分比加入空白、改全形、刻意改錯數字 | `quantity_content_changed` | 第 5 行 |
| 百分比遺漏 | `exact_occurrence_changed` | 未還原項目 |
| 星期二寫成「星期2」 | 與歷史相同代碼拒絕 | 第 7 行 |
| 新增無來源數字 | 與歷史相同代碼拒絕 | 第 1 行 |
| 原生提及改名 | `exact_occurrence_changed` | 第 8 行 |

同一錯誤代碼也能由星期數字化或新增數字觸發；不能用錯誤代碼相同證明歷史輸出。百分比在受保護 span 內的空白變化會得到另一個代碼，但不排除其他百分比或標記損壞形式。

## 證據與重跑

私密來源與合成案例只在 Git 忽略目錄 `.local/action-plan-diagnostic-20260929/`：

- `historical-source.json`：已保存的單則原文，不含歷史候選譯文或身分 ID。
- `diagnose.cjs`：可重跑的離線診斷。
- `results.json`：來源雜湊、部署模組雜湊、限制及 15 項結果。
- `synthetic-responses.json`：明確標示來源的合成回應。
- `verification.md`：獨立 verifier 已放行；重跑 15 案、另加 8 個獨立正反／邊界案例，5 個載入模組另與保存部署 ZIP 及 SHA manifest 一致，無待修 findings。

於專案根目錄執行 `node .local/action-plan-diagnostic-20260929/diagnose.cjs`；需要上述既有部署證據及來源檔案，不需要憑證或網路。本輪 Node.js v24.18.0；此腳本未載入 SDK，並非使用部署 runtime 的端對端測試。

下一步若要修正，可針對「日期保護與等價還原一致性」設計正反案例，另處理星期及百分比格式相容性；本次只交付診斷，不修改這些品質規則。歷史根因仍因缺少候選譯文而未能唯一確認。
