# Translation LLM 上下文與數量：第二輪獨立複驗

日期：2026-09-24。候選：candidate-context-quantity-v11。結論：**Changes required**。

原 CQV-F01～F06 六項 High 的原始正反重現已修復。新 CQV-F07（Medium）尚未修復：正確的自然計價語序被拒絕，新核心案例三輪均無實際輸出，不能完成開發驗收。Verifier沒有修改 application code、舊fixture或前輪證據；未部署、未改服務設定、未發真人LINE。正式仍為原 linewebhook-00018-huk／candidate-v12；本輪沒有再次查詢正式環境。

## 獨立證據與結果

- [完整可攜複驗](../functions/evaluation/context-quantity-independent-reverification-v11.json)：包含固定430全部原始attempts/来源/最終文字/ranges/獨立判定、定向130（包括原20三輪60及修正對照12）、新18全部原始請求回應、40原正反、11邊界及11新增本機對照。SHA-256：cc363339f336a7a1f74f8bc5470f57aafae47be4a8bf7bcbad628e6db9a659d1。
- [本輪六個新案例](../functions/evaluation/synthetic-context-quantity-verifier-fresh-v11.json)：6案全部預先標為核心、雙向、三輪；2026-09-24T06:14:19.917Z凍結，首次API開始06:14:54.345Z。SHA-256：38d27bae3694abdaa0698d9191009aa267908478f534c4f7dd8535bd6e628fa4。它們在API前與既有合成來源比較，沒有相同來源；未觀察結果後調門檻。
- 新原始API：.local/tllm-context-quantity-verifier-v11/holdout-2026-09-24T06-14-54-345Z.json。18邏輯結果、21次請求、0服務錯誤；只傳合成fixture，单worker每次開始間隔至少2.5秒，15秒timeout，暫時token只留程序環境且最後移除。
- 獨立 Node.js 22.23.2：check、23 files／608 tests、build及verify exit 0。先verify成功再評估；沒有用舊compiled假驗新source。
- adapter source SHA：ef71ba4704b0d3b99624039a90eaea308910cf1a8152d17649ca22dded86904e；compiled SHA：e2b39534a2f37366919e199c94ebc9a1aeb5b24b14b26bc6d786947a760b1061。全部7模組、資料集雜湊、兩批raw與可攜檔逐項一致；全部段落及native ranges機械比對沒有差異。
- 固定全量raw SHA：e9ce4084d131b5c41345eb4085fbc7f7f9a770cbb803f06c4698f2deb90ca10c；定向130 raw SHA：cebe4e33205dc07fce3b21c1a4b38bd44bc93bc0195afca5bc8babac0005fe43。Implementer portable SHA：99457722f49a1c4043a927fd2f56837f462230f03fcdeaa934c4c8e26a28b8b4，只用於核對證據，不採其decision為本次結論。

| 集合 | 邏輯結果 | 實際輸出／獨立可用 | 安全拒絕 | 誤擋 | 服務錯誤 |
|---|---:|---:|---:|---:|---:|
| 固定280 | 280 | 272／272 | 8 | 0 | 0 |
| 原30三輪 | 90 | 87／87，每輪29/30 | 3 | 0 | 0 |
| 舊v13三輪 | 60 | 60／60 | 0 | 0 | 0 |
| 原Verifier20轉回歸 | 60 | 60／60；核心42/42 | 0 | 0 | 0 |
| 真登記/備案12對照 | 12 | 12／12 | 0 | 0 | 0 |
| 新6核心三輪 | 18 | **15／15；每輪5/6** | 0 | **3** | 0 |

