# Google Translate NMT 與 Translation LLM 替代評估

> 後續狀態：已完成術語表與單一入口實作，仍因語義缺陷未放行；詳見 [實作結果](單一入口與TranslationLLM實作結果.md)。本文件保留前一輪無術語表實驗。

- 評估日期：2026-09-23（台灣時間）。
- 範圍：對照《系統規則與知識總覽》的現行要求，評估 general/nmt 與 general/translation-llm；不是更換正式引擎的實作或部署。
- 結論：兩者皆可處理基本語言方向，但本次未達全部商務語義及重要資料保護要求；Translation LLM 是較值得優先客製化驗證的候選，尚不能宣稱已可替換 Gemini。
- 正式流程、模型參數、聊天室設定與 LINE 通知均未變更；模型實驗只有合成資料。

## 1. 決策摘要

| 項目 | Google Translate NMT | Translation LLM |
|---|---|---|
| 直接切換為現有系統的完整替代 | 不符合 | 不符合 |
| 基本中英／中越雙向翻譯 | 支援，四方向實測均有成功輸出 | 支援，四方向實測均有成功輸出 |
| 複雜商務語義 | 本樣本出現 CNF→含稅、底價→基礎價格等關鍵錯誤 | 價格概念與部分人名較好，但仍有最低價承諾、can→不應等關鍵錯誤 |
| 現有不透明標記直接移植 | 有遺漏、損壞與句法退化 | 有遺漏，且術語及語氣偏差仍存在 |
| HTML 保護原型 | 解決部分提及，但重複人名、換行與字面 entity 等仍有問題 | 同樣存在重複人名，個別角色句遺漏嚴重 |
| 下一步定位 | 若成本優先，可評估簡單內容用途；不建議作全域無条件備援 | 優先進行術語表＋專用保護介面的小範圍驗證 |

「不符合」指本次未客製引擎及兩種評估原型沒有達到現行全部要求，不是證明 Cloud Translation 經完整客製後永遠做不到，也不是證明 Gemini 全面正確。

## 2. 方法與證據

沿用 10 則既有虛構貿易案例，新增 20 則合成案例，共 30 則；涵蓋四個語言方向、底價與其他價格概念、費用含／另加、多方角色、否定、can／should／must、條件與承諾、人名、產品代碼、數字算式、網址、提及、字面 HTML entity、內文命令及段落。

每種模型各測三種方式，總計 180 次正式 Cloud Translation API 請求；另有一則 Translation LLM 連通性探測，不列入統計。所有案例與提及名稱為虛構資料，不包含 LINE userId、groupId 或真人聊天內容。

1. raw：原文直接使用 text/plain 翻譯，未設 glossary。
2. protected：沿用 prepareTradeText 的隨機逐項標記；API 不接受 Gemini 的 system instruction／protectedValues JSON 契約，因此本輪只送標記正文，再用既有還原及術語檢查驗證，這是「直接移植相容性」實驗，不是最佳化後的完整串接。
3. protected-html：評估用 span 原型，保留原始值供語境判斷，附加唯一 id、class=notranslate、translate=no；檢查 span 原值與唯一性後轉回既有標記，重用還原檢查。此原型不是正式用的完整 HTML 解析器，也不代表官方保證所有自訂屬性及位置都能正確保留。

共用 global 位置、每次 15 秒逾時、最多兩個並行請求，無自動重試；沒有建立雲端 glossary、Adaptive Translation 資料集或訓練模型。每則每方式只取一次樣本，沒有執行壓力或長期穩定性測試。

已逐句檢視輸出，判讀者為 Codex，並非業務使用者或越南語專業審稿者驗收。下方「機械檢查」只包含既有術語、片段、方向及保護契約，不能等同語義正確率。

| 模型／方式 | HTTP 成功 | 機械檢查通過 | 還原及資料檢查通過 | 延遲中位數 | 樣本 P95 |
|---|---:|---:|---:|---:|---:|
| NMT raw | 30/30 | 22/30 | 不適用 | 151 ms | 244 ms |
| NMT protected | 30/30 | 23/30 | 28/30 | 175 ms | 325 ms |
| NMT protected-html | 30/30 | 21/30 | 26/30 | 163 ms | 297 ms |
| Translation LLM raw | 30/30 | 23/30 | 不適用 | 414 ms | 535 ms |
| Translation LLM protected | 30/30 | 24/30 | 28/30 | 487 ms | 676 ms |
| Translation LLM protected-html | 30/30 | 21/30 | 25/30 | 441 ms | 530 ms |

