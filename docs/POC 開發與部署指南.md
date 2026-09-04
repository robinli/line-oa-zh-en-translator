# POC 開發與部署指南

## 已完成內容

- Firebase Functions 第 2 代 TypeScript 專案，執行環境為 Node.js 22、區域為 `asia-east1`。
- 使用 LINE SDK 驗證未修改的 Webhook raw body 與 `x-line-signature`。
- 群組必須先由授權者輸入 `/啟用翻譯`，才處理中文／中英混合文字與 LINE 語音；停用後兩項功能都停止。
- 一對一聊天室只支援 `/我的ID`；一般文字、語音及其他訊息均不處理。
- 呼叫 Cloud Translation Advanced API v3，指定 `zh-TW` 翻譯為 `en`。
- 呼叫 Cloud Speech-to-Text API v2，將 LINE 的 MP3／M4A 語音辨識為繁體中文或英文逐字稿。
- 使用 LINE Reply API 將英文翻譯回覆至原群組。
- 使用 Cloud Firestore 以 `groupId` 儲存群組啟用狀態，預設未啟用。
- 只允許 `LINE_OWNER_USER_ID` 指定的 LINE 帳號在群組執行 `/啟用翻譯` 與 `/停用翻譯`，並提供 `/翻譯狀態` 查詢。
- 預設 2,000 字元長度限制，以及不包含訊息本文或 Secret 的結構化日誌。
- 4 個測試檔共 60 項自動化測試通過，包含私訊取得 userId、忽略一對一語音、群組啟停授權、未啟用群組不處理語音、Firestore、Google Translation、Speech-to-Text 與 LINE SDK request 合約測試，TypeScript 型別檢查與正式建置通過。
- 提供 `npm.cmd run verify` 部署前驗證命令，Firebase predeploy 亦會自動執行，任何檢查失敗即停止部署。

## 正式環境驗收結果

- 驗收日期：2026-08-12
- 驗收狀態：✅ 通過
- 正式 `lineWebhook` 已部署至 `asia-east1`。
- Cloud Firestore 預設 database 與 Function 服務帳號權限已完成。
- `LINE_OWNER_USER_ID` 正式 Secret 已生效。
- 授權者已確認 `/啟用翻譯`、中文翻譯與 `/停用翻譯` 流程正常。
- 2026-09-04 群組語音功能程式與自動化測試已完成；正式環境仍需重新部署並執行群組語音人工驗收。

## 外部設定清單

以下正式 LINE、Firebase 與 Google Cloud 設定均已完成：

1. ✅ 確認測試群組沒有其他 LINE OA。
2. ✅ 建立 LINE Messaging API Channel 並開啟「Allow bot to join group chats」。
3. ✅ 建立 Firebase／Google Cloud 專案、啟用 Blaze Plan、Cloud Translation API 與 Cloud Speech-to-Text API。
4. ✅ 設定 Budget、Billing Alert，並授予 Function 服務帳戶 `roles/cloudtranslate.user`、`roles/speech.client` 與 `roles/datastore.user`。
5. ✅ 取得唯一授權帳號的 LINE `userId` 並建立 Secret。
6. ✅ 建立 Cloud Firestore、部署 Function、設定 Webhook URL 並完成群組端對端驗收。

## 安裝與驗證

在專案根目錄執行：

```powershell
npm.cmd install --prefix functions
npm.cmd run verify
```

目前驗證基準：

```text
Test Files  4 passed (4)
Tests       62 passed (62)
TypeScript  check passed
Build       passed
Predeploy   verification passed
```

## Firebase 專案設定

1. 複製 `.firebaserc.example` 為 `.firebaserc`，將 `your-firebase-project-id` 改為實際專案 ID。
2. 確認專案已啟用 Cloud Translation API、Cloud Speech-to-Text API 與 Billing，並在 Firebase Console 建立預設 Cloud Firestore database（Native mode）。
3. 建立 `line-translator-runtime@line-auto-translate-bot.iam.gserviceaccount.com` 專用執行服務帳戶，授予 Cloud Translation API User（`roles/cloudtranslate.user`）、Cloud Speech Client（`roles/speech.client`）與 Cloud Datastore User（`roles/datastore.user`）；程式已明確指定使用此帳戶。
4. 建立三個 Secret；第一次設定 `LINE_OWNER_USER_ID` 時可先填入無效暫用值 `NOT_CONFIGURED`：

   ```powershell
   firebase.cmd functions:secrets:set LINE_CHANNEL_SECRET
   firebase.cmd functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
   firebase.cmd functions:secrets:set LINE_OWNER_USER_ID
   ```

5. 部署取得 ID 用的 Function：

   ```powershell
   firebase.cmd deploy --only functions:lineWebhook
   ```

6. 將部署輸出的 HTTPS URL 設為 LINE Webhook URL，按下 Verify 後啟用 Webhook。
7. 用授權帳號一對一私訊 OA `/我的ID`，複製回覆的 `source.userId`。這個 ID 不是顯示名稱、LINE ID 或 OA ID。
8. 重新執行下列指令，將 `LINE_OWNER_USER_ID` 更新為真實 ID：

   ```powershell
   firebase.cmd functions:secrets:set LINE_OWNER_USER_ID
   ```

