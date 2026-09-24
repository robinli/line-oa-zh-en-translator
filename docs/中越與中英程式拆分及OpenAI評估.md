# 中越與中英程式拆分及 OpenAI 可行性評估

> 歷史紀錄：本文件的雙 OA／雙 Function／programs 部署方案已被使用者後續確認的單一入口取代，相關本機配置已移除；最新狀態請讀 [單一入口與 Translation LLM 實作結果](單一入口與TranslationLLM實作結果.md)。原 NMT 與 OpenAI 評估紀錄保留。

日期：2026-09-23。依使用者最新要求分成兩個獨立程式：中越採 Google Translate NMT、不套用商務規則；中英保留商務要求，評估 OpenAI 最新模型。

## 結論與完成狀態

- 本機已完成兩份可各自部署的程式、獨立入口、語言指令、LINE Secret 名稱與聊天室設定集合。
- 中越使用 Cloud Translation API v3 的 general/nmt；不依賴 Gemini、OpenAI 或商務提示／術語驗證。
- 中英仍以現有 Gemini 3.5 Flash 作為正式引擎；OpenAI 僅供評估，未接入正式入口。
- Node.js 22.23.2：339 項測試、型別檢查、建置通過；兩份套件已建置。
- 最終版中越 12 則合成日常對話全部取得結果，提及位置檢查通過；不是一般翻譯準確率，也未完成越南語母語者與 LINE 使用端驗收。
- OpenAI 評估工具已乾跑：26 則中英合成案例 × 3 個模型；品質重試最多一次，最多 156 次請求。本次未設定 OPENAI_API_KEY，真實 OpenAI API 呼叫數為 0。
- 尚未部署；最近已確認的正式版本仍為 linewebhook-00015-poq，仍是拆分前的程式。

## 兩個獨立程式

| 項目 | 中英 | 中越 |
|---|---|---|
| 程式目錄 | programs/zh-en | programs/zh-vi |
| 編譯入口 | lib/index.js | lib/vietnamese-index.js |
| Function | lineWebhook，延續原名稱 | lineVietnameseWebhook |
| Firebase 設定 | firebase.zh-en.json | firebase.zh-vi.json |
| Codebase | default，延續原服務歸屬 | zh-vi |
| 翻譯模式 | zh-to-en／en-to-zh／zh-en | 僅 zh-vi |
| 新聊天室預設 | 中英、文字與語音關閉 | 中越、文字與語音關閉 |
| Firestore | lineTranslationGroups | lineVietnameseTranslationGroups |
| LINE Secrets | LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN、LINE_OWNER_USER_ID | VI_LINE_CHANNEL_SECRET、VI_LINE_CHANNEL_ACCESS_TOKEN、VI_LINE_OWNER_USER_ID |
| 引擎 | 現有 Gemini；OpenAI 待評估 | Google Translate NMT |
| 商務提示與資料驗證 | 保留 | 不套用 |
| 原生提及 | 保留，含已設定別名 | 保留來源原生提及，不載入中英的商務別名 |

這是同一儲存庫內的兩份獨立執行／部署套件。LINE、語音與設定的通用程式碼共用，建置時只複製各入口實際引用的模組。中越成品為 10 個模組，中英為 12 個模組；中越建置明確拒絕包含 trade-policy、business-translator、translator-factory 或 OpenAI 模組。

部署規劃先按各自 LINE 官方帳號與各自憑證處理；本次尚未建立或綁定新的中越 LINE 帳號。若最後選擇同一帳號，LINE 只有一個 Webhook URL，需要另外設計入口分流，不能把兩個 URL 同時填入。

錯誤語言指令會顯示本程式可用指令，不修改設定。設定讀到其他程式的模式時，文字／語音皆視為停用，不把原中越群組突然改成英譯；使用者明確重新啟用或選擇中英模式時，才改用本程式模式，且不承接其他模式的語音啟用狀態。未自動遷移或覆寫正式 Firestore 資料。

## 中越 NMT 的實作與驗證

使用 global 端點，明確指定 models/general/nmt；僅接受 zh-TW ↔ vi。每次 API 15 秒逾時、SDK 重試關閉，失敗仍遵守既有安靜不回覆規則。輸入上限 2,000、輸出上限 4,500 UTF-16 單位。

