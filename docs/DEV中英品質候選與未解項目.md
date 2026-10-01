# DEV 中英品質候選與未解項目

2026-09-30：A 觀測／去重已獨立放行並隨限縮版部署 DEV linewebhook-00008-fad；B 本機候選 nmt-glossary-v22 首輪獨立驗證未通過，兩次同根因失敗後完成設計檢討，已決定撤回新 fee／coverage runtime 判斷、保留核心修正，限縮實作、完整離線及獨立驗證通過，語意品質未放行。本文件只處理 DEV，承接 [開發計畫](DEV翻譯品質改善開發計畫.md) 與 [歷史審閱](DEV翻譯品質與營運改善建議20260930.md)。

## 本機候選範圍

- 完整 Fine 肯定回覆：僅英→繁中、prepare 後無任何 protected occurrence（含原生提及及 configured protectedNames）、trim 後完整 Fine，不分大小寫，最多附一個 . ! 。 ！，輸出「好的。」且零 provider 呼叫；Fine?、I'm fine、a fine、fine powder、含數字或其他文字不套用。這是產生譯文，不擴大 OK／Yes／No 略過規則。
- Runtime 核心候選：區分已支持的確認對象及 required／not-required／prohibited／request／neutral，保留 actor／object／modality／multiplicity 一對一與已知 excluded-object 完整性；B-CNF-01／02 的有限控制已通過，限縮接入已完成且獨立通過。
- Fee／coverage 實驗：兩輪仍有忠實費用句誤拒，已決定撤回新增 runtime 比較及以 experimental consistent 跳過舊 guard 的行為；費用遺失等曾有通過控制，但不再冒稱是 runtime 已啟用能力。原有 coverage 誤拒／漏檢保留 OPEN。
- 判斷狀態區分 consistent／violation／unknown／not_applicable，必須同時指明 core 或 experimental 範圍。core consistent 只表示已支持核心一致，不跳過其他既有 guard；unknown 不是整則品質證明。實驗結果不作 runtime 費用／coverage 決策。
- 詞表候選：中文新增 12 個、英文新增 7 個，共 19 個；完整 TSV 為 29／39 列。現行 runtime、雲端 glossary ID 與隔離白名單不切換。只採明確詞組；稅則收窄為稅則編號／海關稅則號碼，問／詢問 AI 需驗證長短詞組、空白與研究 AI 反例。

[開發集與候選詞表](../functions/evaluation/dev-quality-20260930/README.md) 包含原 40 個合成開發案及另 6 個術語控制；它們都是已見資料，不可計入 verifier 未見集。候選詞表新增不代表原來 13 筆都會命中，也不代表 NMT 已產生正確譯文。

## 13 筆歷史中英問題逐項處置

索引沿用私有審閱清單，只列匿名短語與根因；歷史缺少的原生提及 metadata 或被拒候選不補猜。

| 索引 | 問題 | 本輪處理／尚未完成 |
|---|---|---|
| 12 | remaining balance 催收語意不自然 | 明確 collect the remaining balance 詞組候選；原句使用其他措辭，不保證命中，尚未證明改善 |
| 14 | container 譯成一般容器 | shipping／cargo container 可明確命中；單獨 container 仍需語境，未全域改詞 |
| 48 | once 平白新增稍後 | 目前有限確認模組不等於一般時間新增檢查，尚未修正 |
| 52 | 受確認者與收訊者混淆 | 需要 occurrence 與角色關係驗證；不得補造歷史 metadata，尚未修正 |
| 53 | called 的電話／稱呼歧義 | 單句不足以保證電話義，保留上下文階段，尚未修正 |
| 74 | Google Drive 平白新增設定動作 | 無通用新增動作檢查，尚未修正 |
| 75 | Not yet／update 的先行詞歧義 | 未完成與未更新不可任意互換，保留上下文階段，尚未修正 |
| 78 | 稅則編號變成稅費或收稅 | 明確編號詞組候選；不把所有稅則固定為 code，原句仍需真 API 審閱 |
| 85 | 裝櫃順序中的櫃門變家具櫃門 | 貨櫃門詞組候選；單獨櫃門不得全域替換，原句仍需語境與真 API 驗證 |
| 88 | Fine 肯定回覆變成形容詞 | 本機完整短句已接入且獨立正反／webhook 控制通過；不擴大到其他 Fine 用法 |
| 102 | 向 AI 提問變成研究 AI | 問／詢問 AI 詞組候選與相鄰反例；尚未啟用或真 API 驗證 |
| 105 | 海關語境的稅號變成 tax ID | 明確海關稅號詞組候選；單獨稅號仍多義，原句尚未證明改善 |
| 118 | 今天修飾付款而非跟進 | 本輪確認關係模組不處理所有付款動作／時間綁定，尚未修正 |