延遲是這台本機至 API 並讀取回應的耗時，不是 LINE 端到端延遲；樣本少且相似請求可能受服務端快取影響，不代表正式 P95 或可用率。HTTP 成功也不代表通過品質檢查。

原始證據僅存本機（Git 忽略），新 checkout 不一定存在：

- [.local/translation-alternatives/2026-09-23T08-24-26-363Z.json](../.local/translation-alternatives/2026-09-23T08-24-26-363Z.json)：raw 與 protected，120 次請求。
- [.local/translation-alternatives/2026-09-23T08-27-41-426Z.json](../.local/translation-alternatives/2026-09-23T08-27-41-426Z.json)：protected-html，60 次請求。
- [逐句輸出附錄](評估附錄/2026-09-23翻譯替代方案逐句輸出.md)：可攜的合成輸出快照，供查核上述缺陷。

## 3. 決定是否達標的實際案例

### 3.1 貿易條件與費用：NMT 出現關鍵錯誤

案例 incoterm-ambiguity 原文：

> USD 845 CNF is our quotation. Add USD 35 separately; we have not confirmed what that amount covers. Tax is not included.

NMT raw：

> 我們的報價為 845 美元（含稅）。另加 35 美元，我們尚未確認該費用包含哪些項目。價格不含稅。

CNF 消失並新增「含稅」，與原文末句不含稅矛盾，直接違反現行要求；這是語義錯誤，不只是指定用詞未符合。Translation LLM raw 保留 CNF 並正確表達不含稅。HTML 原型可改善此例，但未解決其他案例。

### 3.2 最優惠報價與最低價承諾：兩者都會偏離

案例 price-inclusion 的「USD 780 is your best price」，兩者 raw 都翻成「最低價」。原文沒有最低／底線承諾，違反已確認的 best price 規則。protected 與 HTML 原型也沒有解決這個語義問題。

較短的 best-price-not-floor 案例，兩者又都能使用最優惠價格；因此不能只用簡單的單詞測試判定規則已滿足。

### 3.3 can 不可變成不應：Translation LLM 仍有關鍵偏差

案例 modality-can-should-must 的：

> Instead of only passing on information, a sales representative can do more.

Translation LLM raw 譯為：

> 業務代表不應只是傳遞資訊，還可以發揮更大的作用。

加入「不應」，正是現行規則明確排除的責任／義務加強。NMT raw 本例使用「不僅可以……還可以」，較符合原意。不能把模型較新解讀成每個案例都較好。

### 3.4 底價、成本價及業務角色需要客製化

- price-concepts：NMT raw 把底價與基礎價格都譯為 base price；Translation LLM 能區分 floor price 與 base price。
- do-not-disclose：NMT 將議價揭露時機譯為 all at once；Translation LLM 用 right away，符合時機要求。
- alias-address：NMT raw 將 cost price 譯成「報價」，丟失成本價概念；Translation LLM raw 保留成本價。
- sales-account-owner：兩者 raw 都用「帳戶負責人」，未達指定的客戶業務負責人用詞；NMT protected 更退化為「帳戶擁有者」。銀行帳戶對照案例則應保留銀行帳戶情境，不能不分情境全域替換。

### 3.5 資料與 @ 保護不能靠原模型碰巧保留

- native-mention：兩者 raw 都將虛構中文 @ 名稱翻成英文；兩者 protected 都完全遺漏這個標記，因而被還原檢查拒絕。HTML 原型在此例保留名稱與位置。
- price-inclusion：NMT protected 損壞多個保護標記。
- ex-factory：Translation LLM protected 遺漏被保護的 Mira；直接送原文則保留。
- distinct-names：NMT raw 音譯 Kumar、Kumaran、Shan 等人名，未符合逐字保留要求；Translation LLM raw 在此例保留原名。
- HTML 原型有重複人名及位置錯配，例如把可見 Alex 放在 span 外，又在錯誤位置插入帶 Alex 的 span，已有 duplicated_person 檢查能攔下部分案例。
- 更嚴重的是 Translation LLM 的 sales-account-owner HTML 原型雖保留所有標記且機械檢查通過，還原卻變成「Mira是該客戶Mira Alex核准報價單。」；角色文字遺漏證明「標記都還在」不等於責任關係正確。
- HTML 原型把 paragraphs 的段落合成一行，並把 literal-entities 的字面 &#x20; 加入空格或改字元；需要專門的字面資料及段落處理，不能盲目解碼整段 HTML entity。

