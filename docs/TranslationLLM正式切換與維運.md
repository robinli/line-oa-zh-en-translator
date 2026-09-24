# Translation LLM 正式切換與維運

2026-09-23 已完成同一個 LINE OA／lineWebhook 的引擎切換，當時版本 linewebhook-00016-xuc 為 ACTIVE、承接 100% 流量；Webhook URL 不變。

## 正式設定

| 項目 | 設定 |
|---|---|
| 中英三模式 | Translation LLM，general/translation-llm |
| 中越 zh-vi | Google Translate general/nmt，不載入商務規則 |
| TRANSLATION_ENGINE | translation-llm |
| TRANSLATION_LLM_LOCATION | us-central1 |
| TRANSLATION_LLM_GLOSSARY_ZH_EN | trade-zh-en-v8 |
| TRANSLATION_LLM_GLOSSARY_EN_ZH | trade-en-zh-v8 |
| Gemini 回復設定 | TRANSLATION_MODEL=gemini-3.5-flash、TRANSLATION_LOCATION=global 保留 |
| 執行資源 | asia-east1、Node.js 22、256 MiB、60 秒、maxInstances 5 |

中英 TLLM 使用獨立的區域與 glossary 參數，不把 Gemini 的 global 端點帶入 Cloud Translation。程式無參數時的 engine 預設仍為 business，正式私密 .env 明確選定 translation-llm，不能以程式預設推斷目前引擎。

維持原 LINE Secrets、Firestore lineTranslationGroups、既有模式和語音開關、Wei bro／Wei brother 對應；未批次改寫正式聊天室。/翻譯設定 顯示指令；/中英翻譯、/中越翻譯、/中翻英、/英翻中 決定後續處理。只切換文字模式不重設語音。

## 驗證與範圍

- Node.js 22.23.2：461 項自動化測試、TypeScript 型別檢查、建置及 Firebase predeploy 通過。
- v12 候選：280 則回歸 272 可用，8 則拒絕；凍結後新增 20 則獨立案例三輪 60/60 可用，完整審閱未見未攔截的重大錯誤，達到此輪接入門檻。小樣本不是正式準確率，仍可能有文法、空格或未涵蓋語意問題。
- 正式 15 項檢查通過：簽章、無效簽章、簡短回覆略過、單向略過、中英雙向、中越雙向、原生提及、私訊模式切換與語音開關保留、20 提及長文、3 個併發合成請求。
- 10 個需要回覆的合成事件都用無效 replyToken；按事件 ID 核對後台錯誤確為 LINE reply could not be delivered，證明已通過翻譯階段，而不是只看 HTTP 200。中英雙向同時驗證 runtime 身分可使用 v8 glossary。
- 4 份虛構聊天室設定建立時禁止覆寫，清理時驗證自有標記與 updateTime；全部已刪除。未修改真人聊天室，未發送真人測試訊息，未擴充 IAM。
- 原先 service-account impersonation 缺少 getAccessToken 權限；後續改以已部署 Function 的真正 runtime 呼叫完成驗證，沒有為測試授予 TokenCreator。

[品質證據](../functions/evaluation/tllm-v12-release-review.json)；[正式驗證摘要](../functions/evaluation/tllm-deployment-verification.json)。完整合成原始 API 紀錄與私密部署備份在 Git 忽略的 .local/，不能假設新 checkout 會有這些檔案。

使用端 LINE 手機顯示及通知尚未由真人驗收；本次不聲稱已驗收。語音共用文字路由已由整合測試驗證，沒有向真人發送語音測試。短時間 3 請求併發也不是長期 SLA 或極限負载保證。

## 失敗與觀測

Translation LLM request completed 日誌只含引擎、方向、嘗試次數、耗時、字元數、結果與有限錯誤代碼，不含原文、譯文、原生身分或金鑰。服務錯誤不在翻譯器內重試；品質錯誤最多重試一次，每次 15 秒。仍不通過就靜默不回覆，不自動改用 Gemini 或 NMT。

查看 Translation LLM 的 quality_rejected 與 service_error 分開排查；成功之後仍可能遇 LINE 回覆失敗。LINE webhook 最終 HTTP 200 只表示已處理事件集合，不代表每則翻譯成功。

## 回復與後續部署

本次備份 .local/deploy-tllm-20260923-220409/ 保存原第 15 版 Function、Cloud Run、revision、私密參數及候選來源；部署前確認舊映像 digest 在 Artifact Registry 可讀。未為測試實際切回舊流量。

保留目前程式的中越 NMT 路由時，將 Git 忽略的 functions/.env.line-auto-translate-bot 中 TRANSLATION_ENGINE 改為 business，保持 TRANSLATION_MODEL=gemini-3.5-flash 與 TRANSLATION_LOCATION=global，再依總覽驗證和部署 lineWebhook。不需要更換 LINE OA、Webhook URL、Secret 或聊天室資料。

緊急改回第 15 版流量會連同舊路由一起回復，不能把它誤稱仍保留新中越 NMT。舊映像受既有清理政策影響，操作當下須再確認可用性；備份 revision 記錄不是永久映像保證。

## 2026-09-24 指令整理部署

該次部署版本 linewebhook-00017-dun 已核對 ACTIVE、100% 流量。移除 /啟用翻譯、/停用翻譯、/翻譯狀態，群組與私訊直接忽略；/翻譯設定 顯示模式、文字／語音開關，以及四種模式、四個啟停指令與 /我的ID（僅私訊有效）。

- Node.js 22.23.2：463 項測試、型別檢查、建置及 Firebase predeploy 通過。
- 8 項正式檢查通過：有效空事件、無效簽章，以及群組／私訊三個舊指令（含前後空白）均 ignored=1、failed=0。
- 已比對原環境參數、別名、Secret 綁定、執行帳號、Webhook URL、記憶體、逾時與實例上限維持不變，未修改聊天室資料或發送真人訊息。
- 指令清單內容由自動化測試確認；LINE 手機端顯示留待使用者操作確認。
- 私密備份及驗證記錄：.local/deploy-commands-20260924-090624；內含更新前／後 Function 與流量、原參數、候選來源及 verification-results.json。

## 2026-09-24 私訊僅限我的ID

目前正式版本 linewebhook-00018-huk，ACTIVE 且承接 100% 流量。一對一私訊只回覆 `/我的ID`（容許前後空白），其餘文字、指令、語音與媒體一律 ignored，不讀寫設定、不下載或辨識音訊、不呼叫翻譯。原私訊設定保留但不使用；群組翻譯、設定、權限及提及維持。

- Node.js 22.23.2：462 項測試、型別檢查、建置及 Firebase predeploy 通過。取代已移除私訊功能的旧測試並補上略過與批次處理測試。
- 10 項正式檢查：有效空事件、無效簽章、私訊 12 個設定指令、5 則一般文字、2 則語音（含超長）、4 類媒體、私訊 /我的ID、群組 /我的ID、群組三個舊指令、群組 /翻譯設定。
- 私訊 /我的ID 與群組 /翻譯設定 使用刻意無效 replyToken；回傳 failed=1 符合測試預期，兩筆事件日誌均確認為 LINE reply could not be delivered，證明有執行回覆階段。未發真人訊息，手機端實際顯示待使用者確認。
- 正式環境參數、Secret 綁定、執行帳號、URL、記憶體、逾時及實例上限均與更新前一致，未修改正式聊天室設定。
- 備份與驗證：.local/deploy-private-id-20260924-092528，包含原參數、更新前／後 Function 和流量、candidate-src、verification-results.json 及 reply-path-verification.json。