兩筆中越領域問題仍在 WI-08 條件階段。三筆英數符號保留的可讀性代價屬 9/29 現行需求，沒有改規則或算成已修正品質問題。

## 證據與費用邊界

現行建置的 12 組合成正反譯文注入：正確接受 11／12、刻意錯譯拒絕 1／12，證據 .local/dev-improvement-20260930/semantic-baseline.json。這只說明有限 guard 行為，不能解讀為 Google NMT 準確率；新增候選必須另外記錄版本與結果，不能回寫原證據。

A 對原 40 案 wire 比對完全相同：39 個 mock 請求、2,654 碼點。B 的 Fine 若改為本機返回，該案應明列零 API，其餘 wire 保持原樣；46 案與獨立未見集會另外形成新的實送字元 manifest。真實新詞表尚未建立、尚未發送付費翻譯，不把 mock 回應當候選 NMT 的品質證據。

後續真 API 評估須先核對 DEV 資源、建立不可變候選 glossary 與 provenance，再按凍結 manifest、零自動重試及有效預算執行；與部署、真人 LINE 訊息測試分開。未解實質問題保持未完成，不能用 Fine 本機通過或新增測試數取代整體 B 品質放行。
## B 凍結與離線驗證

候選 nmt-glossary-v22，21 檔凍結摘要為 477916e6465276bcad03e4f9b945b4e9522ede047214fea72e97046926ce0feb，完整交接在 .local/dev-improvement-20260930/b-handoff.json；版本改名不重置 v21 findings 或修正輪次。

- 完整離線 1,758 項應用／55 檔及 75 項工具通過，log 為 .local/checks/20260930-195016-702-full-0f62c527.log。最後將 Fine helper 移至 prepare 後以維持 configured protectedNames 的小修，另補 185 項／6 檔、型別與建置檢查；不是宣稱最後修改後又重跑完整套件。
- 46 案新的 b-wire-manifest.json：44 個 mock 請求、2,846 個 contents 碼點，NMT 標價估算 US$0.05692／輪。原 40 案只 DEVQ-17 Fine 改本機，其餘 canonical wire 相同；此 manifest 使用現行 v12/v9 glossary，19 新詞尚未啟用。
- Fine 經 webhook mock 確認產生「好的。」、零 provider／零帳本操作，保留原生提及、設定姓名、關閉採集及重送去重。沿用 A 本機回覆控制約 5 讀／5 寫，B 不另加資料庫控制操作；不含既有採集／設定與重試。
- 有限模組不支援命名人物、其他確認動詞、被動／倒裝、代名詞受詞、條件／引述／雙重否定等情境；unknown 沿用既有 fallback，仍可能誤拒相鄰確認或漏檢未支援附加關係。consistent 僅是有限框架判斷，不能當作整則品質證明。

實作來源：[確認關係](../functions/src/nmt-confirmation-relations.ts)、[短句](../functions/src/nmt-local-phrases.ts)、[公開翻譯入口](../functions/src/nmt-glossary-translator.ts)、[公開候選測試](../functions/src/nmt-b-candidate.test.ts)。A 已通過的相容來源保留於 .local/dev-improvement-20260930/a-verified-source-snapshot/；不得回退 ledger 或刪除歷史事件。
真實詞表評估提案採同一凍結 B 程式，比較現行 v12/v9 與新不可變候選詞表，其他請求條件一致；先跑確認義務、未知涵蓋限制、稅則代碼／整套稅則、詢問／研究 AI、貨櫃與付款詞組的代表性正反例，只有結果符合門檻才跑剩餘案例。未見案例固定後合併 manifest，再提供精確請求數、碼點及上限；本機 Fine 不為製造對照而強迫呼叫 provider。任何來源／版本／隔離不符、帳本失敗、provider 錯誤、預算不足或新高風險錯譯即停止，不自動重試或放寬守門。此段為待授權方案，尚未建立新雲端資源或執行翻譯。
## 獨立未見集與初版費用提案（已由文末擴充清單取代）

凍結後 verifier 另設計 18 個未見案例、30 個正反注入控制；來源與 rubric 先固定，再由公開 adapter 執行。初步發現責任人對齊、未完整解析的否定片段及獨立運費關係誤拒，B 尚未放行；報告與首輪修正另行追加，不覆寫原失敗證據。新未見案例之後只能算回歸集，不重稱未見。

