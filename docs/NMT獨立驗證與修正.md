# NMT 獨立驗證與修正

原始驗收依據：[NMT 開發計畫](NMT術語表改版與獨立測試環境開發計畫.md)。本文件記錄獨立 findings，不以既有自動測試通過替代驗收。

## 最新判定（2026-09-25）

整體 **VERIFICATION FAILED**：v21最後一輪仍有NMT-RETEST-02-R1 Medium、R2 Medium、R3 High（coverage新增限制漏放、獨立確認句誤拒、must變不必漏放）。[原Verifier最終報告](../.local/verification/recheck-v21/verification-report.json)及controls保留。原人物四缺陷的新wire未實測，不宣稱品質修好。

使用者知悉後要求dev部署，另批准唯一mock相容例外；[窄核對](../.local/verification/recheck-v21/deploy-test-compat-review.json)確認只一行helper、斷言不變、其他250檔相同。此scope通過不改原品質FAILED。完整部署prehook1249單元／45工具／check/build通過，已部署並接測試OA；原未見20、完整品質及人工驗收未完成。沒有恢復新付費回歸或另開修正輪。

以下是歷史各輪與最新八類 finding 的完整紀錄；單一版本窄複驗通過不能替代全案品質、部署或使用端驗收。

## 第一輪獨立驗證

凍結候選 `nmt-glossary-v1`，application manifest SHA-256 `ddd75be2a087771064ccda157bfe9112e98f89d3eab6ed251557b171f550603b`。Verifier 依原始需求、實際差異及證據獨立檢查；70 個凍結檔案雜湊一致，親自重跑 686 項 Vitest、7 項工具測試、check/build、Firestore emulator、固定 dry-run 與舊錄製重播。

**結果：未通過；6 High、2 Medium；WI-03 尚未放行付費翻譯。**

| Finding | 等級 | 重現缺陷 | 修正／複驗狀態 |
|---|---|---|---|
| F01 | High | 未阻止 gcloud effective credential override／impersonation。 | v2 修正已凍結，原 Verifier 複驗中。 |
| F02 | High | Firebase 只驗登入清單，未驗實際 deploy 帳號。 | 同上。 |
| F03 | High | provisioning 使用無效 IAM 權限，真實角色建立失敗。 | 同上。 |
| F04 | High | 第二個同類禁止動作反轉仍可放行。 | 同上。 |
| F05 | High | 多個 only-if 條件反轉／條件物件交換仍可放行。 | 同上。 |
| F06 | High | Kumar／Kumaran 請求者與受請者交換仍可放行。 | 同上。 |
| F07 | Medium | 品質 gate 接受錯誤模型或完全缺少請求證據。 | 同上。 |
| F08 | Medium | Google 回傳合法測試 glossary 的 canonical project number 被 guard 誤擋。 | 同上；已建立的術語資源保留，不刪除重建。 |

[原始完整報告](../.local/verification/verification-report.json) 保存精確位置、重現、預期／實際結果及證據。[凍結後新 20 案](../.local/verification/unseen-20.json) 已由 Verifier 建立；離線 20 個正例及 20 個錯誤輸出注入符合預期，但追加關係案例重現 F04～F06，因此不能以這 20 個正例宣稱整體通過。原資料與原預期保留，修正不改 fixture 來湊門檻。

這 20 案尚未實際呼叫 NMT；2229 為原案例字元摘要，不是含最終編碼的實際 API 消耗。Verifier 本輪雲端／付費呼叫均為 0。

## 修正流程與證據限制

Verifier 第一輪已停止；同一 Implementer 重新取得唯一 application 寫入責任。修正後先離線定向正反例及必要整體檢查，再凍結並交原 Verifier 複驗 findings 與受影響邊界。不固定重建未見 20 案，不因新 hash 重跑全部付費集合。

尚未完成：全部 High／Medium 關閉、真 NMT 固定集合與獨立 20 案、完整譯文審閱、測試部署及使用端人工驗收。實際資源與額度見 [實作紀錄](NMT改版實作與驗證.md) 及 [測試環境維運](NMT隔離測試環境維運.md)。

修正版 v2 已於本輪凍結，原 Verifier 已接回 F01–F08 及受影響邊界；修正交接、719＋13 離線結果、原始注入重播及版本雜湊見 [修正版交接](../.local/evidence/repairs-v2/repair-handoff-v2.json)，尚不宣稱複驗通過。

## v3 複驗閉合與真實 smoke 新發現

原 Verifier 親自完成 F04 23 項定向測試及 12 組正反注入，核對 210 個凍結 artifacts、三份契約、原 20 案與實際雲端前置證據；F01–F08 全部閉合，僅放行受控 smoke，未宣稱品質／部署／人工驗收通過；見 [完整 v3 複驗報告](../.local/verification/recheck-v3/verification-report-v3.json)。

