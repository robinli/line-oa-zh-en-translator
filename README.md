# LINE 文字翻譯與語音轉文字機器人

> **目前正式（2026-09-25）：** 依使用者要求，未修改程式而完整部署回 9/21 Git 版本 `0b4ec83`，新 revision 為 `linewebhook-00019-hid`（ACTIVE、100% 流量），中英／中越均使用 NMT；包含當時私訊與舊指令。121 項測試、獨立離線驗證及 4 項基本連線檢查通過。主工作區新程式保留，部署來源為 `.local/rollback-20260925-to-0921/source`；下文新功能說明不代表目前正式行為，詳見 [回復紀錄](docs/正式區回復0921版本與NMT.md)。

> 2026-09-24 已部署 linewebhook-00018-huk，100% 流量；一對一私訊僅 `/我的ID`，群組功能維持。462 項 Node 22 測試及 10 項正式檢查通過，詳見 [正式切換與維運](docs/TranslationLLM正式切換與維運.md)。

> **開始新工作前必讀：** [系統規則與知識總覽](docs/系統規則與知識總覽.md)。本專案規則、商務知識、實作索引、設定與部署注意事項以此為統一入口；修改前先完整閱讀，變更時同步維護。

本儲存庫使用同一個 LINE OA／lineWebhook，依群組模式選擇不同翻譯程序；文字與語音各自啟停。一對一私訊僅回覆 `/我的ID`，其餘指令、文字與語音一律忽略。

| 程序 | 模式 | 正式引擎 |
|---|---|---|
| 中越 | zh-vi | Google Translate NMT，不套用商務規則 |
| 中英 | zh-to-en／en-to-zh／zh-en | Translation LLM＋v8 商務術語與驗證 |

單一入口已正式部署；原 LINE Secrets 與群組設定沿用，指令依下表。Gemini 保留為明確指定的回復選項，不自動備援。開發沿革見 [持續轉換進度](docs/TranslationLLM持續轉換進度.md)。

文字整則只有 OK、Yes、No 時不翻譯、不回覆（忽略大小寫、全半形、前後空白與常見句尾標點）；含其他內容的句子仍依原有規則處理。此項 2026-09-23 已部署至 linewebhook-00015-poq，正式略過驗證通過。

## 技術組合

- Firebase Functions 第 2 代（Node.js 22／TypeScript）
- LINE Messaging API
- Google Cloud Translation API v3 Translation LLM（中英正式引擎，v8 glossary）
- Vertex AI Gemini（明確指定的回復選項）
- Google Cloud Translation API v3 NMT（同一入口的中越程序）
- Google Cloud Speech-to-Text API v2
- Cloud Firestore
- Vitest

## 本機開發

需求：Node.js 22、Firebase CLI，以及可用的 Firebase／Google Cloud 專案。

```powershell
npm.cmd install --prefix functions
npm.cmd run verify
```

`verify` 會依序執行 TypeScript 型別檢查、自動化測試與正式建置。Firebase 部署前也會執行相同檢查。

若要使用 Firebase Emulator，複製 `.firebaserc.example` 為 `.firebaserc` 並填入專案 ID，再複製 `functions/.secret.local.example` 為 `functions/.secret.local` 並填入測試憑證：

```powershell
firebase.cmd emulators:start --only functions
```

實際 Secret、`.env*` 與服務帳戶 JSON 金鑰不可提交。

## 雲端設定與部署

沿用 functions/、原 LINE Secrets、Firestore lineTranslationGroups 及既有 Webhook URL，不需要第二個 LINE 帳號或 Function。2026-09-23 已部署第 16 版；下列為正式操作流程，操作前依系統總覽核對版本、備份與驗收狀態。

1. 建立 Firebase 專案、啟用 Blaze Plan、Vertex AI API、Cloud Translation API、Cloud Speech-to-Text API，並建立預設 Cloud Firestore database。
2. 將 Firebase 專案 ID 寫入 `.firebaserc`。
3. 將 Function 服務帳戶授予 `roles/cloudtranslate.user`、`roles/speech.client` 與 `roles/datastore.user`，另授予只含 `aiplatform.endpoints.predict` 與 `serviceusage.services.use` 的自訂角色供 Gemini 回復使用；詳見 [商務翻譯優化](docs/商務翻譯優化.md)。
4. 設定 LINE Secret：

   ```powershell
   firebase.cmd functions:secrets:set LINE_CHANNEL_SECRET
   firebase.cmd functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
   firebase.cmd functions:secrets:set LINE_OWNER_USER_ID
   ```

