# Translation LLM 上下文與數量：獨立 Verification findings

日期：2026-09-24。對象：candidate-context-quantity-v6。結論：**Changes required**。

本次在 Planner、Implementer 完成並停止修改後獨立執行；未修改 application code、未部署、未改 IAM／env／Secret／glossary／Firestore、未發真人 LINE。以下全部六項 High 均未解，不能宣告開發驗收完成。正式仍為既有版本；本次未另查詢正式環境。

## 證據與執行結果

- [完整獨立審阅與注入證據](../functions/evaluation/context-quantity-independent-verification.json)：430 筆既有來源／最終輸出／ranges／獨立結論、20 新案例三輪的完整 request／response／metrics、40 個正反注入結果及 11 個邊界／對照結果。
- [凍結新合成 fixture](../functions/evaluation/synthetic-context-quantity-verifier-holdout.json)：SHA-256 `8554f3bd491706f8f11af74b6574ee2c1c30c6cf044478064edd75663a6d83bd`。20 案、14 核心、雙向；核心標記和 rubric 在 API 前固定。只用虛構資料，郵件為 example.com，沒有 LINE 身分值。
- 新 API 原始檔 `.local/tllm-context-quantity-verifier/holdout-2026-09-24T04-38-47-096Z.json`：SHA-256 `10fe55fda9e847fae553424e165f99552122e0be567ed85f992f823fd4027c13`。63 次 API 請求，60 個邏輯結果，無服務錯誤；cqv04 每輪一次品質重試，未重挑成功輸出。
- 被覆核的舊可攜檔 SHA-256 `6bfa74b68999772dc6e9c29cf7ea71c51644628e3470b64033b4edce3a0d41ba`；7 組 source／compiled SHA 均與重建後檔案一致。adapter source `8264986e300d83415d3aed48fcf17257ce2dc6cae167f2fef5a5c4438a2c28e1`，compiled `77211955bf90647ef9c8a136872dc95794c9abbc6cc6076f65fff3bbc4e62553`。
- Node.js 22.23.2 獨立執行 verify：check、22 files／536 tests、build 全通過，程序 exit 0；這只證明既有自動化檢查通過，不是本次品質放行。
- 注入 20 組正反對照：20 個正確譯文全通過；20 個錯譯中 15 個被攔截、5 個未攔截。另 11 個長度、glossary 分支、service error、mention 數、隱私及正確登記／備案對照全通過。

| 資料集 | 產生譯文 | 獨立判定可用 | 最終安全拒絕 | 未攔截 High | 服務錯誤 |
|---|---:|---:|---:|---:|---:|
| 舊 280 一輪 | 272/280 | 272/280 | 8 | 0 | 首次 1 筆 401，保留後同 SHA 續跑 |
| 原 30 每輪 | 29/30 | 29/30 | 每輪 1 | 0 | 0 |
| 舊 v13 三輪 | 60/60 | 60/60 | 0 | 0 | 0 |
| 新 20 每輪 | 20/20 | **19/20** | 0 | **每輪 1** | 0 |
| 新核心 14 三輪 | 42/42 | **39/42** | 0 | **3** | 0 |

全 430 筆已逐句閱讀，11 個拒絕也閱讀全部 attempts；不是依 Implementer 的 decision 放行。舊 9 核心為 27/27；八個回歸拒絕是 v4h19、v6h16、v8h11、v9h07、v9h28、v10h06、v11h15、v12h14，都有實際錯譯／資料毀損。相較舊 v12，新增 v4h19 拒絕合理，v12h15 的佣金／運費與付款責任已正確。pack-do-not-calculate 三輪均實際變成「無需計算」，符合唯一允許持續拒絕的條件。全部 431 原始紀錄對應到 430 邏輯結果，首次 401 未刪除，也未以不同候選混算。

新 cqv04 首次因 1250／1256 變成 1,250／1,256 被拒絕，符合固定原數字格式契約；重試結果正確保留重量歸屬，但 `1250kgand`／`6kgand` 缺空格列為 Low 可讀性瑕疵。cqv19 的 per ton → 每噸未推定公噸／MT；這是人工全文判讀，不是擴充單位等價表。

## CQV-F01 — High：備案變成已登記規格