定向130另含58個受影響舊案例診斷，54可用/4安全拒絕；與固定430分開記錄，不混算門檻。舊9核心三輪27/27。全部430與130均逐句讀完，所有拒絕均讀兩次原始回應，沒有用數字集合或required/forbidden代替語意審閱。全量11拒絕：v4h19、v6h16、v8h11、v9h07、v9h28、v10h06、v11h15、v12h14及pack-do-not-calculate三輪，仍有實際關係、主體、引文、否定或資料錯誤；逐案理由見完整可攜檔。v9h07是後半句主體被改為we can ask，並非英文hasn’t縮寫本身不支援。

## 六項原 High 的修正後狀態

原始來源、錯譯及AC詳見保留的[第一輪獨立報告](TranslationLLM上下文與數量獨立驗證.md)。本輪重放來源與原正反內容相同；並非使用Implementer自己的通過旗標。

| Finding | 狀態 | 本輪獨立證據 |
|---|---|---|
| F01 備案變登記 | 原問題 Resolved | cqv11三輪末段均為 The alternative is a 560kg FIBC bulk bag.；明確備案只在來源窄條件改成替代方案。原registered specification錯譯兩次均packaging_fallback_changed；正確fallback首輪及強制第二次都成功。真登記/filing/非包裝/替代方案12真API均正確；fresh01三輪也保留not registered。位置context-meaning.ts:111–114、context.ts:42–45。 |
| F02 原生人物數量互換 | 原問題 Resolved | quantity-object-swap正確15/45可用；錯45/15兩次mention_quantity_changed。完整clause重排及同值對照測試通過，fresh02/06三輪保持來源occurrence及數量。位置context-meaning.ts:20–30；只適用有限明確status，不把請求賓語當收件者數量。 |
| F03 only-if局部否定 | 原問題 Resolved | condition-negated-reject正例成功；不拒絕負例兩次packaging_condition_changed。fresh03的來源本來not reject三輪正確保留不拒絕。位置context-meaning.ts:99–105。 |
| F04 禁止變正向要求 | 原問題 Resolved | prohibition-removed正例成功；請換算/無需算袋負例兩次action_restriction_weakened，另一分句真免除義務仍可用。fresh04三輪請勿將kg改MT/無需總重保持。位置context-meaning.ts:81–97。 |
| F05 retry跨段挪量 | 原問題 Resolved | 原17/680正例成功；跨段錯配第一次及可見span重試均quantity_paragraph_changed，沒有第二次空子。位置context-html.ts:65–66。 |
| F06 bag分母改箱 | 原問題 Resolved；另見F07 | 原USD8/bag→USD8/袋成功，→USD8/箱兩次price_denominator_changed。額外紙箱/袋slash錯換負例也拒絕。位置context.ts:30–40、context-html.ts:101–113；自然語序誤擋屬新F07，不能因原安全負例通過就忽略。 |

原40正反全部符合預期（20正例成功、20錯例拒絕），11邊界全部通過。新11本機對照中9符合預期、2個正確自然語序被拒絕；其中F01共3個對照涵蓋首輪、錯譯兩次及正確重試。

## CQV-F07 — Medium：自然「每分母＋金額」被錯誤拒絕

狀態：**Open**。真API核心案例cqv11f05，三輪完全重現；另有2個明確詞義正例。對應WI-05.4、Verification-4/6/7，以及使用者本輪明確確認。主要位置：[context-html.ts](../functions/src/translation-llm-context-html.ts) 第101–113行；[context.ts](../functions/src/translation-llm-context.ts) 第37–40行。

來源（中間為LF）：

> The charge is USD 9.50/carton.
> The charge is USD 2.40/bag.

三輪每次的兩個原始glossary回應都相同（span分別o0/o1完整保留）：

> 費用為每箱USD 9.50 。
> 費用為每袋USD 2.40 。

實際結果：每轮先品質拒絕，重試後仍price_denominator_changed，沒有譯文交給呼叫端。21請求中這一案佔6請求，不存在HTTP失敗或重抽。