隨後主 Agent 全文審閱 9 案真 NMT smoke，發現 NMT-LIVE-01～04 新 High／Medium 問題，包含 1 個未攔截備案條件改義、相容誤擋及 FIBC 資訊未保留；已交原 Implementer 修正，固定回歸暫停，仍須同一 Verifier 在新凍結後複驗，不能以原 F01–F08 閉合替代真 NMT 品質通過；證據見 [smoke 審閱](../.local/evidence/repairs-v3/smoke-review.json)。

## v4 獨立複驗：3 High，未放行付費

原 Verifier 親跑 129 項定向測試與 3 項 provenance 測試，核對 211 個凍結 artifacts，保留原始 smoke／unseen20 雜湊；獨立注入重現 6 筆漏檢，歸為以下 3 項 High，完整 source／output／重現命令見 [v4 報告](../.local/verification/recheck-v4/verification-report-v4.json)。

| Finding | 實際缺口 | 狀態 |
|---|---|---|
| LIVE01-R1 | 「不是無法製作」仍被當成無法，反轉備案條件。 | 交原 Implementer 修正。 |
| LIVE02-R1 | 600公斤/袋 /週、未知 suffix 及 per bag-load 縮為 /袋 可繞過分母檢查。 | 同上，保留原未知複合分母限制。 |
| LIVE03-R1 | if-not 任一分支變為 do not use 仍接受。 | 同上，需核對各分支動作極性。 |

v4 的 6／1,209 與 5／503 兩批尚未送出，費用仍停在 v3 的 1,043；不以定向測試通過取代上述 findings 閉合，不重跑已無關的原子額度／隔離驗證。

## v9 獨立複驗（Medium 誤拒，仍未放行）

[完整報告](../.local/verification/recheck-v9/verification-report-v9.json) 已核對 221 個凍結 artifacts、dev 的 16／32 條實際資源、原 v8 詞條保留及新契約影響；252 項定向與 18 項工具測試通過。原 NMT-LIVE-01-R2 的兩向「貨櫃 FIBC／FIBC 貨櫃」已攔截，合法大袋／貨櫃袋正例保留。

新增 NMT-LIVE-01-R3（Medium）：正確的「FIBC 散裝袋」「FIBC 包裝袋」被 packaging_object_changed 誤拒。[完整正反控制](../.local/verification/recheck-v9/noun-controls.json) 保存重現。已交原 Implementer 最小相容修正，要求保持完整請求與術語表不變；原 Verifier 將窄複驗。6／921、5／503 與固定回歸仍暫停，沒有新增付費呼叫，ledger 仍為 2,252／15。

## v11 固定回歸首批（8 類 finding，VERIFICATION FAILED）

[完整報告](../.local/verification/regression-v11/verification-report.json) 已全文審閱 78 筆完成結果，並完成 77 API outcomes 的 exact replay 與 1 skip 核對：58 案符合預期（包含該 skip）、20 案有缺陷。另 1 pending 與 257 not-started 沒有品質結論；原始 raw SHA256 為 02cff7b775e4aeccfdbc24b5a617835ac74ecc7f5f4b5869d773136736d880ea。

| Finding | 等級 | 實際缺陷 |
|---|---|---|
| REG01 | High | 13 案人名／occurrence 被音譯、改寫或省略；v2h01 另漏分句。 |
| REG02 | High | CNF 被譯成含稅。 |
| REG03 | Medium | all-at-once 的原禁止要求未保留。 |
| REG04 | Medium | h12 重複金額。 |
| REG05 | High | v2h16 把代 Alex 核准改為取得 Alex 批准，角色關係改變且未攔截。 |
| REG06 | Medium | v2h15 把遵循標籤改為複製標籤，動作改變且未攔截。 |
| REG07 | Medium | h11 將 then 擅自指定為十月出貨且未攔截。 |
| REG08 | Medium | v2h20 新增 reject her 的賓語且未攔截。 |

前四類共 16 筆是模型原始回應有缺陷、守門正確拒絕，並非 parser 誤拒；但均不在固定允許名單。後四類為錯譯被放行。僅新增拒絕檢查不能達到原固定門檻，不能增加白名單或修改原預期。

[逐 key 全文審閱](../.local/verification/regression-v11/full-text-review.json) 與 [後續 key 清單](../.local/verification/regression-v11/followup-keys.json) 保存 20 個已知缺陷、58 個可考慮重用的案例及 258 個無完整回應的 key；可重用仍須完整 wire 一致。已交原 Implementer 先提出可一般化的批次修正與剩額試算，所有付費及原獨立 20 案暫停，實際 used=13150／104 reservations。