5. 依 [正式設定](docs/TranslationLLM正式切換與維運.md) 設定 translation-llm 與 us-central1 的 v8 glossary；新專案需先建立相同版本的術語資源，不能只複製資源名稱。驗證並部署：

   ```powershell
   npm.cmd run verify
   firebase.cmd deploy --only functions:lineWebhook
   ```

6. 將 `lineWebhook` URL 設為 LINE Webhook URL，啟用 Webhook，並開啟「Allow bot to join group chats」。

## 翻譯指令

群組提供下列翻譯與設定指令；`/我的ID` 僅限私訊。群組 `/翻譯設定` 顯示狀態與操作清單，選擇模式後，後續文字與語音翻譯交由對應程序。

| 指令 | 功能 |
|---|---|
| `/中翻英` | 中文→英文，啟用文字翻譯 |
| `/英翻中` | 英文→繁體中文，啟用文字翻譯 |
| `/中英翻譯` | 中文↔英文，啟用文字翻譯 |
| `/中越翻譯` | 中文↔越南文，啟用文字翻譯 |
| `/啟用文字翻譯` | 依目前模式啟用文字翻譯 |
| `/停用文字翻譯` | 停用文字翻譯，保留模式 |
| `/啟用語音轉文字` | 啟用語音辨識；逐字稿依文字翻譯設定處理 |
| `/停用語音轉文字` | 停止下載、辨識及回覆語音 |
| `/翻譯設定` | 顯示狀態與操作指令 |
| `/我的ID` | 一對一私訊取得自己的 LINE userId |

選擇模式會啟用文字翻譯，但不變更語音開關；任一開關也不變更另一個開關。新聊天室兩項功能預設關閉。

指令前後可以有空白，但指令文字必須完全相同。

群組只有 `LINE_OWNER_USER_ID` 指定的帳號能選擇模式、啟用或停用；任何群組成員都能查詢狀態及設定說明。一對一私訊僅回覆 `/我的ID`；包括管理員在內，其餘訊息不回覆、不修改設定。

## 訊息處理規則

- 模式分別為 `zh-to-en`、`en-to-zh`、`zh-en`、`zh-vi`；沒有模式時使用中英雙向。
- 文字翻譯關閉時，不翻譯文字訊息，也不翻譯語音逐字稿。
- 單向模式忽略反方向的文字訊息。文字先排除原生 @ 顯示名稱；文字正文與語音逐字稿皆以含中文視為中文，否則含拉丁字母視為模式中的英文或越南文；語音逐字稿沒有原生 mention metadata。中英混合視為中文，英翻中模式不翻譯此類內容。
- 純數字、符號或 Emoji 不呼叫翻譯服務。
- 群組文字翻譯成功後，若譯文與原文相同（統一全半形相容字元、忽略首尾空白、合併連續空白與換行，並忽略常見標點兩側空白），不回覆並計為 ignored。仍先呼叫翻譯服務，不以英文字母或大寫判斷為代碼；相同譯文只記錄不含訊息內容的診斷日誌，以便排查翻譯異常。群組語音回覆維持原有行為；私訊不執行翻譯。
- 語音轉文字關閉時，不下載、不辨識、不回覆語音。
- 語音轉文字開啟時，先辨識逐字稿，再依文字翻譯開關及方向決定是否翻譯。符合條件回覆「逐字稿＋空行＋翻譯」，否則只回覆逐字稿。
- 語音辨識依模式使用繁體中文＋英文，或繁體中文＋越南文。逐字稿中的指令只作為內容，不執行設定變更。
- 群組使用原始 groupId，各群組設定獨立；歷史 user:{userId} 私訊設定保留但不再讀寫。
- Firestore collection 維持 `lineTranslationGroups`。新設定為 `textTranslationEnabled`、`audioTranscriptionEnabled`、`translationMode`、`changedBy`、`changedAt`。
- 舊文件的兩個開關若尚未存在，分別沿用舊 `enabled` 值；明確的 true／false 優先。新操作只 merge 更新指定開關，不修改舊 enabled，避免另一項功能的預設狀態被連動。
- 不保存訊息、音訊、逐字稿或翻譯結果。
- 語音採同步辨識，預設限制為 59 秒與 10 MB；可透過 `MAX_AUDIO_DURATION_MS`、`MAX_AUDIO_BYTES` 調低。
- 文字與逐字稿預設限制為 2,000 個 JavaScript 字元，可透過 `MAX_MESSAGE_LENGTH` 調整。
- 圖片、貼圖、影片、檔案及外部來源音訊不處理。
- 單筆設定、翻譯、語音辨識或 LINE 回覆失敗時會記錄安全日誌，Webhook 仍回傳 200，避免 redelivery 造成重複回覆。
- 翻譯服務失敗或譯文未通過驗證時，不回覆失敗提示、不發送未驗證譯文；保留後台錯誤紀錄並繼續處理其他訊息。

