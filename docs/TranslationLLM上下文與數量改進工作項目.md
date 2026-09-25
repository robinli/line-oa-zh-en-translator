# Translation LLM 上下文與數量改進工作項目

日期：2026-09-24。階段：**第二輪獨立複驗已關閉原六項 High；F07 Medium 自然計價語序修正候選 candidate-context-quantity-v13 已完成648項測試、同SHA定向90/90與完整430筆回歸，等待重新獨立驗證，未部署。**

本文件是本次實作與獨立驗證的範圍契約。Planner 只建立此文件；Implementer 按 WI 順序執行；全部完成後 Verifier 從需求、原始碼、實際輸出及獨立測試重新驗證。任何 Blocking／High／Medium finding 必須交回 Implementer，修正後再驗證；不能由 Implementer 自行放行。

## 需求與基準

使用者要求延續上一輪結論：保留 Translation LLM，改善整則訊息上下文、模型對數量及單位的理解、最小必要資料保護、段落及原生提及對應，同時維持中英商務驗證。不是全面切換 NMT，也不是取消檢查來提高輸出率。

已完整閱讀 [系統規則與知識總覽](系統規則與知識總覽.md)、[原文直送翻譯比較評估](原文直送翻譯比較評估.md)，並核對現行 adapter、保護器、HTML 提及、主體守門、共用 trade-policy 及其測試。沒有 .codegraph，使用一般程式搜尋。

核對結果：

- 現行 candidate-v12 按每個換行拆成不同 contents 元素；即使一次 API 請求也不等於整則上下文。
- 一般重量被 Quantity 隨機標記取代。模型看不到 kg，可能產生「20 kg 個袋子」；冒號等標記變形也會阻擋。
- 中文「公斤」目前不屬於共用單位辨識；數字被保護、公斤留在正文，合法 kg 譯文又被共用還原器視為新增資料。
- 現有 HTML 只保護原生提及，依 occurrence id 還原 UTF-16 位置。段落整合後不能改成搜尋相同顯示名稱來猜身分。
- 目前 restoreTradeTranslationWithRanges 也用於其他引擎；不能為 TLLM 的新格式全面移除共用新增數字／單位檢查。
- 整則原文 TLLM 曾合併段落。單一 HTML 區塊方案尚未經 API 證實，必須先小規模驗證，不能當作已成立的前提。
- source/exact-format 與最終語意需分開驗證：數字全部存在不代表沒有把 FIBC 放到小袋、把毛重放到淨重或改變條件。

現有基準由 root 保存在 `.local/context-quantity-baseline-20260924/manifest.json`；正式版本仍是 linewebhook-00018-huk。本次不部署。規劃開始時 git status 僅有未追蹤 `.codex/`；所有既有檔案及評估紀錄都要保留。

## 不變條件與明確範圍

1. 引擎仍為 general/translation-llm，us-central1，原 v8 glossary；只讀 glossaryTranslations。單一入口、設定及 factory 選擇不變。
2. 中越 NMT、私訊僅 /我的ID、群組指令、Firestore、語音入口、同譯文不回覆及失敗靜默規則不變。
3. 品質失敗至多兩次品質嘗試，每次 15 秒；SDK HTTP retries 關閉，服務失敗不自行重試，不跨引擎 fallback。輸入 2,000、還原輸出 4,500 UTF-16 限制不變。
4. 保留必要姓名、提及、產品碼、聯絡資料、字面 markup/entity、算式及 Incoterm。不得改掉任何 LINE userId 或送身分映射給模型。
5. 不新增跨訊息歷史、不抓引用訊息、不做 OCR、不改原生 mention 的成員驗證與 Reply API 行為。
6. 本次可修改 TLLM 專屬 adapter／保護／HTML／語意檢查、相關測試、合成評估工具與文件；不新增新引擎、模型、外部服務或套件大升級。
7. 不改 IAM、Secret、正式 env、glossary、Cloud Run／Firebase 部署、正式 Firestore；不發真人 LINE 訊息。API 評估只能使用合成資料。
8. 所有新增與修改檔案使用 UTF-8 無 BOM、CRLF。不得覆寫現有 synthetic-tllm-v13-holdout.json 或舊審閱結果；新檔使用 context-quantity 名稱。