| 項目 | 擬議規模 |
|---|---|
| 合成題目 | 已見 46 案＋凍結後未見 18 案，共 64 案 |
| 每組詞表 | 59 個 provider 請求、3,836 個輸入碼點，其餘本機返回 |
| 現行／候選詞表各一輪 | 最多 118 個請求、7,672 個輸入碼點，不重複跑代表案例 |
| NMT 標價估算 | US$0.15344，提議翻譯費上限 US$0.20 |
| 實際執行 | 0 次付費翻譯；新雲端 glossary 尚未建立 |

上述計算以初次 B 凍結 wire 為依據；修正後須重新核對版本、manifest 與術語雜湊並取得有效授權，否則不可執行。精確來源檔及 hash、零自動重試、分階段停止條件記於 .local/dev-improvement-20260930/b-paid-evaluation-proposal.json；這是成本提案，不能當作執行授權或已通過品質證據。US$0.20 僅指 NMT 翻譯，不含既有雲端儲存、資料庫控制操作或開發人時，亦不假定免費額度尚有餘量。
## B 首輪獨立結果與修正範圍

報告 .local/dev-improvement-20260930/b-verification-round1.md：VERIFICATION FAILED。verifier 親跑 114 項／3 檔、18 個新來源的 30 個注入控制、Fine webhook 與 8 個原 v21 控制，凍結 21 檔前後一致；完整離線與 A 無變動證據核對後沿用。

| Finding | 結論／修正要求 |
|---|---|
| B-CNF-01 High | 同一對象多次確認時略過 actor 配對，I 變 you 仍 consistent；逐關係保留 actor／object／modality 綁定 |
| B-CNF-02 Medium | 逗號後 compound／negated object 被截掉仍 consistent；未解析完整必須 unknown，不得假稱語意已保全；unknown 沿用政策仍可能漏檢 |
| B-CNF-03 Medium | 正確獨立「運費另外計費」被誤綁為 coverage 限制；識別獨立費用述詞再對齊，保留刪除／重複與平白新增限制反例 |

三項交原唯一 implementer 首輪修正，再交同一 verifier 複驗，保留原案例、rubric 與失敗證據。具名人物的 NMT-RETEST-02-R1（跨標點新增服務限制）、R2（正確相鄰確認誤拒）、R3（must→不必漏放）均已重現，仍 OPEN；原停修／設計門檻不重置，不在此輪擴大一般具名人物解析。

未見集 VB-14／17 的原 rubric 另要求保留外圍空白，實際 A／B 皆有既存整體 trim；原失敗期待保留，獨立比對證明非 B 回歸，不能改題來美化結果。Fine 的本機正例、保護反例、零 API／零 ledger、關閉採集及重送已獨立通過；只支持歷史第 88 筆的狹義改善，另 12 筆仍未證明改善。
## B 首輪修正候選

凍結摘要 dc12d4f148958d5590c289c3e796ebbb854eff190deffef5f8ea603f9c1f271d，nmt-glossary-v22／nmt-confirmation-relations-b2；僅 confirmation 模組改動並新增 28 個修正控制，原 B 其餘 20 檔不變。完整交接 .local/dev-improvement-20260930/b-repair-round1-handoff.json，原 freeze／失敗結果／案例全部另存保留。

- B-CNF-01：以一對一完整關係配對 actor／object／modality，保留次數及可推得的單一責任人；省略不能掩蓋明示 I／you 衝突。
- B-CNF-02：保留 compound 否定補語及位置，忠實 compound 仍 unknown；僅能明確認出的已知受詞排除關係，另比對刪除／換綁完整性。不宣稱一般未知語意已安全。
- B-CNF-03：先抽取完整費用類別、另計述詞與否定，再對齊次數；未知費用措辭保持 unknown，不假稱新增 coverage 限制或一致。
- 最終穩定候選完整離線 1,787 項／56 檔＋75 工具、型別與建置皆過：.local/checks/20260930-203119-803-full-873f4964.log；195 項定向、local preflight、CRLF／diff 亦過，之後沒有再改來源。
- 實作者重播原 18 案 30 控制，三項修正的 7 個控制符合預期；這不是獨立複驗。46 案仍 44 請求／2,846 碼點，原未見 18 案仍 15 請求／990 碼點；所有 wire／options 與初次 B 相同，費用提案數值不變。

