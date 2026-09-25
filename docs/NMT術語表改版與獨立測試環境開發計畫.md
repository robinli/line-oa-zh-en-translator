# NMT 術語表改版與獨立測試環境開發計畫

- 儲存日期：2026-09-24。
- 狀態：規劃已保存；WI-01～WI-08 均待實作。
- 本次儲存範圍：開發計畫、系統總覽入口及專案日誌；未修改 application code、建立雲端資源、呼叫翻譯 API 或部署。
- 需求來源：本次對話中使用者確認的 NMT＋Google 內建術語表＋程式檢查方案，以及不同測試 Google 帳號、新帳單帳戶、新 GCP 專案、新 LINE OA。
- 執行前必讀：[系統規則與知識總覽](系統規則與知識總覽.md)。

## 1. 目標與版本處理

中英流程改為：

**原文 → 必要資料保護 → NMT 同次套用 Google 術語表 → 程式檢查、還原格式 → LINE 回覆**

Google 提供術語表功能，術語內容由本系統維護；中越維持既有無商務術語表的 NMT 流程。每個環境仍採單一 LINE OA／Cloud Run Function，依群組設定選擇中英或中越處理程序。

**目前不需要還原正式服務，也不刪除本機開發成果。** 保留尚未上線的 Translation LLM candidate-context-quantity-v13、測試、失敗紀錄及證據；核對正式部署來源後，另建立 NMT 開發 worktree。本輪只部署測試區，正式切換另行處理。

最近唯讀核對的正式版本為 linewebhook-00018-huk，正式中英引擎為 translation-llm／candidate-v12、中越為 NMT；此為當時狀態，後續任何操作前需重新核對。