### 數量／單位契約

- 「模型可見」表示 API 請求包含原數字及其實際單位，不是只看見 Quantity／Value 代碼。可使用可見 HTML span 或其他經驗證的結構，但不得將可讀包裝條件整段藏起來。
- 保留每一次來源數量的紀錄，包括來源位置、原字串、正負號、小數及精度、單位／幣別、分母、百分比與可辨識的包裝角色；相同數字不可只用 Set 去重。
- 限定單位等價：kg／kgs／kilogram(s)／公斤；MT／metric ton(s)／公噸；lb／lbs／pound(s)／磅。同一組僅屬拼寫翻譯，不得跨組換算。單獨 ton(s)／噸不自動等同 MT；kg 不等於 lb、件或袋數。
- 原文有「保持原樣／不要改單位／copy exactly」時，最終保留來源的數量字串。一般情況可將已證明同一 occurrence 的等價單位還原來源格式，以延續既有字串保留規則；也可只對中文單位輸出上述明確英文等價字。必須固定規則並測試，不可依個案恣意放行。
- 既有英文單位縮寫、幣別、金額、算式、貿易縮寫的最終原樣保護不擴大放寬。本次不新增 USD↔美元、¥↔JPY/CNY 等幣別同義判斷；多義貨幣符號不得推定幣別。
- 不把 600 kg 改成 0.6 MT、不計算袋數、不求算式結果、不湊整；0.60 與 0.6 的精度亦不任意改寫。只容許既有算式運算子周圍空白的安全還原。
- 來源沒有的數字／單位、數值遺漏或重複、數字所屬物件對調均不可因數字集合相同而放行。未知單位不從換算表猜測；維持來源字串與保守檢查，將未能機械理解的關係列入有限語意守門及 API 審閱。

## 有序 Work Items

### WI-01：凍結資料契約及可重現案例

Implementer 先建立 TLLM 專屬數量紀錄／段落／精確保護的資料契約，補入失敗重現與正反對照案例；此步不調整其他引擎。

Acceptance Criteria：

- 可列出每個來源段落（含 CRLF、LF、CR、空白行、純保護值行）及每個保護 occurrence；索引以原始 UTF-16 計算。
- 數量契約符合上節；來源完整涵蓋 20kg、600 kg、20公斤、600公斤、2.5 kg、0.6 MT、20 lb、正負值、百分比、幣別／分母、重複同值及淨毛重。
- 固定既有 30 案與先前 280＋20 案的雜湊；新增數量與上下文測試不能修改舊 rubric 降低要求。
- 增加能重現 Quantity 變形、公斤→kg 誤擋、重量變袋數、段落合併及禁止計算弱化的測試輸出；每個拒絕案例有至少一個語意正確的接受對照。

預計檔案：functions/src/translation-llm-protection.ts，必要時新增 translation-llm-quantities.ts；相應 .test.ts；functions/evaluation/ 的新 context-quantity 資料。

### WI-02：整則上下文與精確結構傳輸

整則可翻譯文字以同一主要 contents 元素送出，帶有可驗證的段落及 occurrence 結構。HTML 是優先驗證的方案，不預設服務必定保留每個標籤。

Acceptance Criteria：

- 多段案例的主要 contents 包含全部原段落、原始數量與上下文；不得退回逐段翻譯後宣稱整則改善。既有引用補譯若仍需要，僅作同一有界呼叫的輔助，不可取代主要上下文或改寫已正確翻譯的引用。
- 回應還原後段落次序及來源分隔符保持原有契約（外層 trim 維持既有行為）。段落／occurrence 缺失、重複、未知 ID、混入新標籤或順序不可信時拒絕；不靠句號數猜分段。
- 原生 mention 支援重排、同名不同 occurrence、Emoji、20 處上限及英文相鄰空格；每次 sourceStart 對應唯一合法輸出 range。
- 只傳 occurrence id，沒有 LINE 身分值。原文字面 HTML/entity 完整保留，傳輸解碼僅一次，不執行原文 HTML。
- 純產品碼／保護值不新增不必要 API 呼叫；空字串及長度邊界仍有效。
- 先用不超過 8 個代表案例各 1 次的合成 API smoke 驗證結構（含兩段口語、三段、中文公斤、同名提及、literal entity）。失敗則在此 WI 內修正結構，保留每輪證據；不得繼續大批評估掩蓋失敗。此步結果不是正式語意放行。