本節只記錄待複驗候選，不能取代 verifier 結論；NMT-RETEST-02-R1／R2／R3、一般 unknown 與 12 筆尚未改善歷史案例皆保留。
首輪修正獨立複驗初步結果：VB-06／09／10 原 7 個控制通過，新增 25 個相鄰控制有 23 個符合；B-CNF-03 的忠實獨立運費子句以逗號連接，或英文來源用「, and」連接時仍遭誤拒，不能關閉此 finding。先保留本次凍結，待完整報告後才進行第二輪共通分界修正；若第二修正與獨立複驗仍未解同根因，按兩輪門檻先檢討設計，不追加逐句例外。
評估文案核對：DEVQ-01 原題為『請核對海關稅號與稅則號列。』，rubric 仍要求海關分類代碼，不放寬成整套 tariff schedule；README 已更正原先誤稱該題用語含糊的說明。整套稅則的多義性另外由術語反例處理，未修改原題或原始證據。

費用清單補充（待第二輪最終來源核對）：將第一複驗新增 8 個相鄰來源納入後，共 72 個案例項目；67 個擬議 provider 請求中有 3 個與其他案例的 canonical request/options 相同，每組詞表重用一次結果評閱相應 rubric 後，只需 64 個不同請求、4,259 碼點。兩組最多 128 個請求、8,518 碼點，NMT 標價 US$0.17036，仍可提議 US$0.20 上限。這僅是合成評估內去重，不引入 runtime 跨訊息快取；即時 adapter 的保護 token 與還原映射仍須驗證，不能直接把 capture 當可執行請求。新版草稿為 .local/dev-improvement-20260930/b-paid-evaluation-corpus-draft.json，取代前述 64 案提案作為待凍結的擴充規模；尚未授權或執行。
## B 第二輪候選（待獨立複驗）

nmt-glossary-v22／confirmation-b3，23 檔凍結 69df9943e773280f91aa91f16f0ea22f949942e7e3441436f4a311369a2aa51e。改為先抽取完整獨立費用 frame 與精確 span，共用於費用與 coverage 對齊；標點只作候選起點，不能把所有逗號或 and 當關係分界。只改 confirmation 模組並新增 round2 測試，前一版其餘 21 檔未變。

最終完整離線 1,906 項／57 檔及 75 工具、型別／建置通過，log .local/checks/20260930-210332-694-full-96b23358.log；314 項定向含新增 119 控制（100 項標點與順序矩陣）、preflight、CRLF／diff 均過。實作者重播原相鄰 25 控制全過，原 18 案的既有分類保留。46／18／8 案全部 request/options 與前版相同；按這三份第二輪 manifest 彙整的 72 案、128 次上限／8,518 碼點／US$0.17036 提案已更新，仍須同 verifier 複驗與有效付費授權。

此為 B-CNF-03 同根因第二修正；若獨立複驗仍失敗，先由原實作者依開發流程整理共通設計與正反案例，再由主 Agent 決定下一步，不直接追加第三輪逐句補丁。詳 .local/dev-improvement-20260930/b-repair-round2-handoff.json。
第二輪獨立初步結果：原 25 相鄰控制通過，但 source「You must confirm the coverage, but shipping charges are billed separately.」對忠實的「你必須確認涵蓋範圍，但／但是運費另外計費。」仍錯拒；中文未知連接詞導致未抽到 fee，被誤當已知缺失。B-CNF-03 達兩次修正與獨立複驗未收斂門檻，停止逐句補丁，依流程交原實作者檢討「解析完整證據」與未知剩餘片段契約，並比較保守有限檢查與撤回不可靠候選接入；主 Agent 決定前不再改程式。B-CNF-01／02 原控制仍通過，舊 NMT 停修限制不變。
## 設計檢討決策：限縮 runtime

第二輪報告 .local/dev-improvement-20260930/b-verification-recheck-round2.md 已結案：B-CNF-03 仍 OPEN Medium、達兩次修正門檻；01／02 保持 scoped closed。原實作者比較「建立全片段解析完整性契約」與「撤回新 fee／coverage 接入」，主 Agent 選擇後者，以降低本輪新增誤拒與後續維護成本，不再逐詞加入但／但是來移動漏洞。

限縮實作保留 A、Fine 與有限 actor／object／modality／multiplicity 一對一、已知 excluded-object 核心檢查；runtime 不再採用新的 fee／coverage 比較，也不因 experimental consistent 而跳過既有 coverage guard。完整實驗模組及原正反案例保留；來源、rubric 與失敗證據不改成通過。

撤回的能力包括實驗版對獨立費用的遺失、新增、重複、類別、only／否定與 coverage 限制的新增判斷，以及部分正確相鄰 coverage 確認的放行改善。這是能力撤回，不能稱 B-CNF-03 已修好；其實驗 finding 仍 OPEN，原 NMT 三項 OPEN 與既有 fallback 的缺口保持。限縮後仍須完整必要離線與同 verifier 驗證，重點是相對 A 不新增費用／coverage 誤拒並保留已閉合核心，不代表所有 B 品質通過。