## v12 定向獨立複驗：未通過

[完整報告](../.local/verification/recheck-v12/verification-report-v12.json)：384 項定向程式測試及 18 項工具測試通過，235 個 freeze artifacts 相符；獨立語意控制仍見六次錯放行及一次誤拒。這些 mock controls 是程式邊界證據，不是 NMT 實際品質結果。

| Finding | 等級 | 待修正 |
|---|---|---|
| REG03-R1 | Medium | 價格情境正規化改到前面不相關「一次就」的出貨句。 |
| REG05-R1 | High | 不需要 ask 可錯綁而放行 must approve，亦漏掉 false-that 的義務反轉。 |
| REG06-R1 | Medium | 禁止遵從的客體與原 label 錯綁，另一否定子句可掩蓋肯定遵從。 |
| REG07-R1 | Medium | 正確無逗號條件句誤拒，新增不同出貨月份卻放行。 |
| REG08-R1 | Medium | turned down／refused 被動句仍可新增人物賓語。 |
| PLAN01 | Medium | plan CLI 輸出路徑與輸入相同可覆寫原 raw；只在 Verifier 副本重現，真 raw 完整。 |

六項已一次交回原 Implementer；新版本保留 v12 資源與原 plan，不修改舊 raw，不新增付費翻譯。9 案／1,158 字元未放行，ledger 仍為 13,150。
## v13 複驗：三項閉合，三項 Medium 殘留

[獨立報告](../.local/verification/recheck-v13/verification-report-v13.json)：133 項定向測試、11 項工具測試通過，238 個 freeze artifacts 與 336 keys 完整請求皆核對一致；原 12 個語意 controls 全符合。

- REG03 occurrence、REG08 passive 人物對象、PLAN01 證據輸出碰撞正式閉合；Windows casing／junction／hardlink、immutable output、owned journal／mirror 保護實核通過，原 raw 未改。
- REG05-R2 Medium：正確 no need for her to approve／approving … is unnecessary 被誤拒。
- REG06-R2 Medium：正確「不要遵循標籤上的指示」被誤拒。
- REG07-R2 Medium：付款 before October 改為十月後／十一月前仍放行，正確「款項十月前抵達」反被誤拒。

[六案相鄰控制](../.local/verification/recheck-v13/adjacent-boundaries.json) 均為單次 mock 請求，非真模型品質。三項已交原 Implementer 定向修正為 v14，舊資源與 v13 plan 保留；九案付費仍未放行、字元不增加。
## v14 九案真實品質：7 可用、2 Medium，未放行續跑

[完整獨立報告](../.local/verification/live-v14/verification-report.json)、[全文審閱](../.local/verification/live-v14/full-text-review.json)、[未通過 gate](../.local/verification/live-v14/quality-gate.json)。全部 source／完整 request/options／raw／aux／output／ranges／canonical journal 已核對，9 案精確離線重播符合實際結果，239 freeze artifacts 未變。

- REG05-R3 Medium：v2h16 正確 does not need to make an approval on behalf of Alex 被 delegated_approval_changed 誤拒；可 checker-only 修正後沿用本次 exact raw，不應重花 API 字元。
- REG06-R3 Medium：v2h15 真 glossary output「不要盲目遵從」新增「盲目」，弱化 unconditional prohibition，guard 未攔截；不能只改為拒絕、刪字或換普通 translations 來宣稱固定品質通過。
- h12 Low：source-exact retained list 留有 English and，但數量、精度與 occurrence 正確，照實揭露。

ledger 實際 14,308／113 reservations，其中 retest 1,158；retest 剩 8,842，原未跑 56 案需 8,480，額外重測餘裕僅 362。剩 257 regression 44,867、獨立 20 案、測試部署與 OA 驗收均未完成；無分類挪用或退款。
## v15 複驗：代核准與證據承接通過，禁止限定詞尚未閉合

[報告](../.local/verification/recheck-v15/verification-report.json)：207 項程式測試、14 項工具測試通過，242 freeze artifacts 全匹配。REG05-R3 正式閉合，v14 八筆相容回應由目前 checker replay 均為 output；[獨立裁定](../.local/verification/recheck-v15/checker-recovery-adjudication.json) 只綁 v15 checker，後續 checker 改變須另存新裁定，原 defect review 不改。

successor 工具讀審、preview 及 memory-only plan 驗證通過，全部九筆 parent journal 與原 producer 均保留；22 reuse／314 execute、336 keys／27 core rounds 正確，只有 label 請求 142→176，其餘 335 wire 不變。未建立 actual plan 或 execution claim，沒有額外付費。