預計檔案：translation-llm-translator.ts、translation-llm-html.ts、TLLM 專屬保護檔及測試；新評估腳本。不得更改中越 HTML 邏輯。

### WI-03：可見數值驗證、精確還原及拒絕診斷

在 TLLM 專屬還原流程，對模型可見數量執行 occurrence 與內容驗證，代替依靠不透明 Quantity 前綴猜語意；共用 business 引擎仍維持原契約。

Acceptance Criteria：

- 語意等價的中文公斤→kg 不再觸發 unprotected_trade_data；既有英文 kg／MT／幣別格式按上節保留。
- 正負號、小數、百分比、幣別、分母、重複值、單位及算式任何受保護部分的新增／遺漏／變更／換算必須拒絕；不可先覆寫來源值而掩蓋模型實際改變。
- 精確保護的名稱、產品碼、CNF／C&F／CFR 等、聯絡資料、字面 entity 必須逐 occurrence 驗證，再單次還原；不能遞迴解碼 literal token。
- 不以解析失敗為由直接接受 raw output；未知格式保守拒絕且不回退其他引擎。
- 拒絕診斷至少能區分段落結構、提及／精確資料、數量內容／單位、數量關係與語意限制。metric 僅含 reason、方向、次數、字元數及耗時，無正文、原值、回應或身分映射。
- shared trade-policy 如需新增小型工具，既有函式行為不變，並通過 business 回歸；不能用關閉共用檢查來達成 TLLM 通過。

預計檔案：TLLM 專屬 quantity／protection／html／translator 檔及測試；trade-policy.ts 只在確有必要且保持既有契約時小幅共用重構。

### WI-04：數量歸屬及商務語意守門

延續 v12 術語／主體／承諾／價格守門，新增本次已觀察的有限關係檢查。守門只拒絕有證據的不一致，不猜測或重寫交易事實。

Acceptance Criteria：

- 對明確合成句型能攔截：20kg 小袋與 600kg FIBC 對調、FIBC 被放到小袋、重量被譯成「kg 個袋子／kg 數量的袋子」、淨重／毛重互換、空袋重被納入淨重，以及相同數字對調物件造成的變更。
- 保留「小袋做不到才用大袋」、「只有拒絕小袋才用大袋／否則仍用小袋」、尚未承諾及包裝費不是運費。加入對照句，避免有條件／否定時被一律擋掉。
- do not／don't calculate/convert/change 不得弱化成無需／不必；原文本來是 not required／do not need 時應接受。與既有 without 守門共同測試，不能用全域負詞比對波及其他分句。
- 提及角色、同名主體、成本／底價／報價、included/additional、CNF 非含稅、問句及引文範圍等現有重要回歸仍成立。
- 未辨識的任意語意關係不是已被證明正確；列出機械守門涵蓋的句型及限制，交由 WI-06、Verifier 的完整語意審閱補充。

預計檔案：translation-llm-protection.ts、必要的 quantity／meaning 模組、translation-llm-subjects.ts（只有相容新資料形狀需要時）、對應測試。

### WI-05：接入 adapter 與完整離線驗證

在同一 TranslationLlmTranslator 內接入通過的小規模候選，明確更新 adapter version；不切換引擎、路由或部署。

Acceptance Criteria：

- Node.js 22 執行 check、Vitest 全部 src 測試、build 及專案 verify 成功；不得刪除舊功能斷言來追求綠燈，可將綁定舊 wire 格式的測試改成新契約斷言。
- 包含亂序／重複／未知 ID、重複數值、literal entity、字元邊界、過長輸入輸出、缺失 glossaryTranslations、兩次品質失敗、一次服務錯誤、內容隱私的注入測試。
- 對 webhook／program／factory 既有測試確認中越、群組／私訊、指令、相同譯文、靜默失敗及同批事件隔離未變；不得為這些邊界進行無關重構。
- 驗證有正確譯文可以成功輸出，而非只測錯誤全部拒絕；數量／段落／mention 的成功與失敗都能從公開 translate/translateWithRanges 行為重現。