### 3.6 機械拒絕不全都是錯譯

必須把「需要指定術語」與「真的改變意思」分開：

- Translation LLM 的 bottom-line price 因現有正則只接受 bottom line（空格形式）而被拒絕，可能是驗證過窄。
- 越文 giá sàn 是需要業務／越文審稿確認的底價同義表達；目前規則只接受 giá thấp nhất 或 giá tối thiểu，因此被拒絕。不能直接把所有這類拒絕算為語義錯誤。
- 2400→2,400 數值沒有改變，但目前要求原字串保護，仍須由串接保證；USD→美元也是資料格式要求未符合，和增減金額不同。
- raw 機械檢查未涵蓋所有原值及角色，因此 CNF→含稅、can→不應等實質錯誤甚至會得到 checks=OK；本報告以具體缺陷判定不達標，不以 22/30 或 23/30 宣稱準確率。

本次不放寬正式驗證規則，也不因模型出現同義詞而直接修改已確認要求。

## 4. 現行要求逐項對照

| 現行要求 | 判斷與待補工作 |
|---|---|
| 中翻英、英翻繁中、中越雙向 | NMT 與 TLLM 官方均支援 zh-TW、en、vi 的互譯，本次四方向均能呼叫成功。 |
| 群組／私訊、權限、指令與獨立開關 | 屬 webhook 與設定層，可以沿用；更換引擎不需要重設聊天室。 |
| OK／Yes／No、單向略過及相同譯文不回覆 | 屬應用層，可以沿用；仍需在正式新介面接線後回歸驗證。 |
| 音訊逐字稿＋翻譯 | Speech-to-Text 可維持，逐字稿再送新文字引擎；本次未測真人音訊。 |
| 商務用詞、角色、否定、承諾及費用歸屬 | 兩者未全部符合；TLLM 較適合作進一步客製化候選，但必須用業務案例驗證。 |
| 數字、公式、幣別、人名、代碼與聯絡資料保護 | 需要專用前後處理及完整性檢查；現有標記不能直接視為相容。 |
| 原生 @ 與同名不同人位置 | LINE 身分及通知邏輯可沿用，但新引擎必須回傳可靠的 sourceStart→target range；兩種原型都未達整體要求，本次未向 LINE 發訊息驗收。 |
| 結構化輸出與完整性 | API 自帶 translations[] 結構，可轉成統一介面，不必要求模型生成 Gemini 格式的 JSON；仍須檢查筆數、非空、方向、長度與資料完整性。不能假設它提供相同 finishReason。 |
| 失敗靜默、後台安全診斷、同批繼續 | 應用層可沿用，但須區分網路／配額／服務錯誤與品質拒絕；SDK 錯誤不可直接輸出聊天內容。 |
| 不保存聊天、模型僅接收正文 | 可維持應用不持久化正文；評估檔只保存合成資料，真實 LINE 身分不傳翻譯 API。 |
| 2,000 UTF-16 輸入、4,500 輸出等限制 | 原文低於兩者 30,000 字元單請求上限；保護標記／HTML 會膨脹長度，必須在編碼後另檢查大小，不能只看原文。 |
| 即時性、避免漏翻 | 此短樣本延遲良好，但沒有證明長期可用率更高或不會限流；仍需錯誤分類、時限與重試設計。 |

## 5. 可行的下一階段與放行條件

建議優先驗證 Translation LLM 加上 Cloud Translation Advanced glossary（含 contextual glossary 的適用性），但本次尚未建立或實測 glossary；不能把官方支援當作本專案的達標結果。

需要完成：

