# LINE 群組中英自動翻譯機器人－技術選型報告

**文件日期：2026 年 8 月 12 日**

## 一、專案目標

建立一套 LINE 群組自動翻譯服務。

當 LINE Official Account（以下簡稱 LINE OA）加入指定 LINE 群組後，群組成員輸入中文文字時，系統自動將內容翻譯為英文，並由 LINE OA 將英文翻譯結果回覆至原群組。

預期使用方式：

```text
使用者：
明天下午三點跟客戶開會。

翻譯 OA：
We have a meeting with the client at 3 PM tomorrow.
```

本專案核心需求為：

- LINE OA 可加入群組
- 接收群組內成員文字訊息
- 中文自動翻譯為英文
- 翻譯完成後回覆至同一群組
- 24/7 可使用
- 不需使用者輸入特殊指令
- 初期不需要登入系統
- 初期不需要資料庫
- 以低維護成本、低月費為主要考量

---

# 二、技術選型結論

## 🎯 主推方案

**LINE Official Account + LINE Messaging API + Firebase Functions + Google Cloud Translation API**

整體技術架構：

```text
LINE 群組
   │
   │ 中文訊息
   ▼
LINE Official Account
   │
   │ Messaging API Webhook
   ▼
Firebase Functions
   │
   ├─ 驗證 LINE Webhook
   ├─ 判斷訊息類型
   ├─ 判斷是否需要翻譯
   │
   ▼
Google Cloud Translation API
   │
   │ 中文 → 英文
   ▼
Firebase Functions
   │
   │ LINE Reply API
   ▼
LINE 群組
```

**整體適配度：★★★★★**

**開發麻煩程度：中等**

**維護麻煩程度：低**

**預估小型使用情境月費：US$0～數美元級別**

---

# 三、選型理由

## 3.1 LINE Official Account + Messaging API

LINE Messaging API 可讓 LINE OA 接收來自群組的 Webhook 事件，因此適合作為群組自動翻譯 Bot 的入口。

當 LINE 使用者傳送訊息時，系統會收到 Webhook event；其中包含 reply token，可透過 Messaging API 將翻譯結果回覆至原聊天。

LINE OA 要加入群組前，需要在 LINE Developers Console 開啟：

**Allow bot to join group chats**

因此 LINE Messaging API 可符合：

- 群組訊息接收
- 自動處理
- 自動回覆
- Webhook 整合

等核心需求。

---

# 四、Firebase Functions 選型

Firebase Functions 負責整個系統的後端 Webhook。

主要工作包括：

1. 接收 LINE Webhook
2. 驗證 LINE 請求
3. 取得群組訊息文字
4. 過濾不需處理的訊息
5. 呼叫 Google Cloud Translation API
6. 取得英文翻譯
7. 呼叫 LINE Messaging API 回覆英文

Firebase Functions 適合此專案的主要原因，是此服務並不需要長時間執行單一運算工作，而是大量非常短的 HTTP Webhook 請求。

對一般公司內部 LINE 群組而言，實際使用量通常不高，因此 Firebase Functions 本身很可能維持接近 US$0 的成本。

### 麻煩程度評價

**開發初期：中等**

原因不是程式邏輯困難，而是第一次需要處理：

- Firebase Project
- Google Cloud Billing
- Blaze Plan
- Firebase CLI
- Environment / Secret 設定
- LINE Channel Secret
- LINE Channel Access Token
- Function 部署
- Webhook URL

完成第一次設定後，後續日常維護需求很低。

---

# 五、Google Cloud Translation 選型

本專案只需要：

**Traditional Chinese → English**

不需要：

- AI 對話
- 推理
- 文件分析
- 摘要
- 問答
- Agent
- RAG

因此優先採用專門處理語言翻譯的 **Google Cloud Translation API**，而不是使用大型語言模型。

Google Cloud Translation API 適合大量短文字即時翻譯，也符合 LINE 群組訊息的使用情境。

---

# 六、預估費用

假設每則 LINE 中文訊息平均：

**30 個中文字**

則可依每月訊息量估算翻譯成本。

| 每月翻譯訊息 | 約中文字元 | 預估成本 |
|---:|---:|---:|
| 1,000 則 | 30,000 | 低 |
| 5,000 則 | 150,000 | 低 |
| 10,000 則 | 300,000 | 低 |
| 20,000 則 | 600,000 | 低至數美元 |
| 50,000 則 | 1,500,000 | 依實際 API 計價 |