### WI-06：固定候選的合成 API 回歸與逐句審閱

小規模結構及離線檢查通過後，凍結候選雜湊進行評估。評估腳本須捕捉最終文字、ranges、狀態、有限原因及合成 wire 證據。不同候選版本不可混算。

Acceptance Criteria：

- 至少執行：既有 280 案一輪；本次 30 案三輪；舊 v13 holdout 20 案三輪。全部資料集固定，來源／編譯檔與結果具有雜湊。
- 現行 30 案的以下 9 案三輪均須**產生可用且語意合格的譯文**：pack-rough-packaging、pack-clear-packaging、pack-zh-packaging、pack-decimal-units、pack-tentative-packaging、pack-net-gross、pack-zh-negative、pack-zh-net-gross、pack-split-paragraphs。不得把拒絕當作修復。
- 30 案每輪至少 29/30 可用；唯一預先允許持續保守拒絕的是 pack-do-not-calculate，且只在實際輸出弱化禁止語意時。它的正確譯文仍必須在離線測試通過。任何其他新增拒絕須修正後重驗，不能用總量抵消。
- 280 案至少 272/280 可用，不低於 v12 基準。既有 8 個拒絕可維持安全拒絕，或改善後以完整語意證據接受；不得關閉守門換取成功。新出現的拒絕要逐案查明，不得把正確候選遭誤擋隱藏在總數內。
- 舊 v13 的 20 案三輪仍須 60/60 可用，維持原本門檻。其已不算本次未見案例。
- 所有產生譯文皆審閱全文，任何已觀察的重大或中等語意／資料／身分錯誤都不放行；片段測試與 required/forbidden 只作提示。數字、段落、提及可機械比對；條件、角色、包裝歸屬、語氣、上下文與未知名詞須逐句評閱。
- 服務錯誤另列，不算品質拒絕或成功。可在服務恢復後以相同 frozen 候選重做受影響案例，保留首輪錯誤，不能只保留最好的模型輸出。
- 修正後重跑受影響集合；全域編碼、解碼、數量辨識或語意守門改動視為可能影響全部，須重做固定候選回歸。另保留失敗前後對照。
- 輸出率不叫準確率。報告分別列產生譯文、語意可用、保守拒絕、誤擋、未攔截錯誤、服務錯誤，清楚說明有限合成集不保證一般正確率。

既有 8 個安全拒絕基準：v6h16（引文回應範圍）、v8h11（無根據價格比較）、v9h07（提及主體）、v9h28（收到／送達）、v10h06（同名提及主體）、v11h15（可能取消變權利）、v12h14（禁止計算弱化）、v12h15（保護資料變形）。基準證據見 functions/evaluation/tllm-v12-release-review.json；不能據此推定每次拒絕均永遠合理。

預計新檔：functions/scripts/evaluate-tllm-context-quantity.mjs、functions/evaluation/tllm-context-quantity-review.json；原始合成結果可放 .local/tllm-context-quantity/，可攜審閱檔須包含完整來源、最終譯文、rubric 與結論，不能只指向本機檔案。

### WI-07：文件、差異與交付

Acceptance Criteria：

- 更新系統規則與知識總覽、對應 TLLM 說明／本次比較後續狀態及專案日誌（一筆一句）；必要時新增本次實作驗證報告。
- 清楚寫「本機開發／測試狀態、尚未部署、正式仍為原 revision」，不得修改歷史報告中當時實際結果。
- 記載最終數量等價／來源格式契約、確切有限守門、舊拒絕處理、新候選與資料雜湊、測試命令和真實數量、未執行驗收。
- 對照 root baseline，列出所有修改檔及原因、確認範圍外檔案未改；CRLF／UTF-8、git diff whitespace 及必要連結檢查通過。
- Implementer 交接 Work Items 狀態、實際改動、測試與 API 證據、已知限制；不能自行宣告獨立 Verification passed。

## 獨立 Verification 階段

Implementer 完成 WI-01 至 WI-07 後才啟動 Verifier；Planner／Verifier 不得修改 application code。Verifier 可建立獨立合成 fixture、檢查腳本及 findings 文件，不能調整正式 acceptance 或修改舊案例 rubric。