使用者已明確確認「每箱 USD 9.50／每袋 USD 2.40」可接受。此確認解決本例carton→箱的語意判定；報告依此將raw回應判為可用語意，但**沒有將被拒絕的raw算作實際輸出**。這不容許bag↔box任意互換、金額或貨幣更改，也不取消段落與occurrence契約。即使不使用「箱」這個較一般的词，獨立注入的明確「紙箱」也誤擋：

| 來源 | 注入譯文 | 預期 | v11實際 |
|---|---|---|---|
| The charge is USD 9.50/carton. | 費用為USD 9.50/紙箱。 | 可用 | 成功 |
| 同上 | 費用為每紙箱USD 9.50。 | 可用 | 兩次拒絕 |
| 同上 | 費用為每袋USD 9.50。 | 拒絕（分母錯換） | 兩次拒絕 |
| The charge is USD 9.50/bag. | 費用為USD 9.50/袋。 | 可用 | 成功 |
| 同上 | 費用為每袋USD 9.50。 | 可用 | 兩次拒絕 |
| 同上 | 費用為每紙箱USD 9.50。 | 拒絕（分母錯換） | 兩次拒絕 |

原因：externalPricingDenominator只從金額token之後辨認以slash開頭的suffix；自然中文把分母放到金額前方就讀不到。後續鄰界檢查也將原slash的位置視為受保護邊界。這些檢查能阻止原F06錯換，但同時拒絕詞義與數值歸屬正確的自然語序。修正需保持逐occurrence的價格—分母與段落對應、正反例及copy-exact契約，不能以刪掉分母或slash檢查達成可用。

影響：所有新核心必須三輪實際可用，這一案0/3造成15/18而非18/18，違反不可事後降核心標記的門檻。判為Medium是因為合法內容被靜默省略，未把錯誤金額送出；不能因是安全fail-closed而降為無須處理的Low。

## 逐AC矩陣

序號仍依原工作項目bullet，沒有重訂門檻。個別Pass不抵消F07與核心Fail。

