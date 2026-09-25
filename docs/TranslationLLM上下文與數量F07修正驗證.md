# Translation LLM 上下文與數量 F07 修正驗證

日期：2026-09-24。第二輪獨立複驗已將 F01～F06 原重現標為 Resolved，CQV-F07 Medium 仍 Open；本文件是 Implementer 修正記錄，不是獨立放行。候選 candidate-context-quantity-v13 已完成離線與同候選定向90／全量430驗證，現在交回重新獨立驗證；尚未部署。

## 最新需求與有限契約

使用者明確接受 source「USD 9.50/carton」與下一段「USD 2.40/bag」自然譯為「每箱 USD 9.50／每袋 USD 2.40」。這項確認解決 carton→中文箱的語意，不再套舊三組字串表拒絕此正例；原 [v11 複驗](TranslationLLM上下文與數量獨立複驗v11.md)、fixture/rubric 及原始證據全部保留。

- 分母只從同一已驗證金額 occurrence 緊鄰位置辨識：原 slash suffix、中文「每＋可選個＋紙箱（含纸箱字形）／箱／袋子／袋＋空白」、英文金額後「per bag(s)／carton(s)／box(es)」至分句邊界。
- bag／袋／袋子和 box／箱、carton／紙箱的原對應保留；另方向限定允許 carton／紙箱→中文箱，不把英文 box 和 carton 全域合併，不允許 bag↔箱／紙箱。
- 若金額前後同時有分母、重複每分母，或分母不符即拒絕。每筆金額／幣別／符號／精度與原段落／occurrence先驗證；完整合法同段語序重排仍可接受，同值不能藉交換ID偷換分母。
- 未知複合分母仍要求斜線後原樣，不把 crate pack、crate-pack、crate/day 猜成袋或箱。修正句點接換行的分句邊界，不把英文句末「.」當分母字元。
- copy-exact 先驗證模型實際數值與分母，再移除該筆已驗證的每…／per…／slash詞組，把來源「金額＋原斜線空白＋原分母」作為同一精確值還原，避免雙重分母，也保留明確要求原樣的中文來源分母；不是先覆寫原值掩蓋錯譯。
- 只有已驗證的 external denominator 能調整右側斜線位置鄰界；其他正負號、算式、百分號與資料鄰界維持。kg／MT／lb、幣別與貨幣換算規則未擴大。

## 已完成離線驗證

Node22完整 verify：check、24 files／648 tests、build 成功；原608項保留，新增40個自然計價、原段落、相同金額重排、幣別／精度變更、錯換袋箱、重複分母、copy-exact及未知分母正反例。原 carton→箱 測試依最新使用者確認由拒絕改為接受，其他錯換斷言未降低。

629筆離線重播全部符合預期：578份v11真API記錄（430全量＋130定向＋18複驗）及51個公開注入；F07原三次正確raw現在可以還原，原F01～F06錯例仍拒絕。只重綁隨機nonce，注入前要求整個request.contents相同，0不一致；完全不算新候選真API證據。原11邊界重驗全部通過。

開發過程先發現新增測試helper回傳型別錯誤；修正後發現句點接換行及copy-exact中文分母的相容問題，已修正且完整verify成功。所有既有API首次結果及獨立證據未覆寫。v12定向90/90完成且F07三輪已實際回傳正確每箱／每袋；其後覆核新增測試發現「每纸箱」不應當作安全負例，依既有繁轉契約修正同一紙箱字形、保留袋→紙箱拒絕，完整離線後才凍結v13。v12原90筆保存於regression-2026-09-24T06-40-40-423Z.json，不計最終候選驗收。

## 固定候選 API 與交接狀態

定向90筆：原20三輪60＋本輪6案三輪18＋4登記／備案對照三輪12，90/90產生可用譯文且無服務錯誤。F07三輪均第一次產生「費用為每箱USD 9.50 。」及下一段「費用為每袋USD 2.40 。」。同候選固定430全量完成：272/280、比較每輪29/30、舊v13三輪60/60；9個核心包裝27/27。共11次安全拒絕（9個案例）逐次核對兩次原始錯譯，0誤擋、0觀察到未攔截中等以上錯誤、0服務錯誤；全部來源／輸出／mentions逐句覆核，不混用v11品質結果。本輪六案已轉回歸，最終獨立Verifier須再增加至少5新未見案例。

候選完整來源／compiled與資料集雜湊：.local/tllm-context-quantity-f07/frozen-v13.json。離線證據：.local/tllm-context-quantity-f07/replay-candidate-context-quantity-v13.json、boundaries.json。完整可攜逐句證據：[F07審閱檔](../functions/evaluation/tllm-context-quantity-f07-review.json)。本輪實作與必要回歸完成，交接後停止程式修改，等待獨立Verifier重新驗證；不自行關閉原F07。

正式仍為 linewebhook-00018-huk／candidate-v12；本機候選全名為 candidate-context-quantity-v13。沒有部署、變更glossary／IAM／Secret／正式env／Firestore，也沒有發送真人LINE。有限語序辨識與三輪合成集不代表一般準確率；既有Low排版事項未擴scope處理。

## 命令與改動範圍

所有命令使用 Node 22.23.2，逐步檢查 exit code 才執行下一步；npm verify 透過 npm-cli.js 執行以保留 npm_execpath。

```text
Node22 npm-cli.js --prefix functions run verify
Node22 functions/scripts/replay-context-quantity-f07.mjs
Node22 functions/scripts/recheck-context-quantity-f07-boundaries.mjs
Node22 functions/scripts/evaluate-tllm-context-quantity.mjs --include-verifier --include-controls --include-v11-fresh --ids=<三份固定fixture共30個ID>
Node22 functions/scripts/evaluate-tllm-context-quantity.mjs
```