46c5e29 的 36 個 functions/src/*.ts 已與本機正式部署候選備份比較，僅將 CRLF 正規化為 LF 後內容一致；這不是完整建置產物或部署來源的證明。WI-01 仍須核對 source manifest、依賴鎖定檔及必要設定；若不符，使用可驗證的正式來源作為基準。不得直接把整個未獨立放行的 v13 translator 帶入測試分支當成既有穩定版本。

## 2. 執行流程與 Work Items

Planner 先完成需求、程式分析及 Work Items；等待完成後，由 Implementer 依序實作及執行必要測試；全部實作完成後，才由 Verifier 從原始需求獨立驗證。

Planner 與 Verifier 不修改 application code；Implementer 不自行擴大 Scope。不同階段依序執行，不同時修改相同檔案。Blocking／High／Medium findings 交回 Implementer 修正，完成後再由 Verifier 重驗，直到所有 Acceptance Criteria 通過；若額度或外部前置條件阻擋，明確列出未完成項目，不宣稱完成。

| 順序 | Work Item 與 Acceptance Criteria | 狀態 |
|---|---|---|
| WI-01 | 保存並核對基準：保存既有 workspace、v13 原始碼、測試及雜湊；核對正式部署來源後建立隔離 worktree，避免把未放行的候選一起部署。 | 待實作 |
| WI-02 | 隔離帳號與部署設定：建立測試專用 gcloud 設定、ADC、服務帳戶及 Secrets；修正測試分支中指向正式專案的部署預設與硬編碼服務帳戶，部署及評估必須明確指定測試專案。 | 待實作 |
| WI-03 | 建立測試資源與額度控制：核對新帳號、帳單及專案後，建立測試 Function、Firestore、術語表儲存資源及 LINE Webhook；所有測試翻譯共用累計 100,000 輸入字元上限，送出前原子保留額度，超額或計數服務失效時不呼叫 API。 | 待實作 |
| WI-04 | 實作中英 NMT 引擎：新增 NmtGlossaryTranslator 與 nmt-glossary 引擎，使用 general/nmt 與一般術語表；保留既有翻譯介面及模式路由，不改寫舊 google 引擎含義，每則訊息一次請求，關閉自動重試，不自動切換至 LLM。 | 待實作 |
| WI-05 | 移植保護與檢查：從凍結 v13 選擇性移植必要保護到 NMT 專屬或中立模組，保留姓名、原生提及、數字、金額、袋／箱計價關係、段落及字面資料；完整訊息送入模型，正確的「每箱 USD 9.50／每袋 USD 2.40」必須接受。 | 待實作 |
| WI-06 | 術語與固定回歸：以現有雙向 v8 術語資料建立測試專案專用版本，完成離線測試、小量 API 檢查，再凍結候選、資料、術語表雜湊並執行固定回歸，完整審閱譯文與拒絕原因。 | 待實作 |
| WI-07 | 獨立驗證與測試 OA 驗收：Verifier 重新檢查原始需求、程式與完整譯文，建立未見案例與錯誤輸出注入；Blocking／High／Medium findings 修正後重驗，僅用新測試 OA 驗證群組、私訊、指令、提及及中越隔離。 | 待實作 |
| WI-08 | 文件與交付：更新系統總覽、維運文件及日誌，列出實際修改、檔案、測試、findings、字元消耗及剩餘風險，分別標示開發、部署與人工驗收狀態，保留可驗證的回復基準。 | 待實作 |

## 3. 帳號、資源與設定隔離

測試環境使用與正式區不同的 **Google 登入帳號、新帳單帳戶、新 GCP 專案及新 LINE OA**。建立計畫時，新測試專案、帳單及 OA 均尚未建立，實際識別值待前置作業取得，不填入臆測值。

- 由測試 Google 帳號持有人完成新帳單帳戶的付款與身分設定；LINE 管理員建立測試 OA 並啟用 Messaging API。
- 環境識別包含 TEST_ACCOUNT_EMAIL、TEST_PROJECT_ID、TEST_BILLING_ACCOUNT_ID、TEST_RUNTIME_SERVICE_ACCOUNT；這些是本計畫約定的設定輸入，尚未代表程式已有支援。
- 本機使用獨立 CLOUDSDK_CONFIG 目錄與明確指定的 ADC 路徑；不變更正式預設登入。gcloud CLI 與應用程式 ADC 是兩套憑證，不能只切換 project 就視為隔離完成。
- Firebase 部署也必須使用測試身分；測試工具與部署入口核對 principal、project、billing、runtime service account、model、glossary，任何指向正式資源的目標直接拒絕。
- 測試專用部署不能依賴指向 line-auto-translate-bot 的 .firebaserc default 或 npm deploy 預設。
- 建立測試專案自己的 service account、Secret Manager 值、Firestore 與術語表資源；採執行所需最小權限，不複製正式 LINE Token、群組設定或身分別名。
- 測試 LINE_OWNER_USER_ID 從測試 OA 的 /我的ID 取得，不能假定與正式 channel/provider 的 userId 相同；機密直接存入測試 Secret Manager，不寫入計畫、原始碼或日誌。
- 本輪不切換正式流量，不更動正式 Webhook 或正式群組設定。

## 4. 翻譯與介面契約

- 新中英引擎設定為 TRANSLATION_ENGINE=nmt-glossary；既有 Translator 介面與依模式選擇處理程序的路由維持。
- NMT 模型資源為 projects/<TEST_PROJECT_ID>/locations/us-central1/models/general/nmt；請求 parent 與雙向 glossary 使用相同測試專案及 us-central1，不借用正式 glossary。
- 使用一般 glossary，關閉 enhanced/contextual glossary 行為；只採用 glossaryTranslations。缺少、數量不符或不合契約時視為失敗，不默默改用未套術語的 translations。
- 以現有 functions/glossaries/zh-en-v8.tsv 的 16 條、en-zh-v8.tsv 的 28 條作為術語起點，保留版本及雜湊；檢查價格概念、銀行／業務 account owner、大小寫及長詞組，不假定 NMT 效果等同 TLLM。
- 主 contents 保留整則訊息與段落，讓模型看見必要數量及上下文；僅做必要保護，不把所有數值完全遮蔽。必要的輔助 contents 放在同一次請求，全部計數。
- 每則訊息一次 translateText；每次 15 秒逾時，關閉 SDK 及自動品質重試；輸出上限延續 4,500 UTF-16。不設 NMT→TLLM／Gemini 自動 fallback。
- 保留金額、幣別、符號及精度、單位與計價分母對應、occurrence、段落、原生提及、字面 HTML entity 契約；不自行計算、換匯、增加費用或把袋與箱互換。
- 使用者已接受「每箱 USD 9.50／每袋 USD 2.40」的自然語序；必須接受正確譯文，同時保留未知分母與 copy-exact 等既有邊界。
- 延續私訊僅 /我的ID、群組模式與獨立開關、相同譯文不回覆、品質或服務失敗靜默等現行行為。
- 中越仍為既有無商務術語表 NMT，僅在測試環境注入共用字元計數 client，不改翻譯規則；語音功能採離線回歸，本輪不新增付費語音測試。
- 正常應用日誌不記錄聊天本文或譯文；測試證據限合成資料，字元 ledger 僅保存必要計數與診斷。

## 5. 固定測試集合與驗收門檻

先通過 Node.js 22 型別檢查、測試及建置；特別驗證帳號／專案隔離、並行扣額、超額攔截、計數失敗、資料還原、錯誤靜默及不自動跨引擎備援。

| 集合 | NMT 執行與門檻 |
|---|---|
| 舊主要回歸 280 案 | 每案一次，至少 272 案可用，僅容許下列固定 8 案因實際品質缺陷而安全拒絕。 |
| 比較集合 30 案 | 每案一次，至少 29 案可用，僅容許 pack-do-not-calculate 因實際禁止語意弱化而安全拒絕。 |
| 舊 holdout 20 案 | 每案一次，20／20 可用；現在屬固定回歸，不再稱為未見案例。 |
| 去重後合計 318 案 | 至少 309 案可用，正確略過純代碼依既有契約驗證。 |
| 核心包裝 9 案、共三輪 | 主集合一次後追加兩輪，27／27 可用。 |
| Verifier 新建 20 案 | 凍結後建立、每案一次，20／20 可用，涵蓋歷史 F01–F07 的錯誤類型，不與開發案例重複。 |

主要回歸沿用 functions/scripts/evaluate-tllm-context-quantity.mjs 所列十一份固定 fixture：synthetic-trade-cases、synthetic-alternative-cases、synthetic-tllm-holdout、synthetic-tllm-v2-holdout、v4-holdout、v6-holdout、v8-holdout、v9-regression、v10-holdout、v11-holdout、v12-holdout，實際檔案依該腳本在 functions/evaluation/ 的路徑解析；另加入 synthetic-direct-comparison-cases.json 及 synthetic-tllm-v13-holdout.json，執行前凍結現有檔案雜湊與 rubric。

去重鍵為來源方向、完整來源字串、實際 UTF-16 mention ranges，不能僅依 ID 或文字相似度合併。330 個邏輯分組中，12 個比較商務案例與主要回歸重複，故為 318 個唯一案例；其中一個 code-only 案例預期不需呼叫 API。

允許安全拒絕的舊回歸固定名單：v6h16、v8h11、v9h07、v9h28、v10h06、v11h15、v12h14、v12h15；比較集合僅 pack-do-not-calculate。名單不是免測或產品邏輯黑名單，每案仍須執行；正確譯文被誤擋仍列為 finding，不得新增其他拒絕抵銷總數。

九個核心案例：pack-rough-packaging、pack-clear-packaging、pack-zh-packaging、pack-decimal-units、pack-tentative-packaging、pack-net-gross、pack-zh-negative、pack-zh-net-gross、pack-split-paragraphs。

所有譯文須全文審閱，不能以「有輸出」等同「可用」；數量、單位、分母、條件、否定、角色、段落、提及及字面資料不得有未攔截的 Blocking／High／Medium 問題。既有 v13 證據只能用作離線回歸，不能冒充 NMT 品質實測或獨立放行。

本輪為新的節制評估規則：大部分 NMT 案例一次，核心三次，不宣稱與先前 TLLM 全部三輪具有相同證據強度。

## 6. 字元上限與術語表計費

| 用途 | 輸入字元預留上限 |
|---|---:|
| 小量結構與術語檢查 | 5,000 |
| 固定回歸與核心追加 | 55,000 |
| 獨立驗證 | 20,000 |
| 修正後必要重測 | 10,000 |
| 測試 OA 人工驗收，含中越 | 10,000 |
| **總上限** | **100,000** |

- 所有本次測試入口在每次實際請求送出前共用持久化、原子額度 ledger；按 contents 各字串的 Unicode code points 計數，包含 HTML、空白、保護標記、輔助輸入與每次實際請求。
- 送出後失敗或逾時保守占用額度，不自動退回；並行執行不能突破上限，計數服務不可用即停止呼叫。
- 既有評估工具只有事後統計，尚未具備此硬上限；WI-03 完成前不能把本計畫當成已啟用的費用控制。
- 以凍結 v13 第一輪編碼進行本機估算：318 唯一案例 48,884 字元，核心每輪 1,043，追加兩輪後 50,970；這不是 NMT 實測或最終編碼保證，完成 NMT 編碼後須先 dry-run 重算。
- 修正優先使用完整請求相符的錄製回應離線重播，再針對受影響集合實測；若編碼、術語表或廣泛檢查改動使證據失效，不能沿用不相容結果。
- 達上限即停止並列出未完成或未通過項目，不自行提高額度，也不把「額度用完」當成驗收完成。

**術語表只需預先建立，之後每次翻譯指定 ID／資源路徑，不傳整份詞條。**

| 內容 | 是否計入 NMT 翻譯字元 |
|---|---|
| contents 中的原文 | 是 |
| contents 中的 HTML、空白、保護標記與輔助輸入 | 是 |
| 已建立的術語表全部詞條 | 否 |
| glossaryConfig 指定的 ID／資源路徑 | 否 |
| NMT 回傳譯文，包括套用術語表的譯文 | 否，NMT 僅計輸入 |

例如原文 100 字元加 HTML 60 字元，以 160 輸入字元計算，不再加上術語表詞條。建立 glossary 本身不收 Cloud Translation 費用，Cloud Storage 等相關資源費另計。

依 2026-09-24 查核的官方定價，NMT 每月前 500,000 字元以 US$10 抵免，超出每百萬輸入字元 US$20；本輪 100,000 字元未抵免牌價為 US$2。新帳戶啟用後仍須核對適用額度及使用量，不保證整個測試環境零費用，也不把建立新帳單視為自動取得 US$300 新客試用資格。

## 7. 前置條件、交付與剩餘風險

外部前置條件：測試 Google 帳號登入、新帳單付款／身分程序、新專案與 LINE OA 建立、測試 Secrets 設定；在取得必要識別與權限前，可完成不依賴雲端的開發和離線測試，但不可沿用正式憑證繞過。

測試 OA 人工驗收由使用者在隔離測試群組輸入合成訊息，驗證群組模式、指令、私訊限制、原生提及與中越隔離；不把 LINE validate/reply 或簽章合成事件當作真人使用端驗收。

NMT＋術語表尚未完成本系統品質驗證，商務條件、否定與角色仍可能誤譯，有限程式檢查不等於通用語意正確保證。額度不足、API 故障或品質未達標時，保留證據、記錄阻擋原因及尚未完成的 AC。

最後交付必須包含：Work Items、實際修改內容、修改檔案、測試結果、Verification findings、Remaining risks，另附候選／資料／術語雜湊及實際累計字元。正式切換前需另核對映像與回復來源可用性，不僅憑歷史 revision 名稱宣稱可回復。

## 8. 相關文件與官方來源

- [Translation LLM 上下文與數量 F07 修正驗證](TranslationLLM上下文與數量F07修正驗證.md)：需保留的既有候選與證據，尚未最終獨立放行。
- [Translation LLM 正式切換與維運](TranslationLLM正式切換與維運.md)：既有正式環境及回復紀錄。
- [原文直送翻譯比較評估](原文直送翻譯比較評估.md)：早期 NMT／TLLM 合成比較，不能視為新方案已驗證。
- [Google Cloud Translation 定價](https://cloud.google.com/products/translate/pricing)。
- [建立與使用 glossary](https://docs.cloud.google.com/translate/docs/advanced/glossary)。
- [TranslateTextGlossaryConfig](https://docs.cloud.google.com/translate/docs/reference/rest/v3/TranslateTextGlossaryConfig)。
- [Google ADC 憑證來源與順序](https://docs.cloud.google.com/docs/authentication/application-default-credentials)。
- [Google Cloud 免費額度與資格](https://docs.cloud.google.com/free/docs/free-cloud-features)。
- [建立 Cloud Billing 帳戶](https://docs.cloud.google.com/billing/docs/how-to/create-billing-account)。
- [建立 LINE OA 與 Messaging API](https://developers.line.biz/en/docs/messaging-api/getting-started/)。