一般企業小型群組可先估算：

| 項目 | 預估月費 |
|---|---:|
| LINE OA / Messaging API | 依 LINE OA 使用方案 |
| Firebase Functions | 約 US$0 起 |
| Google Translation | 約 US$0 起 |
| Firestore | 不使用 |
| Firebase Storage | 不使用 |
| Hosting | 不需要 |
| **後端＋翻譯合計** | **約 US$0 起** |

實際帳單仍應依實際訊息數、訊息長度、Firebase 運算及網路流量確認。

---

# 七、訊息處理規則

建議第一版採取最單純的處理邏輯。

```text
收到 LINE Webhook
        │
        ▼
是不是文字訊息？
   │
   ├─ 否 → 忽略
   │
   ▼
是
        │
        ▼
是否包含中文？
   │
   ├─ 否 → 忽略
   │
   ▼
是
        │
        ▼
Google Translation
中文 → 英文
        │
        ▼
LINE Reply API
        │
        ▼
回覆英文
```

建議規則：

| 訊息類型 | 處理方式 |
|---|---|
| 中文文字 | 翻譯 |
| 英文文字 | 不處理 |
| 中文＋英文 | 翻譯 |
| 圖片 | 不處理 |
| 貼圖 | 不處理 |
| 影片 | 不處理 |
| 音訊 | 不處理 |
| 檔案 | 第一版不處理 |
| LINE 系統事件 | 不處理 |

此設計可以降低 API 呼叫量及群組訊息干擾。

---

# 八、重要 LINE 限制

## 8.1 同一群組只能存在一個 LINE OA

如果公司的 LINE 群組已經有其他 Bot / Official Account，需先確認是否會影響翻譯 OA 的加入。

---

## 8.2 必須允許 Bot 加入群組

LINE Developers Console 必須開啟：

```text
Allow bot to join group chats
```

---

# 九、安全設計

建議將以下資訊視為 Secret：

- LINE Channel Secret
- LINE Channel Access Token
- Google Cloud Credential / Service Account 權限

不可直接寫死在公開 source code repository 中。

另外 Firebase Function 收到 LINE Webhook 時，應驗證 LINE 所提供的 Webhook signature，避免第三方自行偽造 HTTP request 呼叫翻譯服務。

正式環境亦建議：

- 設定 Google Cloud Billing Budget
- 設定 Billing Alert
- 限制 Translation API 使用權限
- 對 Secret 採最小權限原則

---

# 十、風險與限制

| 風險 | 影響 | 建議處理 |
|---|---|---|
| 群組已有其他 LINE OA | 翻譯 Bot 可能無法加入 | 上線前先確認群組 |
| Firebase Blaze 需 Billing | 需要綁定付款帳號 | 設 Budget Alert |
| Translation API 被大量呼叫 | 可能產生費用 | 僅翻中文＋限制訊息長度 |
| 圖片內中文 | 無法翻譯 | 第一版不處理 |
| 語音訊息 | 無法翻譯 | 第一版不處理 |
| 專有名詞翻錯 | 商務內容可能不準確 | 建立 glossary / 規則 |
| Firebase 除錯 | 初期部署稍麻煩 | 建立 logging 與測試環境 |

---

# 十一、最終選型

## ✅ 建議採用

**LINE Official Account  
+ LINE Messaging API  
+ Firebase Functions  
+ Google Cloud Translation API**

主要原因：

1. 完整符合 LINE 群組即時翻譯需求。
2. 不需要自行維護常駐 Server。
3. 小型使用情境具有很低的基礎設施成本。
4. Google Translation 專門處理語言翻譯，需求單純且穩定。
5. 不需要資料庫即可完成 MVP。
6. 系統架構單純，後續維護負擔低。
7. Firebase Functions 初次設定雖有一定麻煩程度，但後續維護需求低。
8. 綜合功能、成本與穩定性後，是本專案合理的技術組合。

## 最終評分

| 評估項目 | 評分 |
|---|---:|
| 功能適配 | ⭐⭐⭐⭐⭐ |
| 成本 | ⭐⭐⭐⭐⭐ |
| 生產環境適用性 | ⭐⭐⭐⭐⭐ |
| 部署方便性 | ⭐⭐⭐ |
| 維護方便性 | ⭐⭐⭐⭐ |
| 開發麻煩程度 | ⭐⭐⭐ |
| **綜合推薦** | **⭐⭐⭐⭐⭐** |

**選型結論：建議正式採用。**