定向使用原verifier20、repair-controls4、v11-fresh6三份fixture，保留各三輪；全量不帶篩選參數即固定430。凍結檔、raw及可攜報告保存全部來源／compiled／資料集SHA。API只發固定合成資料，單worker、每次請求至少間隔2.5秒；臨時token僅在評估程序環境內，未印出或落檔。

本輪F07程式修改為translation-llm-context.ts（句末分母邊界、已知紙箱字形）、translation-llm-context-html.ts（相鄰自然語序、逐筆驗證與copy-exact還原）、translation-llm-translator.ts（候選版本）；tests包含translation-llm-findings.test.ts的明確接受規則更新及新增translation-llm-pricing.test.ts。新增離線重播／邊界檢查工具；合成評估器加入轉回歸的v11六案選項。總覽、工作項目、比較評估與日誌同步記錄最新接受規則及實際狀態。

## 最終證據

648項測試、629筆離線重播與11個邊界檢查通過；同一凍結候選完成定向90/90與完整430筆API回歸，280案272可用、比較三輪各29/30、舊v13三輪60/60，核心包裝27/27；原verifier20三輪60/60及第二輪6案三輪18/18、登記對照12/12，0服務錯誤。共520個邏輯結果、542次實際API呼叫；首次結果全數保留，未重抽選最佳譯文。

| 組別 | 結果數 | 可用 | 安全拒絕 |
|---|---:|---:|---:|
| regression | 280 | 272 | 8 |
| comparison | 90 | 87 | 3 |
| v13 | 60 | 60 | 0 |
| verifier-regression | 60 | 60 | 0 |
| repair-controls | 12 | 12 | 0 |
| verifier-v11-regression | 18 | 18 | 0 |

- .local/tllm-context-quantity/regression-2026-09-24T06-51-29-220Z.json — SHA-256 87cfead8b5c290afc70df58834661a9b5382b597461d56e78069837cc55dedee
- .local/tllm-context-quantity/regression-2026-09-24T06-46-08-943Z.json — SHA-256 9cfcfe6428521f7ce9aa7b1f20ef5b14c9dd696733008f73d0f74a66e5ecc8f6
- .local/tllm-context-quantity-f07/frozen-v13.json — SHA-256 0a62338ef711b4b0865c8d632b8c91197e684272fe5950b7bd1352c8bf538603
- .local/tllm-context-quantity-f07/replay-candidate-context-quantity-v13.json — SHA-256 44453e3437f00c540d6149dfa1a4ea3dfc2163f761630fa47cc7302becc4fc9b
- .local/tllm-context-quantity-f07/boundaries.json — SHA-256 c9819fd587201e1b7f59529ecd406f67cbad6e900c302c8a935d9742f77e024d
- .local/tllm-context-quantity-f07/request-counts-v13.json — SHA-256 3162b4c8791acd2de21300461e2d046cc6f02dcad22d1eac75217033932f8d0e

| 模組 | source SHA-256 | compiled SHA-256 |
|---|---|---|
| translation-llm-translator | de0cd90c3920a3cf966faf6130e604cb4bfa52d54ff16cdcee84cd6d28698a55 | 1240d724c0ba5f9449e2f4b3fe0b76f5b9b8132f80b19f1e6c742cc29924ddd4 |
| translation-llm-context | f6ba6a33de1f2fca7e5839b48355dc37949c559a0fa4c3279972c18869ab387b | c5a6725faace72fb6199a4015919e09d0059a275335910056f00b37e7a82e228 |
| translation-llm-context-html | 5cd3e36bc7a260f6b93b1fe16757fe1822b9c194fbc9556ebc78a2bf1598ecfa | d715bde33175fd386866cb5c9384e2cc79406725caee1adf5c1ed2ed2fe30f42 |
| translation-llm-context-meaning | a81133bb92e7541644f6b1805b37329a92774c5151bd0c3c5326da1345ca5e73 | 8cbb3b5bc498377734cd785b94afc8ca7185a62a6bf8878d59c3cfefa0441366 |
| translation-llm-protection | 5d25ccd47f8c2babf93c9f14589b29e9960eb0fe9a716cff43b612fd9a7211ac | 89a3c032535cebbb5b0c74ec04947744ea53fe33455722e2cfc15733ac3c4d54 |
| translation-llm-subjects | 2a1c896d57694d6e8492b392cd4649232fa0cd62fc77228952a3d94f5e7fe994 | c78249bc35657b980997c5999deaa7054a9111826fc15a35f7fa6594f9801d90 |
| trade-policy | 656e686a95585ab61a82f16eb9b973c1850ac0dd183f2170cb829ee203f6637b | 2fc14c6a80739f17931065c9604902928f6946e96f545281bf9e389f1c39501e |

相對root baseline120檔仍為7個既有檔修改、113個未變；完整新增清單與檔案雜湊見可攜審閱檔scopeAudit及.local/tllm-context-quantity-f07/scope-final-v13.json。原v6／v11獨立文件、rubric、fixtures、raw和portable evidence逐檔SHA保留。WI-01～WI-07的本輪實作／必要回歸已完成，獨立複驗及至少5個新案例尚待執行；正式LINE顯示／通知仍未驗收。

使用者反映Translate費用後已停止新增付費API；停止時v13全量430與定向90皆已完成，Implementer剩餘所需API為0。最終候選520邏輯結果實際542個requests，觀察到HTML輸入79,534及glossary輸出82,100個Unicode code points；連保留v12首次90一起共635requests、輸入91,222／輸出95,273。這些是本機請求／回應統計，不是Google帳單或NTD費用核對。後續新增付費評估待進一步指示。