輸入先轉義為 HTML；原生提及以包含原名稱的 notranslate span 保護。NMT 接收完整段落，來源換行由程式保存。輸出必須保留每個 span 的識別值與原名稱各一次，才還原譯文位置；遺漏、改名、重複或未知標記都拒絕。只解碼 API HTML 傳輸的跳脫一次，原文真的含有 &#x20; 等字面內容不當成空格。HTML 不會送到 LINE 顯示或執行。

這個檢查只保護 LINE 提及與輸出格式，並未套用商務詞彙、人名表、幣別或報價驗證。提及對應的 userId、groupId 不傳給 NMT。仍沿用 LINE 發送前的群組成員確認、textV2 與必要純文字退回。

合成實測包含雙向日常句、否定、條件、時間、問題、中文提及、越文提及、Emoji、同名重複提及及換行。最終完整輸出見 [中越 NMT 實測附錄](評估附錄/2026-09-23中越NMT逐句輸出.md)。

人工初步閱讀：
- 否定、時間與條件案例可辨識出原意，稱謂有「你→您」等自然化變化。
- 「你吃飯了嗎？要不要一起吃晚餐？」第一句也被理解為吃晚餐，顯示 NMT 會依同句上下文選擇詞義。
- 母語自然度、更多省略主詞／俚語、長期成功率與手機實際提及通知仍待驗收。
- 初次本機 REST 測試漏了使用者憑證所需的計費專案標頭，已補上；失敗紀錄保留於 .local。
- 早期將提及前後分段的版本會補出「我們」，已由完整段落 HTML 版本取代；最終案例沒有沿用該斷句結果。