## 將 LINE OA 加入群組

![Auto Translate 使用說明](docs/Auto-Translate-使用說明.png)

1. 在 LINE Official Account Manager 將「接受邀請加入群組或多人聊天室」設為接受。
2. 邀請 LINE OA 加入目標群組。
3. 加入後可重新設為不接受，避免被加入未授權群組。
4. 由授權者先選擇翻譯模式，例如 /中翻英；需要語音辨識時另外輸入 /啟用語音轉文字。也可輸入 `/中英翻譯` 或 `/中越翻譯`。

## 測試與檢查

```powershell
npm.cmd run verify
```

自動化測試不會呼叫 LINE 或 Google Cloud，外部服務均使用 mock。目前共有 461 項測試（Node.js 22.23.2，2026-09-23）。

## 最近部署

2026-09-23 已部署 linewebhook-00016-xuc：同一入口中英 Translation LLM、中越 NMT，ACTIVE 且 100% 流量；461 項測試、15 項正式檢查和 runtime glossary 存取驗證通過，未向真人發送測試訊息。

2026-09-22 16:59（台灣時間）已部署 linewebhook-00014-yez，翻譯失敗或未通過驗證時改為靜默略過，只記錄後台錯誤；271 項測試、型別檢查與建置通過，正式流量已全部切換。正式檢查曾遇一次模型服務暫時失敗，針對該事件重試後通過，其餘檢查正常。

2026-09-22 16:50（台灣時間）已部署原生 @ 提及版 linewebhook-00013-tif，正式流量已全部切換，Wei bro／Wei brother 對應設定已確認；266 項測試及五項正式 webhook 檢查通過，未向群組發送測試通知。

2026-09-22 16:22（台灣時間）已部署商務翻譯優化，正式版本為 `linewebhook-00012-zeh`，狀態 ACTIVE 且承接全部流量；204 項自動化測試、型別檢查與建置通過，正式環境的有效／無效簽章、中文 @ 名稱方向判斷、模型呼叫與相同譯文不回覆均驗證通過；未向群組成員發送測試訊息。

2026-09-22 已部署群組文字相同譯文不回覆功能，正式服務版本為 `linewebhook-00011-new`，狀態 ACTIVE 且全部流量已切至新版本；134 項自動化測試、型別檢查與建置通過，正式 webhook 簽章空事件回傳 200、failed=0，未向群組發送測試訊息。

2026-09-14 已部署獨立文字／語音開關與四種翻譯模式，正式服務版本為 `linewebhook-00010-vuz`。IN_TW 已設為中翻英，文字翻譯與語音轉文字均啟用；其餘群組設定未變。121 項自動化測試、型別檢查與建置通過，正式服務的簽章空事件與英文忽略測試均無失敗。未向群組發送測試訊息；真人語音辨識品質尚未人工驗收。

## 商務翻譯優化

新增多方貿易翻譯規則、數字與人名保護、術語驗證、品質失敗時靜默略過，以及 @ 中文名稱不影響正文語言的修正。詳細設定、限制、合成評估與部署前置條件見 [商務翻譯優化](docs/商務翻譯優化.md)。商務翻譯已於 2026-09-22 部署；原生 @ 提及亦已部署，詳見下方。

## 原生 @ 提及（已部署）

Wei bro 與 Wei brother 已對應到同一位已指定的 LINE 使用者；翻譯回覆也能保留原訊息的原生 @ 提及，送出前確認對方在目前群組，無法確認時保留純文字。仍遵守原翻譯方向與「相同譯文不回覆」規則。詳見 [LINE 原生提及](docs/LINE原生提及.md)。

Node 22 下 266 項測試與四組 LINE 官方訊息格式驗證通過，未向群組發送測試通知。原生提及初版 linewebhook-00013-tif 已完成正式設定、簽章、方向判斷、模型呼叫與位置還原驗證，目前正式版為 linewebhook-00014-yez；實際通知顯示仍待使用端驗收。

2026-09-24 指令調整：`/啟用翻譯`、`/停用翻譯`、`/翻譯狀態` 已移除，輸入時直接忽略，不改設定、不回覆、不翻譯；請在群組用 `/翻譯設定` 查詢目前狀態與操作指令（含僅限私訊的 `/我的ID`）。本次部署狀態見系統規則與知識總覽。
