# POC 開發與部署指南

## 目前狀態

- Firebase Functions 第 2 代 TypeScript 專案，Node.js 22，區域為 asia-east1。
- 支援群組與一對一聊天室的四種翻譯模式，文字翻譯與語音轉文字獨立啟停。
- 語音先轉逐字稿，再套用文字翻譯設定；未啟用翻譯或方向不符合時，只回覆逐字稿。
- 群組僅授權者可修改設定，一對一由該使用者管理。Webhook 簽章仍以原始 raw body 驗證。
- 部署前執行型別檢查、121 項測試及正式建置；實際 LINE 語音品質需以真人語音驗收。

## 安裝與驗證

在專案根目錄執行：

```powershell
npm.cmd install --prefix functions
npm.cmd run verify
```

驗證基準：

```text
Test Files  4 passed (4)
Tests       121 passed (121)
TypeScript  check passed
Build       passed
```

## Firebase 與 Google Cloud 設定

1. 複製 `.firebaserc.example` 為 `.firebaserc`，填入 Firebase 專案 ID。
2. 啟用 Blaze Plan、Cloud Translation API、Cloud Speech-to-Text API 與預設 Cloud Firestore database。
3. 將 Function 服務帳戶授予：
   - `roles/cloudtranslate.user`
   - `roles/speech.client`
   - `roles/datastore.user`
4. 設定 Secret：

   ```powershell
   firebase.cmd functions:secrets:set LINE_CHANNEL_SECRET
   firebase.cmd functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
   firebase.cmd functions:secrets:set LINE_OWNER_USER_ID
   ```

5. 驗證並部署：

   ```powershell
   npm.cmd run verify
   $env:FUNCTIONS_DISCOVERY_TIMEOUT = "30"
   firebase.cmd deploy --only functions:lineWebhook
   Remove-Item Env:FUNCTIONS_DISCOVERY_TIMEOUT
   ```

6. 將 Function HTTPS URL 設為 LINE Webhook URL，完成 Verify，並開啟「Allow bot to join group chats」。

如尚未取得授權者 ID，可先設定暫用值並部署，再一對一私訊 OA `/我的ID`。取得 `source.userId` 後更新 `LINE_OWNER_USER_ID` 並重新部署。

## 將 LINE OA 加入群組

一個 LINE OA 可以加入多個不同群組，但同一個群組在同一時間只能有一個 LINE Official Account。邀請前請先檢查：

1. LINE Developers Console 的 Messaging API 頁面已開啟「Allow bot to join group chats」。
2. 目標群組的成員清單中沒有其他 LINE OA／Bot。
3. 目標群組沒有尚未完成的其他 OA 邀請。

正常加入時，群組會顯示 `Auto Translate joined the group.`，接著 Bot 會回覆翻譯設定說明。只有顯示 `invited Auto Translate to the group. Wait for them to join before chatting.` 時，代表邀請仍在等待，Bot 尚未加入，因此 LINE 不會傳送 `join` webhook。

若邀請一直停在等待加入：

1. 檢查並移除群組中既有的 LINE OA。
2. 取消 Auto Translate 尚未完成的邀請。
3. 重新邀請 Auto Translate。
4. 確認群組顯示已加入訊息，再由授權者執行 `/中英翻譯` 或 `/中越翻譯`。

參考：[LINE Developers－Group chats and multi-person chats](https://developers.line.biz/en/docs/messaging-api/group-chats/)

## 指令與權限

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

群組的設定修改限授權者；所有群組成員可查詢狀態。一對一由該使用者管理。

指令會先 `trim`，前後可以有空白，但內容必須完全相同。LINE Webhook 未提供群組發話者 `userId` 時，設定修改指令會被拒絕。

## Firestore 相容性

- 群組使用原始 groupId，一對一使用 user:{userId}，各聊天室設定獨立。
- Firestore collection 維持 `lineTranslationGroups`。新設定為 `textTranslationEnabled`、`audioTranscriptionEnabled`、`translationMode`、`changedBy`、`changedAt`。
- 舊文件的兩個開關若尚未存在，分別沿用舊 `enabled` 值；明確的 true／false 優先。新操作只 merge 更新指定開關，不修改舊 enabled，避免另一項功能的預設狀態被連動。
- 不保存訊息、音訊、逐字稿或翻譯結果。

部署順序：先部署支援新欄位與模式的 lineWebhook，再更新指定群組設定。不要先將新模式寫入仍使用舊版程式的環境。設定修改前保存該文件原值及 updateTime，使用更新前置條件避免覆蓋同時發生的變更。

## 端對端驗收案例

| 案例 | 預期結果 |
|---|---|
| 中翻英：中文／英文文字 | 中文翻英文；英文不回覆 |
| 英翻中：英文／中文文字 | 英文翻繁中；中文不回覆 |
| 中英／中越 | 維持各自的雙向翻譯 |
| 文字開、語音關 | 文字依模式翻譯；語音不下載 |
| 文字關、語音開 | 文字不回覆；語音只回逐字稿 |
| 中翻英且兩者開，中文語音 | 中文逐字稿＋英文翻譯 |
| 中翻英且兩者開，英文語音 | 只回英文逐字稿 |
| 混合中英逐字稿 | 視為中文，依文字規則決定是否翻譯 |
| 模式切換與文字啟停 | 語音開關保持原值 |
| 語音啟停 | 文字開關與模式保持原值 |
| 非授權者修改任一設定 | 回覆無權限；設定不變 |
| 舊 enabled=true 的群組 | 兩個開關均繼承啟用，直到個別設定 |
| 超長語音／逐字稿 | 維持長度提示與限制 |
| 語音念出設定指令 | 當作逐字稿，不執行指令 |

## 第一版限制

- 文字以是否含中文或拉丁字母判斷翻譯方向；選定中越模式後，非中文拉丁文字會視為越南文。
- 不處理圖片文字、貼圖、影片與檔案。
- 語音採同步辨識，只接受 LINE 託管、59 秒內且不超過 10 MB 的音訊。
- 一個聊天室一次只能選擇一種翻譯模式。
- LINE 限制同一個群組或多人聊天室同時只能存在一個 LINE Official Account。
- LINE Messaging API 不提供可靠的群組管理員判斷，因此群組仍使用預先設定的單一授權 `userId`。
- 專有名詞尚未建立 glossary。