Verifier 必須從原始需求及本文件逐 AC 檢查，不以 Implementer 的完成勾選或審閱結論作證據：

1. 讀取實際 diff、資料流及 root baseline，獨立執行 Node 22 verify，檢查範圍與保密契約。
2. 對關鍵負例直接注入模型回應測試；需獨立構造數值正確但物件錯配、條件反轉、unit/count 混淆、段落合併、同名 mention 互換、entity 二次解碼等案例。只回放 Implementer 的 happy path 不足。
3. 凍結候選後建立至少 20 個新、未用於開發的合成雙向案例，涵蓋粗糙多段包裝、不同數量、重複值、淨毛重、否定／條件、提及與單位邊界；每案有可核對的 rubric，至少三輪 API 評估。
4. 新案例每輪至少 19/20 可用，所有核心包裝／單位／段落／原生提及案例必須三輪可用；若是故意構造不合法輸入，應另外列入安全負例，不混入有效案例輸出率。不得觀察結果後更改核心標記。
5. 所有提供給使用者的譯文中，零已觀察未攔截 Blocking／High／Medium 問題；獨立核對 WI-06 的全量來源／譯文、拒絕理由與資料雜湊，不只讀摘要。
6. 新 holdout 發現問題後交回修正，該案例轉回歸；修正完成重驗所有受影響 AC。若修改了候選行為，保留原始 finding 與重驗證據，不能仍稱相同測試集為「未見」。需要新鮮度的最終驗證另增加至少 5 案，內容依實際修正風險決定。
7. 獨立報告每個 finding 的等級、檔案／行號或案例、重現、預期與實際、AC 關聯、修正後狀態。任何未解 Blocking／High／Medium 或缺少核心驗收證據都不能判定完成。

此階段不需部署或真人通知來完成開發 AC；兩者屬另行正式驗收。若外部 API 持續不可用，應明示相關 AC 未完成，不能以 mock 代替真實模型品質結論。

## 預期受影響檔案與剩餘風險

- 主實作：functions/src/translation-llm-translator.ts、translation-llm-protection.ts、translation-llm-html.ts，以及必要的新 TLLM quantity／meaning 小型模組。
- 相容調整：translation-llm-subjects.ts 及 trade-policy.ts 僅在新資料表示確有需要、維持其他引擎契約時修改。
- 測試：上述對應 .test.ts；既有 webhook／program／factory 測試原則上只執行，不做無關改寫。
- 評估：新 context-quantity 腳本、fixture、review；舊資料及報告保留。
- 文件：本文件、系統總覽、本次實作／評估報告、專案日誌；更新實際狀態不虛報部署。

主要剩餘風險：HTML／glossary 的模型輸出可能變動；有限語意守門無法證明所有未知句型；未知姓名與單位仍需要實際審閱；合成三輪不是獨立統計準確率；LINE 真實顯示及通知尚未驗收。本次不可藉這些限制取消明確測試門檻，也不能宣稱通過後完全不會漏翻。

**第二輪獨立 Verifier 已關閉原 CQV-F01～F06 六項 High 重現，另提出 CQV-F07 Medium 自然計價語序誤擋；目前 Implementer 修正候選 candidate-context-quantity-v13 已完成648項測試、同SHA定向90/90及全量430，F07三輪均正常回覆每箱／每袋計價，交回依原 AC 重新獨立驗證，另建至少5個未見案例。**

第一輪證據：[本次實作驗證報告](TranslationLLM上下文與數量實作驗證.md)、[完整可攜逐句審閱](../functions/evaluation/tllm-context-quantity-review.json)。本次只更新階段與證據，原驗收門檻及獨立驗證責任不變。

本輪修正記錄：[修正驗證報告](TranslationLLM上下文與數量修正驗證.md)；原[獨立發現](TranslationLLM上下文與數量獨立驗證.md)保留，Implementer 不自行關閉 finding。

本輪F07修正：[修正驗證報告](TranslationLLM上下文與數量F07修正驗證.md)及[新候選完整可攜證據](../functions/evaluation/tllm-context-quantity-f07-review.json)。原第二輪[獨立複驗](TranslationLLM上下文與數量獨立複驗v11.md)與F07 Open結論保存，Implementer不自行標為獨立通過。