| AC | 狀態 | 獨立證據／限制 |
|---|---|---|
| WI-01.1 段落／UTF-16／occurrence | Pass | 段落 ledger、UTF-16及occurrence；v11混合換行、20提及上限與所有ranges核對。 |
| WI-01.2 數量契約完整 | Pass | 數量原值／符號／精度／單位／貨幣／分母／同值均記錄；新增externalDenominator，F06原錯換已拒絕；自然語序可用性另見F07。 |
| WI-01.3 舊資料與rubric固定 | Pass | 原13資料集及前輪20 SHA不變；全部raw與候選SHA一致。 |
| WI-01.4 已知失敗與接受對照 | Pass | 已保留舊失敗正反例；原40注入及原F01新重放均有可用正確對照。 |
| WI-02.1 同一主要contents | Pass | 全部多段主要contents完整；數量實際可見，quoted auxiliary不取代主要訊息。 |
| WI-02.2 結構／段落可信 | Pass | F05首輪與重試均拒絕跨段數量；全API輸出分隔符機械比對無差異。 |
| WI-02.3 mention重排／range／20處 | Pass | 原同名重排、status/數量對應及20/21邊界通過；cqv09/10、fresh02/06全部sourceStart唯一。 |
| WI-02.4 不傳身分／literal單解碼 | Pass | 全部literal、新fresh06與二次decode注入；request/metric無身分sentinel。 |
| WI-02.5 純保護值及長度 | Pass | 純碼0call，2000/2001輸入、4500/4501輸出均獨立通過。 |
| WI-02.6 小規模smoke先行 | Pass | 前輪已通過的小規模結構smoke保留；v11未更改整則結構方案，修正前定向API130保留。 |
| WI-03.1 公斤→kg合法及來源格式 | Pass | 公斤→kg已實際可用；copy-exact cqv13三輪保持7.50公斤，英文縮寫/貨幣不放寬。 |
| WI-03.2 數量全部資料／歸屬 | Pass | 原數值精度/正負/分母/數量物件/段落錯配負例全拒絕；F07為正確語序誤擋而非錯換放行。 |
| WI-03.3 精確資料逐筆單還原 | Pass | 逐ID驗證及單次literal還原；固定聯絡碼/Incoterm與fresh06均正確。 |
| WI-03.4 解析失敗無raw fallback | Pass | unknown/missing/reordered結構及缺glossary分支兩次拒絕；無raw/NMT fallback。 |
| WI-03.5 有限原因且metrics私隱 | Pass | reason分數量/分母/段落/mention/語意；metrics及sanitized錯誤無正文或身分。 |
| WI-03.6 shared trade-policy不變 | Pass | trade-policy source/compiled SHA與baseline相同；完整business回歸通過。 |
| WI-04.1 包裝／重量歸屬 | Pass | 40原注入含FIBC/net/gross/empty/label/mentionquantity；六核心新案其餘15輸出未錯配。 |
| WI-04.2 條件／備案／承諾／費用 | Pass | F01備案與F03條件反轉原錯例均两次拒絕；舊核心27、新negative condition三輪、真登記12對照可用。 |
| WI-04.3 禁止與免除義務 | Pass | 原F04、without、真not-required正反通過；fresh04禁止改單位和不必算總重三輪正確。 |
| WI-04.4 既有重要語意回歸 | Pass | 全文430＋定向130已逐句審閱；舊v13=60/60，主體/價格/收貨/引文等11拒絕有原始錯誤證據。 |
| WI-04.5 有限範圍與人工審阅 | Pass | 有限明確status、role、only-if局部極性、禁止動作等限制如實列出；自由每噸/per ton由人工覆核。 |
| WI-05.1 Node22完整verify | Pass | Node22 check、608 tests/23files、build、verify全部exit0；舊測試變更為wire適配，未刪語意行為要求。 |
| WI-05.2 邊界／錯誤／隱私注入 | Pass | 40原注入、11邊界、11本輪修正/分母對照全部已執行；其中兩自然正例誤擋明列F07，不粉飾全過。 |
| WI-05.3 範圍外流程不變 | Pass | webhook/program/factory/中越/Firestore等baseline不變，相關完整測試通過。 |
| WI-05.4 公開API正反對照 | Fail | 原六finding正例均可用，但本輪每紙箱/每袋自然語序正例被兩次拒絕，F07。 |
| WI-06.1 固定430真API/SHA | Pass | 固定v11完整430：280+90+60，raw/SHA/資料集全部對應；未混入舊候選。 |
| WI-06.2 舊9核心三輪 | Pass | 舊9核心3輪27/27，全文可用。 |
| WI-06.3 原30每輪29及唯一拒絕 | Pass | 原30每輪29/30；唯一do-not每輪實際無需計算，安全拒絕。 |
| WI-06.4 舊280至少272 | Pass | 280=272可用/8安全拒絕；v4h19仍實際錯誤，v12h15含/不含/付款人完整。 |
| WI-06.5 舊v13三輪60 | Pass | 舊v13=60/60，僅列回歸。 |
| WI-06.6 全文語意審阅 | Pass（固定集） | 已讀430全部來源/輸出和11拒絕全部attempts，另讀定向130；新fresh誤擋另列，整體不放行。 |
| WI-06.7 服務錯誤保留 | Pass | v11兩批與新18均0服務錯誤；歷史401/其他失敗未改寫，無重抽最好輸出。 |
| WI-06.8 修正重跑與歷史保存 | Pass（v11） | v11全量及原20已重做；修正F07後仍須依影響重跑，不能沿用v11品質結論。 |
| WI-06.9 分開輸出/可用/拒絕 | Pass | 本報告分列output/usable/safe rejection/false rejection/service error，無輸出率=準確率宣稱。 |
| WI-07.1 文件入口/日誌 | Pass | Implementer總覽/比較/日誌與修正報告已更新；本次獨立新報告另增，交root更新後續狀態。 |
| WI-07.2 本機/正式狀態 | Pass | 本機獨立複驗，未部署；正式仍原revision，LINE實機未验收。 |
| WI-07.3 契約/限制/SHA/命令 | Pass | 本報告補充最新每箱/每袋可接受語序、F07、SHA/命令/限制，原重量與幣別契約不放寬。 |
| WI-07.4 baseline/格式/scope | Pass | baseline120僅原7檔變更；scope hashes和前輪Verifier檔案無漂移，UTF-8無BOM/CRLF與diff檢查見本輪scope。 |
| WI-07.5 交接與独立責任 | Pass | 以原需求/AC/源碼及全raw重新判定，未依implementer成功標记放行。 |
| Verification-1 | Pass | 獨立Node22、來源diff/baseline/hash/privacy及scope。 |
| Verification-2 | Pass | 原六High公開adapter正反重現均修復；數值正確物件錯配等40注入及F01兩次全覆蓋。 |
| Verification-3 | Pass（延續） | 前輪20案已轉回歸，v11三輪60/60；本輪另外6全新雙向案在API前固定rubric/core/SHA。 |
| Verification-4 | Fail | 新6全核心三輪應18/18可用，實際15/18，cqv11f05三輪誤擋。不可改核心標記或以raw可用抵輸出。 |
| Verification-5 | Pass（輸出安全部分） | 本輪已提供的545既有及15新譯文未觀察未攔截Blocking/High/Medium；另有Medium誤擋，所以整體仍不通過。 |
| Verification-6 | Pending | 本輪6案保持凍結、轉回歸；F07修正後重驗受影響AC，最終另增至少5未見案。 |
| Verification-7 | Pass（報告完整） | 六原finding狀態及新F07等級/來源/兩次原始回應/原因/正反對照/AC完整；有未解Medium故Changes required。 |