被拒第二輪的完整 23 檔來源已另存 .local/dev-improvement-20260930/b-repair-round2-rejected-source-snapshot/，僅供追溯，不能作已批准發佈或回復版。此決策在既有 DEV 本機授權內執行，不建立新產品開關或啟用詞表；付費、部署及真人訊息仍未執行。

為覆蓋新發現的實際缺口，評估草稿另加入 BR2-S4 一個來源，未整組擴張新的相鄰集；目前 73 個案例項目、去重後每組 65 個 provider 請求／4,352 碼點，兩組最多 130 次／8,704 碼點，NMT 標價 US$0.17408，仍提議上限 US$0.20，待限縮最終來源與獨立結論核對。
## 限縮版交付與現行評估規模

限縮候選為 nmt-glossary-v22／nmt-confirmation-core-v1，24 檔來源凍結 5bff8841587e85ac9aeaa575b489f17ffad95e7a94849c40e442c969f36616fe；程式實作與限縮範圍獨立驗證通過。runtime 只採用 checkConfirmationCore，費用抽取、masking、coverage 比較留在實驗模組；舊 A coverage guard 無條件執行。上文的初次、首輪及第二輪候選章節為歷史證據，不是目前 runtime 能力。

最終完整離線為 1,930 個程式測試／58 檔與 75 個工具測試，型別、建置、local preflight、CRLF／diff 通過；完整日誌 .local/checks/20260930-213807-902-full-b0055383.log。數目包含保留的實驗測試，不能宣稱費用／coverage 能力仍受 runtime 強制執行。實作者原 75 控制比較 A guard，有 61 個相同行為、14 個差異屬保留核心拒絕；原品質 rubric 的 18 個 public 失敗及兩個舊空白格式失敗完整保存，未改成通過，獨立結論如下。

現行付費評估提案採這份限縮候選的 mock wire：40 開發案＋6 術語控制＋18 原 verifier 案＋8 相鄰案＋BR2-S4 一案，共 73 個案例項目；其中 5 個本機零呼叫，68 個 capture 請求在每組內合併 3 個相同 request/options，得到 65 個不同請求、4,352 個 contents 碼點。現行 v12/v9 與新不可變候選詞表兩組最多 130 請求、8,704 碼點，NMT 清單價估算 US$0.17408，提議翻譯費上限 US$0.20，零自動重試；儲存與控制操作另計。本段取代上文較早的費用草稿，並不構成付費授權。

來源 manifest、案例關聯、canonical hash 與費用上限在 .local/dev-improvement-20260930/b-paid-evaluation-proposal.json 及 b-paid-evaluation-corpus-draft.json。草稿中的隨機保護 token 不得直接當可送請求：執行時須經 live adapter 建立還原映射，核對 canonical request、實送碼點、DEV glossary provenance 及有效預算後，才允許單次 provider 呼叫。先跑代表性高風險正反案例並審閱，再決定其餘；已跑代表案不重跑，遇新重大錯誤、誤拒、對帳失敗、不確定呼叫或預算不足即停止。

本機開發結案時新增付費翻譯呼叫 0、候選雲端詞表未建立；使用者後續另授權部署 DEV，限縮版已發佈，部署檢查新增翻譯 API 與真人 LINE 訊息均為 0。整體 B 品質仍未放行；下一步付費合成評估只驗證詞表和有限候選，不會自動關閉原 NMT findings 或恢復已撤回實驗檢查。

獨立驗證結論：限縮 runtime scope PASS，整體 B 品質未放行。Verifier 親跑 268 tests／6 files，獨立重播 75 控制得到 61 個與自行編譯的 verified A guard 相同、14 個保留核心拒絕差異；實驗原 67 控制的 status／reasons 未變，public adapter 沒有呼叫實驗入口。Fine 在記錄關閉／重送控制中 provider 與 ledger 均為 0；四組 wire 與來源凍結前後相同，24 檔 aggregate 維持 5bff8841587e85ac9aeaa575b489f17ffad95e7a94849c40e442c969f36616fe。完整離線日誌由實作者產出、verifier 核對，沒有把引用完整測試誤稱獨立重跑。報告 .local/dev-improvement-20260930/b-scope-withdrawal-verification.md；最終來源另存 b-limited-runtime-source-snapshot/，屬本機來源快照；本次另以 prepare-dev-deploy 建立驗證發佈包並部署。

限縮版現已部署 linewebhook-00008-fad（ACTIVE、100%），原品質未解與付費暫停保持；來源、參數、帳本及無翻譯／持久去重檢查詳 [部署紀錄](DEV改善限縮版部署20260930.md)。