Google 官方支援 [NMT 中越互譯](https://docs.cloud.google.com/translate/docs/languages) 與 [HTML 文字翻譯](https://docs.cloud.google.com/translate/docs/translate-text)。NMT 每月前 50 萬字元以 US$10 抵免提供，超出部分 US$20／百萬輸入字元；抵免由 Basic／Advanced 共用，HTML 標記也會增加輸入字元。[官方定價](https://cloud.google.com/products/translate/pricing)

## 中英 OpenAI 可行性

結論是「API 與程式整合可行，翻譯品質及帳號可用性尚未實證」。需要保留中英商務規則，因此以 GPT-6 Sol 作為主要候選、Luna 作低成本候選、Astra 作旗艦比較。這是依官方定位安排評估，不代表已證明任何一個模型的中英譯文優於 Gemini。

| 模型 ID | 官方定位／評估角色 | 輸入 US$/百萬 tokens | 輸出 US$/百萬 tokens |
|---|---|---:|---:|
| gemini-3.5-flash | 現有對照 | 1.50 | 9.00 |
| gpt-6-sol | 能力與成本平衡、主要候選 | 2.00 | 10.00 |
| gpt-6-luna | 明確且大量任務、低成本候選 | 0.10 | 0.50 |
| gpt-6-astra | 旗艦比較 | 10.00 | 50.00 |

採短上下文 Standard、無快取，Gemini 為 Global；價格核對日為 2026-09-23。固定假設每月 1 萬筆、每筆 1,500 輸入與 200 計費輸出 tokens，分別約 US$40.50、50、2.50、250。實際 tokenization、推理、品質重試、快取與延遲均需量測，這不是實際帳單。

[OpenAI 模型定位](https://developers.openai.com/api/docs/models)、[OpenAI 價格](https://developers.openai.com/api/docs/pricing)、[Google 價格](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)。

| 系統要求 | 本次整合判斷 |
|---|---|
| 系統指令、商務語義限制 | Responses API instructions 可承接現有 policy |
| translation 單欄 JSON | 使用 strict JSON Schema；仍由現有 BusinessTranslator 檢查 |
| 數字、人名、條款及提及保護 | 共用現有保護、還原與語義檢查；模擬回歸已涵蓋 |
| 品質重試 | 保留只重試一次，API 服務錯誤不重試 |
| 拒答、截斷、非預期輸出 | completed 狀態與完整訊息檢查，不發半截譯文 |
| 安全日誌 | 錯誤只保留安全類別／HTTP 狀態，不存 API 錯誤正文或金鑰 |
| 真實翻譯品質、速度、429 比率 | 未實測，不能由模型定位推定 |
| 正式金鑰、帳號權限、配額 | 尚未核對，不以這個 Codex 帳號的可用模型代替 API 授權 |

評估介面沒有工具、聊天歷史或 previous_response_id，使用 reasoning=low、max_output_tokens=4096、每次 15 秒、store=false。Structured Outputs 約束格式，不能保證商務意思完全正確。[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

store=false 不等於提供者端零保存；OpenAI 預設的濫用監控與快取有各自保存規則。正式遷移時需核對組織資料設定，本次只設計使用合成資料的評估。[官方資料控制](https://developers.openai.com/api/docs/guides/your-data)

### 執行評估

先建置，將有效 OpenAI API 金鑰透過本機環境或 Secret 注入 OPENAI_API_KEY，勿貼在聊天、命令歷史或提交檔案。

~~~powershell
npm.cmd run build
npm.cmd run evaluate:openai --prefix functions -- --dry-run
npm.cmd run evaluate:openai --prefix functions
~~~

可用 OPENAI_EVAL_MODELS=gpt-6-sol 限制單一模型。工具只讀兩個固定的合成案例檔並篩選中英方向，不讀真實聊天或 LINE 身分設定。結果寫入 Git 忽略的 .local/openai-evaluation/；包含逐句輸出、機械檢查、重試、延遲及 token 用量，人工語義判讀另列 pending。API 不可用時停止該模型的剩餘案例。

正式候選必須通過目前的資料保護及人工商務語義檢查，尤其底價／成本價／報價、是否另加費用、誰負責、否定與承諾程度。片段比對失敗可能只是同義詞，需要人工判讀；片段通過也不是語義正確證明。測試完成前不切換中英正式引擎。

## 建置、部署與移轉

~~~powershell
npm.cmd run verify
npm.cmd run build:zh-en
npm.cmd run build:zh-vi
~~~

兩個目錄各有 package.json、package-lock.json 與獨立 main。建置工具只重建各自 lib 目錄，不複製 .env、Secret、測試或評估資料。建置需此儲存庫的共用 functions 原始碼及已安裝開發套件；產出的程式以各自鎖定的依賴執行。

中英部署前：
1. 將既有 functions/.env.line-auto-translate-bot 的部署參數安全複製至 programs/zh-en/.env.line-auto-translate-bot，保留 TRANSLATION_ENGINE、Gemini 模型及已核對的別名設定；不要用空設定覆蓋正式提及配置。
2. 保持既有 LINE Secret、Function 名稱及 default codebase；既有 Webhook URL 不需要為拆分而重設。
3. 先確認哪些原中越聊天室需要搬到新的中越 LINE 帳號；本次未搬資料。

中越部署前：
1. 提供另一個 LINE 官方帳號的 Messaging API 憑證，分別存成 VI_LINE_CHANNEL_SECRET、VI_LINE_CHANNEL_ACCESS_TOKEN、VI_LINE_OWNER_USER_ID。
2. 依 programs/zh-vi/.env.example 設定 VI_RUNTIME_SERVICE_ACCOUNT，使用專用執行帳號，配置 Cloud Translation、Speech、Firestore 與該程式所需 Secret 權限；不需要 Vertex AI 模型權限。
3. 依實際 GCP 專案建立 programs/zh-vi/.env.PROJECT_ID。可先部署到現有專案的獨立 codebase；若需 IAM 層級的資料硬隔離，使用獨立 GCP 專案／Firestore。
4. 設定新帳號的 Webhook URL，再於新帳號加入的群組啟用中越翻譯。

部署指令（本次未執行）：

~~~powershell
npm.cmd run deploy:zh-en
npm.cmd run deploy:zh-vi
~~~

兩份 Firebase 設定的 predeploy 都會先跑完整 verify 再建置對應套件。root firebase.json 保留給舊流程相容；日後請用上面的明確獨立部署指令。root npm run deploy 只委派中英，不會一起建立中越服務。

本機可在對應程式目錄提供 .secret.local，再使用 firebase --config firebase.zh-en.json emulators:start --only functions 或中越對應設定；兩份 functions emulator 埠分別為 5001、5002，需先建置對應套件。