## 範圍、低等級事項與交接

baseline120原檔中7檔變更：translator、protection、subjects、原translator.test，以及總覽、比較、日誌；113檔保持SHA。既有shared trade-policy、NMT、webhook、program、factory、Firestore及LINE入口未改。這七檔及新增context/tests/evaluation/doc均在原WI範圍；本輪Verifier只另增獨立fixture、腳本、完整複驗和此報告。Implementer scope所列全部file hashes和前輪Verifier artifacts重新核對無漂移，沒有改寫第一輪findings。

Low CQV-L01仍開啟：cqv04的1250kgand/6kgand、h12缺分隔標點、v2h21的priceUSD黏連與多餘右括號、v9h22的MTUSD黏連，影響可讀性；完整數量及語意仍可辨且未改變，列Low而不隱去。常見前置空白及標點空隙亦屬可讀性問題。

有限status/量詞role/only-if/禁止句型不能證明任意語意關係；未知姓名、未知opaque分母及自由每噸/per ton仍需要完整審閱，不擴大kg/MT/lb或幣別同義表。相同模型三輪不代表獨立統計準確率。LINE實機顯示／通知與正式部署仍未驗收。

重現本輪：使用指定Node22執行npm --prefix functions run verify，成功exit0後執行verify-context-quantity-independent-v11.mjs、verify-context-quantity-boundaries-v11.mjs及verify-context-quantity-controls-v11.mjs。完整fixture/候選dry-run為evaluate-context-quantity-verifier-v11.mjs --dry-run；實際API只在已授權、固定SHA且程序環境提供暫時token時移除--dry-run執行，所有先前原始結果須保留。注入腳本exit0僅表示腳本完成；逐case passed=false的F07是明確失敗證據。

交回root安排Implementer修正F07。六案現在轉回歸，不能仍稱未見；改動解碼或全域分母檢查後依原AC重跑受影響固定集合、原20和本輪6案，並在最終獨立階段另加至少5未見案。Verifier本輪已完成相關finding收集，停止修改；不自行修application code、不更新為Passed、不部署。