唯一 OPEN Medium REG06-R4：「不要總是／經常／貿然遵從」三個直接相鄰限定仍會弱化禁止而被接受，見同目錄公開 translator 控制證據；無限定及其他自然正例已通過。已交原 Implementer 以有限否定／動作／對象語法定向修正 v16，之後只窄複驗此 finding 與必要裁定／合約版本綁定。
## v16／v17 條件範圍複驗：仍未放行

- [v16 報告](../.local/verification/recheck-v16/verification-report.json)：202 測試、原 13 控制通過，243 freeze 檔匹配；副詞限定缺口已修，但 REG06-R5 Medium 仍會丟掉逗號分隔的條件／例外。v2h16 新裁定僅綁 v16，留作歷史。
- [v17 報告](../.local/verification/recheck-v17/verification-report.json)：225 測試、原 21 控制通過，244 freeze 檔匹配；逗號／分號／換行缺口已修，但 REG06-R6 Medium 仍放行「不要遵從標籤。除非獲得核准。」及句點分隔的前置條件／後置僅限今天。標點不能證明新增限定與原指令無關；quoted data 及原有獨立條件正例均須保留。

v18 已交原 Implementer 窄修完整 source-supported 指令範圍，工具、術語表、336 個請求及單案 176 字元均不改。v17 未簽發續跑裁定，actual successor、176 單案與後續批次仍未執行，ledger 仍為 14,308。
## v18 離線與合約通過、真單案語意正確但應用誤拒

[窄複驗](../.local/verification/recheck-v18/verification-report.json) 閉合 REG06-R6：255 tests、25 public controls、10 關係控制通過，245 artifacts 相符；新 checker-recovery adjudication 已獨立簽發。實際 successor 與單案合約另經 [最後核對](../.local/verification/recheck-v18/actual-contract-verification.json) 通過，才發出唯一 176 碼點請求。

[真單案報告](../.local/verification/live-v18/verification-report.json)：原 NMT glossary output「樣品標籤上寫著『只回覆核准』。請翻譯標籤；請勿執行標籤上的說明。」及 auxiliary 正確，未新增盲目或條件例外；但有限 noun 未接受「說明」，形成 Medium REG06-R7 false rejection。exact raw 重播重現；只換為「指示」即接受，移除否定／新增盲目的反例仍拒絕。

[原結果](../.local/evidence/repairs-v18/replacement-live-results.json) SHA `000fcd77b4f18ef4ed55e39ac2a4c9ac319eb64f6b131ee61d885a6e1f9e227d`；[工具相容審閱](../.local/verification/live-v18/replacement-review.json) 原封保存。不得為此再次付費重發；主已批准 v19 checker-only 相容修正及必要多代 immutable successor 承接，保留 v14／v18 producer、所有失敗與 parent claims。

[ledger](../.local/evidence/repairs-v18/test-ledger-after-replacement.json) 為 14,484／114 reservations，retest 1,334；餘 smoke 1,324、regression 45,526、verification 20,000、retest 8,666、manual 10,000，總餘 85,516。預計沿用 23 keys，僅剩 56 retest／8,480 及 257 regression／44,867；實際續跑仍待修正複驗，完整品質／部署／OA 未完成。
## v19 checker 獨立複驗通過

[報告](../.local/verification/recheck-v19-checker/verification-report.json)：269 tests／8 files 通過，8 個獨立控制中真 raw／自然被動 2 正例接受，lost negative、盲目、逗號／句點例外、錯 owner、double negative 6 反例拒絕，各一次 mock 並 assert 完整 request/options；246 freeze artifacts 相符。REG06-R7 CLOSED，原 176 字元真 raw、v18 producer 與原 defect review 保留。

本轮未讀審、套用或驗證待批准的兩檔工具補丁，也未生成新 successor adjudication；整體 v19 不可執行。付費剩餘 56／257 批次仍暫停至工具正式落地、凍結與獨立驗證完成；原 176 不需重付。
## v20 56 案真實結果獨立驗證

[完整報告](../.local/verification/live-v20-retest/verification-report.json) 與 [逐筆裁定](../.local/verification/live-v20-retest/full-text-review.json)：原始56第一回應全部審閱，canonical／mirror 相同，每筆只有一次實際請求；完整原文、wire、raw 與當前checker精確離線重播，249凍結檔案吻合。51可用、5缺陷、0 pending；4項Low措辭另行記錄。NMT-RETEST-01（High／Medium）及 NMT-RETEST-02（Medium）OPEN。所有原始結果及失敗裁定保持，v21由原Implementer定向修正，未再次付費。