- 狀態：Open。案例 `cqv11`，三輪全部；相關位置 [context-meaning](../functions/src/translation-llm-context-meaning.ts) 第 89–101 行的中文→英文有限條件守門，沒有涵蓋此已觀察備案關係。
- 來源（分隔符依序為 CRLF、CR、LF）：`📦 @Pico請確認14公斤小袋。\r\n\r請保留小袋方案。\n備案是560公斤 FIBC 大袋。`
- 三輪實際末段均為 `The registered specification is 560kg FIBCs (bulk bags).`。原始 glossary 回應也是 registered specification；每輪只有一次請求，metric 為 success，並非後處理或重試選出的句子。
- 預期：末段須表達 fallback／alternative，不能添加「已登記規格」事實。這同時丟失備案關係並增添登記事實，可能讓讀者把替代方案當成既定規格。
- 正確對照：相同完整來源注入 `The fallback is 560kg FIBC bulk bags.` 可成功；獨立來源 `登記的規格是560公斤 FIBC 大袋。` 注入真正 registered specification 也成功。修正不能全域禁止 registered 或把合法登記語境強行改成 fallback。
- AC：WI-04 第二點（備案／承諾）、Verification 第 4 點（所有核心三輪可用）、第 5 點（零未攔截 High）。19/20 一般門檻不能抵消核心失敗。

## CQV-F02 — High：數量與同名原生提及的歸屬可互換

- 狀態：Open。注入 `quantity-object-swap`；[context-html](../functions/src/translation-llm-context-html.ts) 第 88–92 行以數值匹配回 token，[context-meaning](../functions/src/translation-llm-context-meaning.ts) 第 37–46 行只核對有限重量角色。
- 來源：`@Nora has confirmed 15 kg; @Nora has not confirmed 45 kg.`，兩個原生 occurrence 的 sourceStart 為 0、27，各長 5。
- 預期：第一位已確認 15 kg，第二位未確認 45 kg。正確對照成功且兩個 sourceStart 唯一還原。
- 實際：注入 `@Nora已確認45 kg；@Nora尚未確認15 kg。` 第一回合即 success；數字、提及 ID 及狀態都存在，重量卻改到另一人。現有 mention 主體守門只檢查狀態，沒有把狀態物件／數量綁到 occurrence。
- AC：數量契約最後一點、WI-03 第二點、WI-04 第一點及 Verification 第 2／5 點。應在相同數值集合下仍辨識已明確觀察的歸屬錯配，同時允許真正的語序重排。

## CQV-F03 — High：only-if 條件接受否定反轉

- 狀態：Open。注入 `condition-negated-reject`；[context-meaning](../functions/src/translation-llm-context-meaning.ts) 第 84 行。
- 來源：`Use 600 kg FIBC bags only if the buyer rejects the 20 kg bags. Otherwise, keep the 20 kg bags.`
- 正確對照：`只有買方拒絕20 kg袋子時才使用600 kg FIBC袋；否則保留20 kg袋。` 成功。
- 實際錯譯：只在拒絕前插入「不」：`只有買方不拒絕20 kg袋子時才使用600 kg FIBC袋；否則保留20 kg袋。` 仍第一回合 success。正規式搜尋拒絕子字串，未核對局部否定；使用大袋的條件完全反轉。
- AC：WI-04 第二點、Verification 第 2／5 點。修正须比較對應條件的極性，不能靠任意位置出现「拒絕」或「否則」作證。

## CQV-F04 — High：明確禁止改成要求執行仍放行

- 狀態：Open。注入 `prohibition-removed`；[context-meaning](../functions/src/translation-llm-context-meaning.ts) 第 68–82 行。
- 來源：`Do not convert the units; you do not need to calculate the number of bags.`
- 正確對照：`不要換算單位；無需計算袋數。` 成功。
- 實際：`請換算單位；無需計算袋數。` 第一回合 success；變成要求做原先禁止的動作。現有邏輯僅在譯文含「無需／不必…」時檢查，整個禁止丟失或正向要求並不觸發。
- AC：WI-04 第三點、Verification 第 2／5 點。須保留禁止的動作與物件，並繼續接受另一分句真正的免除義務；without 的正反對照也已獨立通過。

## CQV-F05 — High：第二次品質嘗試可跨段挪動數量

- 狀態：Open。注入 `retry-paragraph-quantity-swap`；[context-html](../functions/src/translation-llm-context-html.ts) 第 58–66 行。
- 來源：`The first order uses 17 kg bags.\nThe second order uses 680 kg bags.`
- 正確對照：`首筆訂單使用17 kg袋子。\n第二筆訂單使用680 kg袋子。` 成功。
- 實際：第一次將 p0／p1 的重量互換，因來源段落限定而拒絕；第二次 adapter 改用可見 span。將 o1(680 kg)放進p0、o0(17 kg)放進p1，ID與內容都沒改，卻成功輸出 `首筆訂單使用680 kg袋子。\n第二筆訂單使用17 kg袋子。`
- 原因：raw-visible 分支第 88 行核對 sourceParagraph；inlineSpan 分支只有 ID／內容／唯一性，未核對數量來源段落。兩次品質嘗試的安全契約不一致。
- AC：WI-02 第二點、WI-03 第二點、Verification 第 2／5 點。不能以第一次拒絕證明第二次仍安全。

## CQV-F06 — High：未知計價分母從袋改成箱仍放行

