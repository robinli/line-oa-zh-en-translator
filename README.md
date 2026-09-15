# LINE 文字翻譯與語音轉文字機器人

LINE OA 在群組與一對一聊天室支援中翻英、英翻中、中英雙向、中越雙向翻譯。文字翻譯與語音轉文字可分別啟停。語音先產生逐字稿，再依文字翻譯開關與所選方向決定是否附上翻譯。

## 技術組合

- Firebase Functions 第 2 代（Node.js 22／TypeScript）
- LINE Messaging API
- Google Cloud Translation API v3
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

1. 建立 Firebase 專案、啟用 Blaze Plan、Cloud Translation API、Cloud Speech-to-Text API，並建立預設 Cloud Firestore database。
2. 將 Firebase 專案 ID 寫入 `.firebaserc`。
3. 將 Function 服務帳戶授予 `roles/cloudtranslate.user`、`roles/speech.client` 與 `roles/datastore.user`。
4. 設定 LINE Secret：

   ```powershell
   firebase.cmd functions:secrets:set LINE_CHANNEL_SECRET
   firebase.cmd functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
   firebase.cmd functions:secrets:set LINE_OWNER_USER_ID
   ```

5. 驗證並部署：

   ```powershell
   npm.cmd run verify
   firebase.cmd deploy --only functions:lineWebhook
   ```

6. 將 `lineWebhook` URL 設為 LINE Webhook URL，啟用 Webhook，並開啟「Allow bot to join group chats」。

## 翻譯指令

| 指令 | 功能 |
|---|---|
| `/中翻英` | 中文→英文，啟用文字翻譯 |
| `/英翻中` | 英文→繁體中文，啟用文字翻譯 |
| `/中英翻譯` | 中文↔英文，啟用文字翻譯 |
| `/中越翻譯` | 中文↔越南文，啟用文字翻譯 |
| `/停用翻譯` | 相容指令：只停用文字翻譯 |
| `/啟用文字翻譯` | 依目前模式啟用文字翻譯 |
| `/停用文字翻譯` | 停用文字翻譯，保留模式 |
| `/啟用語音轉文字` | 啟用語音辨識；逐字稿依文字翻譯設定處理 |
| `/停用語音轉文字` | 停止下載、辨識及回覆語音 |
| `/啟用翻譯` | 相容指令：依目前模式啟用文字翻譯 |
| `/翻譯狀態` | 查詢模式及兩個開關 |
| `/翻譯設定` | 顯示狀態與操作指令 |
| `/我的ID` | 一對一私訊取得自己的 LINE userId |

選擇模式會啟用文字翻譯，但不變更語音開關；任一開關也不變更另一個開關。新聊天室兩項功能預設關閉。

指令前後可以有空白，但指令文字必須完全相同。

群組只有 `LINE_OWNER_USER_ID` 指定的帳號能選擇模式、啟用或停用；任何群組成員都能查詢狀態及設定說明。一對一聊天室由該使用者自行設定。

## 訊息處理規則

- 模式分別為 `zh-to-en`、`en-to-zh`、`zh-en`、`zh-vi`；沒有模式時使用中英雙向。
- 文字翻譯關閉時，不翻譯文字訊息，也不翻譯語音逐字稿。
- 單向模式忽略反方向的文字訊息。文字與語音逐字稿共用方向判斷：含中文視為中文，否則含拉丁字母視為模式中的英文或越南文。中英混合視為中文，英翻中模式不翻譯此類內容。
- 純數字、符號或 Emoji 不呼叫翻譯服務。
- 語音轉文字關閉時，不下載、不辨識、不回覆語音。
- 語音轉文字開啟時，先辨識逐字稿，再依文字翻譯開關及方向決定是否翻譯。符合條件回覆「逐字稿＋空行＋翻譯」，否則只回覆逐字稿。
- 語音辨識依模式使用繁體中文＋英文，或繁體中文＋越南文。逐字稿中的指令只作為內容，不執行設定變更。
- 群組使用原始 groupId，一對一使用 user:{userId}，各聊天室設定獨立。
- Firestore collection 維持 `lineTranslationGroups`。新設定為 `textTranslationEnabled`、`audioTranscriptionEnabled`、`translationMode`、`changedBy`、`changedAt`。
- 舊文件的兩個開關若尚未存在，分別沿用舊 `enabled` 值；明確的 true／false 優先。新操作只 merge 更新指定開關，不修改舊 enabled，避免另一項功能的預設狀態被連動。
- 不保存訊息、音訊、逐字稿或翻譯結果。
- 語音採同步辨識，預設限制為 59 秒與 10 MB；可透過 `MAX_AUDIO_DURATION_MS`、`MAX_AUDIO_BYTES` 調低。
- 文字與逐字稿預設限制為 2,000 個 JavaScript 字元，可透過 `MAX_MESSAGE_LENGTH` 調整。
- 圖片、貼圖、影片、檔案及外部來源音訊不處理。
- 單筆設定、翻譯、語音辨識或 LINE 回覆失敗時會記錄安全日誌，Webhook 仍回傳 200，避免 redelivery 造成重複回覆。

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

自動化測試不會呼叫 LINE 或 Google Cloud，外部服務均使用 mock。目前共有 121 項測試。

## 最近部署

2026-09-14 已部署獨立文字／語音開關與四種翻譯模式，正式服務版本為 `linewebhook-00010-vuz`。IN_TW 已設為中翻英，文字翻譯與語音轉文字均啟用；其餘群組設定未變。121 項自動化測試、型別檢查與建置通過，正式服務的簽章空事件與英文忽略測試均無失敗。未向群組發送測試訊息；真人語音辨識品質尚未人工驗收。