9. 再部署一次 Function，使新 Secret 版本生效。

## 群組指令

| 指令 | 可執行者 | 作用 |
|---|---|---|
| `/啟用翻譯` | `LINE_OWNER_USER_ID` 指定的帳號 | 同時啟用當前群組的文字翻譯與語音轉文字 |
| `/停用翻譯` | `LINE_OWNER_USER_ID` 指定的帳號 | 同時停用當前群組的文字翻譯與語音轉文字 |
| `/翻譯狀態` | 任何群組成員 | 查詢當前群組的啟用狀態 |

指令前後可有空白，但指令文字必須完全相同。未授權成員輸入啟用或停用指令時，Bot 會回覆無權限，Firestore 狀態不會改變。

群組剛加入時預設未啟用。未啟用或停用狀態下，中文文字不翻譯，語音也不下載、不轉文字；只有成功執行 `/啟用翻譯` 後，兩項功能才會開始。

`/我的ID` 是一對一私訊指令，只會將發送者自己的 LINE `userId` 回覆給發送者；在群組中輸入時不會回覆 ID。

## 本機 Emulator

1. 複製 `functions/.secret.local.example` 為 `functions/.secret.local` 並填入測試用 LINE 憑證與 `LINE_OWNER_USER_ID`。
2. 依 Google Cloud 官方方式設定 Application Default Credentials，確保本機可呼叫 Translation 與 Speech-to-Text API。
3. 先建置再啟動 Functions Emulator：

   ```powershell
   npm.cmd run build --prefix functions
   firebase.cmd emulators:start --only functions
   ```

實際 Secret、`.env*` 及服務帳戶 JSON 金鑰不得提交版本庫。

## 端對端驗收案例

| 案例 | 輸入 | 預期結果 |
|---|---|---|
| OA 加入新群組 | 邀請 OA | Bot 說明尚未啟用與啟用指令 |
| 未啟用的中文 | `明天下午三點跟客戶開會。` | Bot 不回覆，不呼叫翻譯 API |
| 未啟用的群組語音 | 傳送 59 秒內的 LINE 語音 | Bot 不回覆，不下載音訊、不呼叫 Speech-to-Text API |
| 授權者啟用 | `/啟用翻譯` | Bot 回覆已啟用，Firestore 狀態為 `enabled: true` |
| 非授權者啟用 | `/啟用翻譯` | Bot 回覆無權限，狀態不變 |
| 已啟用的中文 | `明天下午三點跟客戶開會。` | Bot 回覆英文翻譯 |
| 中英混合 | `請 review 這份報告。` | Bot 回覆整句英文翻譯 |
| 純英文 | `Please review the report.` | Bot 不回覆 |
| 已啟用的中文語音 | 傳送中文 LINE 語音 | Bot 回覆中文逐字稿與英文翻譯 |
| 已啟用的非中文語音 | 傳送英文 LINE 語音 | Bot 只回覆逐字稿 |
| 不支援的非文字 | 圖片、貼圖、影片或檔案 | Bot 不回覆 |
| 一對一文字 | 對 OA 傳送一般中文文字 | Bot 不回覆 |
| 一對一語音 | 對 OA 傳送 LINE 語音 | Bot 不回覆，不下載音訊、不呼叫 Speech-to-Text API |
| 超長訊息 | 超過設定的 `MAX_MESSAGE_LENGTH` | Bot 不翻譯，日誌記錄長度超限 |
| 無效簽章 | 偽造 Webhook request | 回傳 401，不呼叫外部 API |
| Translation API 錯誤 | 暫時停用或權限不足 | 記錄安全錯誤，Webhook 回傳 200，避免重送造成重複回覆 |
| Speech-to-Text API 錯誤 | 暫時停用或權限不足 | 記錄安全錯誤，Webhook 回傳 200，避免重送造成重複回覆 |
| 授權者停用 | `/停用翻譯` | Bot 回覆已停用，之後文字與語音都不處理 |

## 第一版限制

- 不處理圖片文字、影片與檔案內容。
- 語音採同步辨識，只接受 LINE 託管、59 秒內且不超過 10 MB 的音訊；外部來源音訊不處理。
- Firestore 只保存群組啟用狀態與最後變更審計欄位，不保存訊息本文或翻譯紀錄。
- LINE Messaging API 不提供可靠的群組管理員身分判斷，因此使用預先設定的單一 `source.userId` 授權。
- 專有名詞尚未建立 glossary，翻譯正確性需在 POC 驗收時確認。
- 單筆外部 API 失敗只記錄日誌，不主動在群組發送錯誤訊息。
- `npm audit --omit=dev` 目前回報 7 個中度弱點，來源為 `firebase-functions` 間接依賴的 `firebase-admin`／Cloud Storage 舊版 `uuid` 鏈；本專案不呼叫受影響的 UUID v3／v5／v6 buffer API，且不使用 Cloud Storage，後續仍應隨官方相依套件更新持續追蹤。