- 狀態：Open。注入 `denominator-bag-carton`；[context](../functions/src/translation-llm-context.ts) 第 13–16、24–25 行，[context-html](../functions/src/translation-llm-context-html.ts) 第 99–107 行。
- 來源：`The packaging charge is USD 8/bag.`
- 正確對照：`包裝費為USD 8/袋。` 成功。錯譯 `包裝費為USD 8/箱。` 也第一回合 success，改變實際計費單位。
- ledger 僅保護 USD 8，因 bag 不在三組重量／既有縮寫單位中，`/bag` 未納分母紀錄；鄰界只確認 `/` 還在，不能證明分母對應。已知 `/MT`→`/kg` 的同型負例則有被拒絕。
- AC：數量／單位契約（分母、未知單位保守檢查）、WI-01 第二點、WI-03 第二點及 Verification 第 2／5 點。這不要求擴充 kg／MT／lb 機械換算表；應維持未知分母原字串的精確保護或可核對的有限語意判斷。
- 另保留初始注入紀錄：自然語序 `每袋USD 8` 與 `每箱USD 8` 都因 slash 邊界而拒絕。最終上列正反對照保留 slash，已排除格式差異干擾，不將初始負例拒絕誤報為分母安全。

## 逐 Acceptance Criteria 核對

序號依工作項目原有 bullet 順序。Pass 僅表示該列已取得證據；不抵消其他列 Fail。

| AC | 狀態 | 獨立證據／限制 |
|---|---|---|
| WI-01.1 段落／UTF-16／occurrence | Pass | ledger 測試、混合換行及20提及邊界；來源可逆重組。 |
| WI-01.2 數量契約完整 | Fail | 指定重量／符號精度可記錄；未知計價分母 F06 未完整記錄／驗證。 |
| WI-01.3 舊資料與rubric固定 | Pass | baseline、13資料集SHA、舊v13均未變。 |
| WI-01.4 已知失敗與接受對照 | Pass | 既有與獨立正反例均已執行；未刪除旧資料。 |
| WI-02.1 同一主要contents | Pass | 所有新多段 request 首元素完整；auxiliary僅在同一呼叫。 |
| WI-02.2 結構／段落可信 | Fail | 缺失、亂序、未知div拒絕，但F05重試span可跨段錯配。 |
| WI-02.3 mention重排／range／20處 | Pass | 同名status swap拒絕、合法reorder測試、20/21邊界與Emoji；數量歸屬另見F02。 |
| WI-02.4 不傳身分／literal單解碼 | Pass | 注入私隱sentinel、nested entity正反對照、真API literal三輪。 |
| WI-02.5 純保護值及長度 | Pass | PP-BK無API，2000／2001及4500／4501公開adapter邊界。 |
| WI-02.6 小規模smoke先行 | Pass | 03:14:07 7案全output，前次smoke拒絕保存；早於03:30全量。每輪不超過8案。 |
| WI-03.1 公斤→kg合法及來源格式 | Pass | cqv02/04/06/10/11/13、舊核心三輪與單位正反例。 |
| WI-03.2 數量全部資料／歸屬 | Fail | F02／F05／F06；其他符號、精度、幣別、MT分母變更有拒絕。 |
| WI-03.3 精確資料逐筆單還原 | Pass | literal／名稱／代碼／聯絡／Incoterm既有回歸與ID注入。 |
| WI-03.4 解析失敗無raw fallback | Pass | 嚴格解碼、缺glossary分支兩次拒絕、無其他引擎呼叫。 |
| WI-03.5 有限原因且metrics私隱 | Pass | paragraph/exact/quantity/relation/restriction原因；metrics無正文、ID或SDK細節。 |
| WI-03.6 shared trade-policy不變 | Pass | baseline SHA相同，business及完整verify通過。 |
| WI-04.1 包裝／重量歸屬 | Fail | 已知FIBC、net/gross、label對照攔截，但F02仍允許明確人物數量錯配。 |
| WI-04.2 條件／備案／承諾／費用 | Fail | F01真API與F03注入；其他原核心及packing-fee回歸正確。 |
| WI-04.3 禁止與免除義務 | Fail | F04；原do-not與without弱化案例被攔截不足以涵蓋禁止丟失。 |
| WI-04.4 既有重要語意回歸 | Pass | 430全文及所有拒絕，舊v13 60/60；未知關係不推定通過。 |
| WI-04.5 有限範圍與人工審阅 | Pass | 文件明列限制；本次全文審閱另發現F01，须交回修正。 |
| WI-05.1 Node22完整verify | Pass | 536／22 check+test+build；實際diff為wire更新，既有行為斷言仍在。 |
| WI-05.2 邊界／錯誤／隱私注入 | Pass | 40+11獨立注入與既有測試；找到的失敗仍列Open，沒有假裝全綠。 |
| WI-05.3 範圍外流程不變 | Pass | webhook/program/factory等SHA未變，完整測試通過，未做無關重構。 |
| WI-05.4 公開API正反對照 | Pass | 20組good全成功，bad按實際15攔截／5未攔截列示。 |
| WI-06.1 固定430真API/SHA | Pass | 280+90+60完整，7source/compiled、13dataset及raw證據對應。 |
| WI-06.2 舊9核心三輪 | Pass | 27/27有輸出且本輪全文審閱可用。 |
| WI-06.3 原30每輪29及唯一拒絕 | Pass | 每輪29；do-not實際無需計算，拒絕合理且離線正確對照可用。 |
| WI-06.4 舊280至少272 | Pass | 272；新增拒絕v4h19未含運費→freight有證據，不是誤擋。 |
| WI-06.5 舊v13三輪60 | Pass | 60/60，不列為新未見集。 |
| WI-06.6 全文語意審阅 | Pass（該固定集） | 419輸出及11拒絕完整審閱；新holdout另有High，故整體不放行。 |
| WI-06.7 服務錯誤保留 | Pass | 401首輪+同SHA續跑，無成功重抽；新holdout零服務錯誤。 |
| WI-06.8 修正重跑與歷史保存 | Pass（交接候選） | v6固定全量及此前失敗保存；本次修正後仍須重跑，不能沿用此項作未來證據。 |
| WI-06.9 分開輸出/可用/拒絕 | Pass | 本報告分列；新20輸出率100%仍未通過核心品質門檻。 |
| WI-07.1 文件入口/日誌 | Pass | 已更新總覽、比較後續及日誌，沒有改寫歷史結論。 |
| WI-07.2 本機/正式狀態 | Pass | Implementer文件未自稱Verifier passed或已部署。 |
| WI-07.3 契約/限制/SHA/命令 | Pass | 有明確單位與per-ton人工範圍；本次發現補列於本報告。 |
| WI-07.4 baseline/格式/scope | Pass | 120原檔僅6改動均在範圍；新檔均CRLF、UTF-8無BOM，diff whitespace检查。 |
| WI-07.5 交接與独立責任 | Pass | 本次從原需求獨立核對，未依完成勾選放行。 |
| Verification-1 | Pass | 獨立diff／資料流／baseline／Node22／privacy。 |
| Verification-2 | Fail | 所需對抗測試已完成，5個錯譯仍未攔截。 |
| Verification-3 | Pass | API前凍結20新雙向案、14核心，三輪60结果完整。 |
| Verification-4 | Fail | 每輪19/20一般門檻達標，但核心cqv11三輪不可用。 |
| Verification-5 | Fail | 1真API＋5注入High，零未攔截High要求未達。 |
| Verification-6 | Pending | 案例轉回歸；修正後依影響重跑，最終另增至少5未見案。 |
| Verification-7 | Pass | 本報告逐項等級、位置、重現、預期／實際、AC與Open狀態。 |

