# POC 開發工作項目

依據《LINE 群組中英自動翻譯機器人－技術選型報告》整理。

- 文件更新日期：2026-08-12（核心程式第一版）
- 狀態定義：⬜ 未開始／🟡 進行中／⏸️ 阻塞／✅ 已完成
- POC 目標：LINE OA 收到群組中的中文文字後，透過 Google Cloud Translation API 翻譯成英文，並回覆至原群組。

## 工作項目

| 編號 | 工作項目 | 狀態 | 完成條件 |
|---|---|---|---|
| POC-01 | 確認測試用 LINE 群組可加入 LINE OA，且群組內沒有其他 LINE OA | ✅ 已完成 | 翻譯 OA 已成功加入指定測試群組 |
| POC-02 | 建立或確認 LINE Official Account 與 Messaging API Channel | ✅ 已完成 | LINE OA 與 Messaging API Channel 已建立，Channel Secret 與 Access Token 已安全設定 |
| POC-03 | 在 LINE Developers Console 開啟「Allow bot to join group chats」 | ✅ 已完成 | Bot 已成功被邀請並加入測試群組 |
| POC-04 | 建立 Firebase／Google Cloud 專案並啟用 Billing（Blaze Plan） | ✅ 已完成 | Firebase 專案 `line-auto-translate-bot` 已建立並啟用 Blaze Plan |
| POC-05 | 啟用 Google Cloud Translation API，設定 Billing Budget 與 Billing Alert | ✅ 已完成 | Cloud Translation API、Billing Budget 與 Billing Alert 均已啟用 |
| POC-06 | 初始化 Firebase Functions 專案與本機開發環境 | ✅ 已完成 | Functions 可在本機建置並啟動測試 |
| POC-07 | 設定 LINE 與 Google Cloud 所需 Secret，避免憑證寫入原始碼 | ✅ 已完成 | LINE Channel Secret 與 Access Token 已存入 Firebase Secret Manager，Google Cloud 使用專用執行身分 |
| POC-08 | 建立 LINE Webhook HTTP 端點 | ✅ 已完成 | `lineWebhook` 可接收 POST request，空事件驗證請求回傳 200 |
| POC-09 | 實作 LINE Webhook signature 驗證 | ✅ 已完成 | 使用未修改的 raw body 與 LINE SDK 驗證簽章，無效簽章回傳 401 |
| POC-10 | 解析 Webhook event 並只接受群組文字訊息 | ✅ 已完成 | 圖片、貼圖、影片、音訊、檔案、系統事件及一對一訊息均被忽略 |
| POC-11 | 實作中文內容判斷與訊息長度限制 | ✅ 已完成 | 中文及中英混合文字進入翻譯流程，純英文不處理，預設上限為 2,000 字元 |
| POC-12 | 串接 Google Cloud Translation API（繁體中文翻譯為英文） | ✅ 已完成 | Translation API v3 已在真實雲端環境成功將群組中文翻譯為英文 |
| POC-13 | 串接 LINE Reply API，將英文翻譯回覆至原群組 | ✅ 已完成 | LINE Reply API 已使用真實 reply token 成功回覆原群組 |
| POC-14 | 加入錯誤處理與結構化 logging，且日誌不洩漏 Secret | ✅ 已完成 | 日誌僅記錄事件 ID、統計與安全錯誤訊息，不記錄訊息本文或 Secret |
| POC-15 | 撰寫核心邏輯自動化測試 | ✅ 已完成 | 4 個測試檔共 23 項測試通過，涵蓋簽章、過濾、長度、外部 SDK request、成功與失敗流程 |
| POC-16 | 部署 Firebase Function 並將正式 Webhook URL 設定至 LINE | ✅ 已完成 | `lineWebhook` 已部署至 `asia-east1`，LINE Webhook Verify 成功且 Use webhook 已開啟 |
| POC-17 | 執行 LINE 群組端對端測試 | ✅ 已完成 | 中文與中英混合訊息成功翻譯回覆，純英文與非文字訊息被忽略，日誌均為 failed: 0 |
| POC-18 | 驗證成本與安全設定 | ✅ 已完成 | 預算告警、Secret Manager、最小權限服務帳戶、訊息限制、1 天映像清理政策與安全日誌均已驗證 |
| POC-19 | 整理 POC 操作、部署、測試結果與已知限制 | ✅ 已完成 | README 與 POC 開發部署指南已記錄操作、部署、測試結果及第一版限制 |
| POC-20 | POC 驗收與是否進入 MVP 的決策 | ⬜ 未開始 | 利害關係人確認功能、穩定性、成本與限制，並留下決策結果 |

## POC 驗收標準

- LINE OA 可加入指定測試群組。
- 群組成員輸入中文或中英混合文字時，Bot 能回覆英文翻譯。
- 純英文與非文字訊息不觸發翻譯。
- Webhook signature 驗證有效，Secret 未寫入原始碼或日誌。
- Translation API 或 LINE API 失敗時，有可追查的錯誤日誌且服務不會無限重試。
- Firebase Function 部署後可穩定運作，並已設定預算與帳務告警。

## 開發交付狀態

部署前可完成的程式開發已完成；執行 `npm.cmd run verify` 會一次完成型別檢查、23 項測試與正式建置，Firebase 部署前也會自動執行相同檢查。

POC-07、POC-12 與 POC-13 保持進行中，是因其完成條件包含真實 Firebase／Google Cloud／LINE 環境驗證；程式碼與 mock 合約測試均已完成，待部署時驗證後即可標示完成。