1. 建立中英、中越術語與稱呼規則，對底價／成本價／出廠價、best price、account owner 提供情境對照；不要全域字串替換而破壞銀行帳戶等例外。
2. 為翻譯 API 設計資料與提及保護介面，保持數值及原生 @ 逐項身分映射；不能在譯文中搜尋相同名字推定是哪個人。丟失、重複或無法安全還原時繼續拒絕輸出。
3. 加入語氣、角色與費用歸屬的語義回歸；單靠 glossary 無法保證 can、must、未確認等整句關係，需要實測證明。
4. 釐清可接受同義詞及驗證過窄問題，經需求確認後再調整；不能為提高通過率取消重要資料檢查。
5. 以獨立未參與客製化的合成案例，再測多輪短／長文、20 處提及、Emoji、相同名字不同人、HTML entity、逾時與配額錯誤；必要時採明確授權的業務樣本。
6. 所有已知關鍵報價／角色／承諾錯誤須修正或安全攔截，同時確認拒絕率足以滿足日常使用；再完成 webhook 回歸、Node.js 22 驗證與 LINE 使用端驗收，才能考慮切換。

若要採混合引擎，還需驗證路由如何辨識高風險訊息。不能因 NMT 便宜，就在 Gemini／TLLM 失敗時直接回傳未驗證的 NMT 譯文。

## 6. 成本與維運影響

- NMT 一般文字只按輸入字元；TLLM 按輸入及輸出字元，無 Gemini 每次重送的長系統規則。
- 本次同一 30 則來源共 1,960 字元，opaque 標記後 3,844 字元、HTML 原型後 9,393 字元；因此切換後的費用不能單以原始聊天字數估算，保護設計也影響成本。
- 依當日標準價，180 次實驗的送收字元折算約 US$0.62（不含探測、稅金及 NMT 免費額度抵減），不是帳單核對值，也不是月費預估。
- 官方目前列 NMT 一般 v3 預設 6,000 requests/min、6,000,000 字元/min；TLLM 預設 900 requests/min、單次最多 30,000 字元。專案實際額度須部署前查核，且額度不等於可用率保證。
- TLLM 本身是以 Gemini 為基礎、針對翻譯調整的模型；使用 Translation API 不代表完全脫離 LLM，也不能保證沒有服務容量問題。

## 7. 重現方式與完成狀態

新增的評估程式只接受已提交的兩份合成資料檔，沒有任意客戶對話檔參數：

- [evaluate-translation-alternatives.mjs](../functions/scripts/evaluate-translation-alternatives.mjs)
- [新增 20 則合成案例](../functions/evaluation/synthetic-alternative-cases.json)
- [原有 10 則合成案例](../functions/evaluation/synthetic-trade-cases.json)

先執行 npm.cmd run build --prefix functions，再以 GOOGLE_CLOUD_PROJECT 指定專案，將短期 access token 僅放入程序環境 TRADE_EVAL_TOKEN，執行 node.exe functions/scripts/evaluate-translation-alternatives.mjs；預設測 raw,protected。TRADE_EVAL_VARIANTS=protected-html 可只測 HTML 原型。結束後移除 token 環境變數，不列印、不寫檔。

本次評估程式語法檢查、既有 TypeScript 建置與 180 次 API 試驗均完成；輔助執行環境 Node.js 24.18.0，並非新正式引擎的 Node.js 22 驗收。未修改 functions/src、未部署、未重新執行完整正式回歸套件、未做真人 LINE 通知驗收。

## 8. 官方資料（2026-09-23 查核）

- [模型比較](https://docs.cloud.google.com/translate/docs/advanced/compare-models)：NMT／TLLM 的定位與模型 ID。
- [語言支援](https://docs.cloud.google.com/translate/docs/languages)：zh-TW、en、vi 與互譯。
- [Translation LLM](https://docs.cloud.google.com/translate/docs/translation-llm)：general/translation-llm 的呼叫與回應格式。
- [translateText API](https://docs.cloud.google.com/translate/docs/reference/rest/v3/projects/translateText)：結構化回應、模型與 glossary 設定，未提供自由 system instruction 欄位。
- [Glossary](https://docs.cloud.google.com/translate/docs/advanced/glossary)：兩者均可用術語表，TLLM 另有 contextual glossary 功能。
- [HTML 文字翻譯](https://docs.cloud.google.com/translate/docs/translate-text)：API 保留 HTML 標籤的能力與限制。
- [配額與限制](https://docs.cloud.google.com/translate/quotas)：內容上限及預設請求額度。
- [資料使用](https://docs.cloud.google.com/translate/data-usage)：Cloud Translation 資料使用、短暫記憶體處理及區域限制。
- [Cloud Translation 價格](https://cloud.google.com/products/translate/pricing)：NMT US$20／百萬輸入字元；TLLM 輸入／輸出各 US$10／百萬字元。