## 範圍、重現與交接

相對 root 的120檔 baseline，僅 `translation-llm-protection.ts`、`translation-llm-translator.ts`、相應舊test，以及總覽／比較／日誌三文件內容改變，與Implementer交接一致；其餘既有檔案SHA不變。Verifier另新增本報告、新fixture、三個scripts與獨立review，沒有修改src。新工具只在本機注入或把凍結合成資料送既有翻譯API，無自我放行邏輯；注入腳本程序exit 0表示執行完成，實際成功與失敗以逐筆`passed`與本報告判斷。

在已指定Node22的PATH下重現：

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" --prefix functions run verify
# 每步檢查 $LASTEXITCODE；verify失敗不得繼續用舊lib評估。
node functions/scripts/verify-context-quantity-independent.mjs --audit
node functions/scripts/verify-context-quantity-independent.mjs
node functions/scripts/verify-context-quantity-boundaries.mjs
node functions/scripts/evaluate-context-quantity-verifier.mjs --dry-run
```

API命令是最後一行移除`--dry-run`，只在程序環境提供暫時`TRADE_EVAL_TOKEN`。本次由ADC取得token，不印出、不寫入檔案，結束後移除；单worker開始間隔至少2.5秒。候選或fixture不同就拒絕啟動；未自動重跑成功案例。舊430不重打API，以完整凍結原始結果核對，新增20才是真正未見API評估。

交回 Implementer 一次修正六項High；保留本次原始結果與失敗對照。應讓正確備案、真實登記語境、允許語序重排、來源本來的not-required、不變格式和服務邊界繼續可用，不能增加格式空子或以全部拒絕規避語意問題。變更數量辨識／解碼或全域語意守門後，依原WI重做受影響固定候選回歸；本次20案已轉回歸，最終另加至少5個依修正風險設定的新未見案。Verifier本輪工作結束，停止修改，等待root安排Implementer修正後再驗。
