# NMT 改版實作與驗證

> 本文件保存合併前的 dev 實作／驗證／部署歷史；文中 `.local/` 證據路徑以原 `.local/nmt-worktree` 為根目錄，現行分支與本機設定位置見 [分支整合紀錄](NMT分支整合紀錄.md)。

> 本文件是實際執行紀錄；未完成狀態不代表放行。原需求見 [開發計畫](NMT術語表改版與獨立測試環境開發計畫.md)。

## 執行狀態（2026-09-25，v21已部署測試區；品質驗證未通過）

| 工作 | 實際狀態 |
|---|---|
| WI-01 | 完成正式來源核對、419 檔保留快照及隔離 worktree；原 v13 程式、測試與 raw 保留。 |
| WI-02 | 測試身分、ADC／Firebase、IAM／Secrets及部署設定已核對；最新授權下dev Function已部署，正式環境未變。 |
| WI-03 | 測試Function、Firestore、bucket、glossaries與新OA Webhook已建；tracking-only ledger原子記帳及失效停止已驗證，22964碼點／170次保留不重置。 |
| WI-04 | nmt-glossary 同請求 NMT＋普通 glossary 已實際接入；介面、群組模式及中越隔離已離線驗證，整體品質尚未通過。 |
| WI-05 | 保護已實作；v21最後一輪仍有1 High／2 Medium品質finding，未通過驗收，沒有追加應用修正。 |
| WI-06 | v11 固定回歸 79 筆因品質停止；v14 真九案為 7 usable／2 defect，其中 1 checker-only 修復可沿用，另 1 已實測 176 字元且語意正確，程式誤拒已修正複驗，該 raw 可沿用；v20 的 56 retest 已全部取得原始結果（52 output／4 rejected），獨立審閱已發現非允許拒絕品質缺陷，257 regression 停止未執行。 |
| WI-07 | 原Verifier獨立檢查／控制完成，品質FAILED；LINE空事件連線200不是人工驗收。owner第2版已綁定；原未見20、完整固定與群組人工驗收未完成。 |
| WI-08 | 已完成如實交付、總覽／維運／日誌與來源／檔案證據；見NMT最終交付v21.md，不宣稱全案驗收。 |

**實作已凍結、開發驗收未完成；完整自動測試通過：是；獨立品質通過：否；測試區已部署：是；使用者已完成人工驗收：否。**

v19 checker 已独立複驗通過，269 定向測試及 8 個獨立控制通過，原176字元 raw 可正常輸出而不重付費；[報告](../.local/nmt-worktree/.local/verification/recheck-v19-checker/verification-report.json)。兩檔 successor 補丁已獲使用者明確批准並套用，38 工具測試及 check/build 通過；[工具證據](../.local/nmt-worktree/.local/evidence/repairs-v19/tool-validation-v19.json)。這些結果不能代替完整 NMT 品質、部署或人工驗收。

使用者最新已取消 Codex 用量管制，並要求取消翻譯 API 累計 100,000 字元及原分類上限。dev-only v2 tracking-only ledger 已通過獨立驗證並完成 live 遷移：保留原子逐次記帳、計數失效即停止、歷史消耗、無重試、身分／資源隔離及完整 producer lineage。遷移本身未呼叫翻譯 API，全部既有計數保持不變。

最新實際 [ledger](../.local/nmt-worktree/.local/evidence/repairs-v20/test-ledger-after-retest56.json)：used=22964、reservations=170；smoke=3676、regression=9474、retest=9814。v20 已沿用23 keys 並執行56 retest（8,480 字元）；257 regression、原獨立20、部署及人工驗收未完成。旧plan及cap欄位為原版本證據，不可直接當新版可執行計畫；新契約、live模式、裁定及plan均須再獨立核對。

以下保留各輪時間點與證據；歷史數字、凍結／待驗文字不是目前狀態。

## 基準與保留證據

- 原工作區：`E:\CodexSpace\LINE_OA_中翻英`，原分支 `codex-local`；未覆寫 v13 程式或原始評估結果。
- 隔離 worktree：`E:\CodexSpace\LINE_OA_中翻英\.local\nmt-worktree`。
- 開發分支：`codex/nmt-glossary-isolated`。
- 基準 commit：`46c5e29a1ff7eb13713139f77483cab521e73cd0`。
- 原工作區 `.local/nmt-execution-20260924/workspace-snapshot/manifest.json` 記錄 419 個保留檔案的 SHA-256；副本逐一核對一致，包含未提交 v13 程式、測試與合成原始結果。
- 正式唯讀核對：`linewebhook-00018-huk`，ACTIVE／100% 流量；沒有切換流量或改正式設定。
- 正式 source：`gs://gcf-v2-sources-886015407043-asia-east1/lineWebhook/function-source.zip#1790213157880275`。
- 下載封存 SHA-256：`6F65255FD10ACE32C14BB07C89456AAEB4774A48F631C19DAFE54655AB26ACFA`。
- 正式封存的 18 個 runtime TypeScript、package.json、package-lock.json、兩個 tsconfig、v8 TSV 均與 Git 基準逐位元一致；未以整套 v13 建立基準。
- Node 22 重建的 54 個 lib 產物與正式封存逐位元一致。
- 正式映像 digest：`sha256:288769e73adeab6b081d07ac5c439a62c6e97f3b412e641e152ee58624c69669`；本輪已唯讀核對 Artifact Registry 可取得。未實際回復，未来操作前須再次核對可用性。
- 詳細本機證據在原工作區 `.local/nmt-execution-20260924/`，摘要副本在隔離 worktree `.local/evidence/`。下載的部署封存可能包含私密環境設定，僅本機保存，不提交。

## 基準測試

| 版本／命令 | 結果 | 限制 |
|---|---|---|
| 46c5e29，Node.js 22.23.2，functions 內 `npm run verify` | 型別檢查、462 項測試及建置通過 | 這是正式基準的离線驗證，不是 NMT 品質證據。 |
| 重建 lib 對正式 source archive | 54/54 SHA-256 相同 | 僅證明本次基準可重建。 |

直接執行 `node scripts/verify.mjs` 的首次操作因缺少 npm_execpath 未執行檢查；改由 npm 正式入口執行後通過。原始成功紀錄：`.local/evidence/baseline-verify.log`。

## 角色、模型與用量

Planner 已只讀核對 WI 依賴與驗收後停止；同一 Implementer 是唯一 application code 寫入負責人；原 Verifier 依每輪凍結差異與原始證據複驗，已閉合舊 findings，最新包裝物 High 正由 Implementer 修正。主 Agent 負責資源、額度、文件與交付，沒有平行重寫應用。三個角色定義及專案設定均為 gpt-6-astra／high，未升至 xhigh；spawn 回傳未提供實際推論模型／推理欄位，無法獨立確認執行端設定。主 Agent 同樣不能僅以專案預設聲稱已核對實際模型。

各階段未快取輸入／快取輸入／輸出 token 的細分遙測不可取得，記為不可得，不以翻譯字元推估。實際翻譯額度以本文件頂端最新 ledger 證據為準。

## 尚未具備的放行證據

- 最新包裝術語疑義的判定、必要修正與獨立複驗，以及完整 NMT 固定回歸和全文品質審閱。
- 凍結後原獨立 20 案的實際 NMT 結果，其中 nv-09 才涵蓋指定的自然每箱／每袋金額語序。
- 測試 Function 部署及端點核對、真正測試 owner Secret 綁定、測試 OA Webhook 切換與人工群組／手機驗收。
- 最終差異清單、未解 findings 和回復證據的交付核對。

runtime IAM、ledger 初始化、owner 占位 bootstrap 已完成；占位值不能代表真人 owner 設定。原 v13 結果只作原版本證據或明確標示的離線重播，不能替代 NMT 實測。

## 第一版 NMT 本機凍結與證據（後續獨立驗證未通過）

- 候選 `nmt-glossary-v1`；application freeze manifest SHA-256 `ddd75be2a087771064ccda157bfe9112e98f89d3eab6ed251557b171f550603b`。
- 離線請求契約 `9b0adf9204376b29bbca2f3a6b1c2e336dfc7896fc08cdee36dec83fce5f01f5`；該次 freeze 尚無雲端 glossary resource 證據，工具刻意阻止 live 使用。雙向資源後已建立；修正完成後須以實際資源重新 dry-run。
- [精簡交接](../.local/nmt-worktree/.local/evidence/nmt-implementation-handoff.json)、[完整 70 檔修改清單與雜湊](../.local/nmt-worktree/.local/evidence/nmt-file-audit.json)、[凍結清單](../.local/nmt-worktree/.local/evidence/nmt-application-freeze.json) 均為本機證據，未假設 Git 忽略檔會自動出現在新 checkout。

| Node.js 22.23.2／隔離 worktree 命令 | Implementer 實際結果 |
|---|---|
| `npm --prefix functions run verify` | 686 項 Vitest、7 項 Node 工具測試、TypeScript check 與 build 通過。 |
| `node functions/scripts/test-nmt-ledger-emulator.mjs` | 20 clients、52 transaction callbacks，10 次成功占滿 manual；跨 client 原子性、交易重試、重啟、分類與總額上限、毀損／缺失拒絕通過。 |
| `node functions/scripts/evaluate-nmt.mjs --dry-run` | 330 邏輯分組去重 318，核心追加 18，336 結果／335 預期 API 呼叫，50,970 碼點。 |
| `node functions/scripts/replay-nmt.mjs --recording=<凍結舊錄製檔> --legacy-tllm --output=.local/evidence/nmt-legacy-replay.json` | 舊 TLLM first-response：368 輸出、19 拒絕、42 請求不相容、1 無回應；只作離線檢查器證據，不是 NMT 品質通過。 |

emulator 的 used=100000 是離線合成測試資料，不是實際付費消耗。本轮真實翻譯仍為 0 字元，剩餘 100,000。

35 個歷史 evaluate／provision 入口守門曾被自動批准審核以影響既有工作流程過廣拒絕；已提供具體 patch 並取得使用者明確批准後套用，只在隔離 test alias 下阻止未接 ledger 的舊工具，保留舊正文。證據：`legacy-guard-proposed.patch`、`legacy-guard-proposed.json`、`legacy-guard-applied.json`。

尚未完成的外部項目：runtime IAM、ledger、owner bootstrap、測試部署、真 NMT 回歸／新未見案例與全文審閱、使用端人工驗收。原指定 dev 已完成獨立 CLI／ADC／Firebase 身分核對、Firebase 啟用、必要 API、runtime SA、Firestore、bucket、雙向 glossary 及三個 Secret 容器；兩個 LINE Secret 版本已核對 ENABLED，未輸出內容。使用者已再次確認 GCP／Firebase 都使用 dev／371659743970，同名 b81bd 不納入本次；细節見維運文件。

## 修正版 v2 凍結（原 Verifier 複驗中）

[修正交接與操作命令](../.local/nmt-worktree/.local/evidence/repairs-v2/repair-handoff-v2.json) 記錄 F01–F08 的修正檔案、證據及精確命令；[完整檔案清單](../.local/nmt-worktree/.local/evidence/repairs-v2/file-audit-v2.json) 與 [凍結清單](../.local/nmt-worktree/.local/evidence/repairs-v2/application-freeze-v2.json) 為本輪候選依據，freeze SHA-256 為 `5cf1c3013c56d7cc4a189667173a9d9f01f7d012430c6aa5fc6f4a6d2e7ea8a6`。

Node 22 的 `npm --prefix functions run verify` 通過 719 項 Vitest、13 項工具測試、check/build；原始 unseen20／relation4 重播為 24 正例接受、24 反例拒絕。TypeScript build 明確輸出 CRLF；ledger/client 的來源及測試逐位元相同，產物僅換行改變，保留並沿用原 emulator 證據。

Dry-run 固定集合仍為 335 請求／50,970 碼點，小量測試 9／1,043，獨立 20 案為 20／2,229；所有 336 筆完整 wire requests/options 與 v1 一致。這些均是預估及离線證據；尚未送出真實 NMT 請求，實際翻譯字元仍為 0。2026-09-24T16:20:47Z 再次唯讀核對 CLI／ADC 為 ruibbin@gmail.com、dev／371659743970 與指定已啟用帳單一致。

## 真實 NMT smoke v3（未通過）

原 F01–F08 已在 [v3 獨立複驗](../.local/nmt-worktree/.local/verification/recheck-v3/verification-report-v3.json) 全部閉合，據此執行凍結 smoke；9 次實際請求、1,043 輸入碼點，ledger reservations=9／used=1043，與逐次 metrics 相符；[實際 ledger](../.local/nmt-worktree/.local/evidence/test-ledger-after-smoke-v3.json) 不含離線 emulator 消耗。

全部 9 案由主 Agent 逐案閱讀原文、輸出及被拒絕的原始 glossaryTranslations：3 可用、5 拒絕、1 未攔截重大備案條件改義，其中拒絕案包括 2 個相容誤擋及 3 個原始 FIBC／單位資訊未保留。原始 [API 結果](../.local/nmt-worktree/.local/evidence/repairs-v3/smoke-live-results.json)、[逐案審閱](../.local/nmt-worktree/.local/evidence/repairs-v3/smoke-review.json) 與 [未通過 gate](../.local/nmt-worktree/.local/evidence/repairs-v3/smoke-gate.json) 全部保留；此部分集合不能宣稱固定回歸通過。

已停止新增固定回歸呼叫並交原 Implementer 修正 NMT-LIVE-01～04：備案條件未攔截改義、自然計價／occurrence 相容誤擋、if-not 條件相容誤擋，以及 FIBC／單位的實際 NMT 保護缺口；先離線重播，再判斷輸入改變後哪些案例必須定向實測，不降低門檻或擴大允許拒絕清單。

實際剩餘總額 98,957；分類剩餘 smoke 3,957、regression 55,000、verification 20,000、retest 10,000、manual 10,000。Google 資源建立／IAM 操作不是翻譯輸入字元，未混入此數字。開發尚在修正、真 NMT 測試未通過、測試區未部署、人工驗收未完成。

## 候選 v4（獨立複驗未通過，交回修正）

[交接](../.local/nmt-worktree/.local/evidence/repairs-v4/repair-handoff-v4.json) 與 [凍結清單](../.local/nmt-worktree/.local/evidence/repairs-v4/application-freeze-v4.json) 記錄 v4，freeze SHA-256 `38c0e1fafd13d635bae9ead49bffd7294a57556522d76c6b735b3bd8d4c73537`；已完成 758 Vitest＋14 tooling＋check/build，之後只追加三個測試控制，31/31 定向測試及 check 再通過，runtime 未再變。

修正針對 NMT 真回應：接受保持原 occurrence 的公斤／袋自然語序及具唯一前件的 if-not；FIBC 與明確禁止換算的重量採可見 notranslate occurrence 保護；只有來源有唯一明確袋型時正規化英文包裝省略句，並阻止條件轉綁備案 FIBC。有限檢查仍不能保證任意商務語義正確。

[精確輸入影響](../.local/nmt-worktree/.local/evidence/repairs-v4/request-impact-v4.json) 顯示固定集合 11 unique／23 jobs 改變，312 個付費請求及 1 skip 的 wire 不變；模型、glossary、fixtures、rubric 與請求參數未變。原 smoke 只有 3 個完全相同請求可沿用，另 6 個明列不相容；把原 raw 注入新版 checker 的結果僅作離線檢查，不能稱新版真 NMT 品質。

待原 Verifier 放行後，先測 6 個受影響核心／1,209 碼點，再測 5 個既有結構／術語案例／503 碼點；兩批不新增未見案例。完整固定回歸預估 335 請求／52,453 碼點；原獨立 20 案預估 2,341 碼點，其中 nv-09 才包含精確每箱 USD 9.50／每袋 USD 2.40 的自然語序實測，不能以結構 smoke 冒充該項驗證。以上尚未新增付費呼叫，實際累計仍是 1,043。

v4 獨立複驗結果：3 High 未閉合（LIVE01-R1 否定無法的條件反轉、LIVE02-R1 空白／未知複合分母延伸、LIVE03-R1 分支否定動作漏檢）；原 F01–F08 閉合維持，LIVE04 只有離線保護證據。依 [v4 完整報告](../.local/nmt-worktree/.local/verification/recheck-v4/verification-report-v4.json) 暫不放行兩批付費測試，已交原 Implementer 修正；實际累計仍為 1,043 字元。

## v5／v6 定向修正進度

v5 定向 242 tests／check/build 通過，原 Verifier 在 [v5 報告](../.local/nmt-worktree/.local/verification/recheck-v5/verification-report-v5.json) 閉合 LIVE01-R1 與 LIVE02-R1，但 action 前的 prohibited／forbidden／not permitted to use 仍可漏檢，LIVE03-R1 保持 High；因此仍未新增付費請求。

v6 補齊同分支動作前後的禁止語態，保留合法偏好、允許、if-not 與來源本身禁止正例；201 定向 tests／check/build 通過，原 13 筆邊界重播 4 正例接受／9 反例拒絕。[精簡交接與命令](../.local/nmt-worktree/.local/evidence/repairs-v6/repair-handoff-v6.json)，[凍結清單](../.local/nmt-worktree/.local/evidence/repairs-v6/application-freeze-v6.json) SHA-256 `7840840f1152ebe3015db743edfd3989a1b5f7167903f1f578083fd9bcc14b2c`。五份完整請求契約的 wire 與 v5 相同；沒有因版本或程式 hash 改變重新呼叫 API，實際用量仍為 1,043，原 Verifier 複驗中。

## v6 放行後的前置受阻（未新增扣額）

原 Verifier 在 [v6 報告](../.local/nmt-worktree/.local/verification/recheck-v6/verification-report-v6.json) 閉合全部已知程式 finding，允許先測 6 個受影響案例。實際執行在首案 485ms 後以 service_or_guard_error 停止，僅完成 1 個受阻結果／預期 6，沒有自動重試或繼續其餘案例；[原始受阻記錄](../.local/nmt-worktree/.local/evidence/repairs-v6/affected-smoke-live-results.json) 保留。

[停止後實際 ledger](../.local/nmt-worktree/.local/evidence/test-ledger-after-smoke-v6-stop.json) 仍是 used=1043／reservations=9；該首案雖有 230 字元請求與 attempted metric，並未新增成功保留，因此不能把它記成新增實際翻譯消耗，也沒有退款或重置。原錯誤記錄未含足夠階段資訊，Implementer 正補只含白名單階段／代碼／HTTP status 的安全診斷及非付費 transport 身分檢查入口，定位前不再執行翻譯。

## v7 安全診斷與 v8 配額專案修正

v7 安全診斷經 [獨立複驗](../.local/nmt-worktree/.local/verification/recheck-v7/verification-report-v7.json) 通過後，非付費 transport-identity 在 identity.billing 回傳 429，reservation／provider 均 not_started；[安全結果](../.local/nmt-worktree/.local/evidence/repairs-v7/transport-identity-live.json)。進一步只讀配額 metadata 證明，ADC quota_project_id 是 dev，但未帶 header 的 billing REST 實際 consumer 為 projects/764086051850，碰到 400/min 的 StandardQuotaPerMinutePerProject；[原始受限 metadata](../.local/nmt-worktree/.local/evidence/repairs-v7/billing-quota-diagnostic.json)。同 ADC／同 billingInfo 加上明確 dev header 即回 200，帳單 ID 與啟用狀態正確；[對照證據](../.local/nmt-worktree/.local/evidence/repairs-v7/billing-quota-explicit-test-project.json)。

依 [Google REST 認證規則](https://docs.cloud.google.com/docs/authentication/rest) 與 [quota project 規則](https://docs.cloud.google.com/docs/quotas/set-quota-project)，raw fetch 只取 access token 會略過 Google Auth client 自動附加的配額 header。v8 因此只把 Cloud billing／IAM 身分 GET 固定至 x-goog-user-project=dev；tokeninfo 不加，translation POST 原本已有正確 dev header，請求 body／URL／guard／ledger 不變。此修正沒有提高 quota 或轉用其他專案，不代表原 9 次翻譯消耗了其他專案的翻譯配額；原 v6 未保留細節，仍不能倒推該歷史失敗的確切原因。

v8 的 43 tests／check/build 通過，403／429 仍不保留、不送翻譯、不重試；[交接](../.local/nmt-worktree/.local/evidence/repairs-v8/repair-handoff-v8.json) 與 [凍結清單](../.local/nmt-worktree/.local/evidence/repairs-v8/application-freeze-v8.json)，SHA-256 `58e0ee25a064fee9decfc21a08789e7de75f01b8bef4c06bbf298afc51627a12`。五份翻譯契約完整沿用，待原 Verifier 窄複驗及非付費實核後才恢復原受控 smoke；實際翻譯消耗仍為 1,043。

## v9 術語與包裝物修正（獨立複驗有 Medium，待修）

保留原 en-zh-v8 的 28 條與雲端資源，新增 en-zh-v9 的 4 條完整 FIBC bag(s)／bulk bag(s)，共 32 條。英文來源的完整片語連續可見以供一般 glossary 套用；單獨 FIBC 維持保護，輸出仍核對來源 occurrence、段落與袋型，不自行补袋。兩方向的貨櫃衝突檢查補齊，合法貨櫃袋正例保留。

303 項定向測試、18 項工具測試、check/build 通過；原 v8 真回應重播確認 rough 改為拒絕，不能據此宣稱該核心案例可用。主 Agent 已在隔離身分下只建立新 en-zh-v9，實核 32 條；zh-en-v8 維持 16 條，沒有翻譯呼叫或 ledger 操作。資源：[v9 record](../.local/nmt-worktree/.local/evidence/nmt-glossary-resources-v9.json)，SHA256 d7642d0db7672acebd7d85617e761589d396ad0d09d1c1d1aa7305eb3b70353c。

[最終交接及命令](../.local/nmt-worktree/.local/evidence/repairs-v9/repair-handoff-v9.json)、[凍結清單](../.local/nmt-worktree/.local/evidence/repairs-v9/application-freeze-v9.json)，freeze SHA256 c3cf7765d5a69ce2236c194d10748d27ae32e51eb0864a96317eeaa1dd20a0af。內容改動影響 9 unique／19 jobs；新英翻中 glossary ID 使 165 unique／177 jobs 的請求契約改變，158 個中翻英付費 jobs 及 1 skip 保持完整 wire 不變。舊英翻中 raw 不能標為新術語實測。

待獨立複驗後，先執行 6 個英文核心／921 碼點（含僅術語資源變更的 tentative），全文品質全過再測 5 個結構／503 碼點；不重跑無關中翻英。固定回歸為 335 次／51,389 碼點，原獨立 20 案為 2,285 碼點。實際消耗仍為 2,252，以上均未執行，不代表品質通過或已部署。

## v10 相容修正及實測（新 occurrence 誤擋待修）

[獨立 v10 複驗](../.local/nmt-worktree/.local/verification/recheck-v10/verification-report-v10.json) 閉合 R3，202 項定向測試及 22 個獨立控制通過；五份 wire 契約保持 v9 不變。據此完成 6 個英文核心／921 碼點實測，[原始結果](../.local/nmt-worktree/.local/evidence/repairs-v10/affected-smoke-live-results.json) 為 5 output／1 rejected；output 不等於完整品質通過。

新版術語實際保留袋型，但 split 的正確原始「600公斤FIBC袋」被 quantity_unit_or_content_changed 誤擋：中文重量單位後的英文邊界檢查把 FIBC 當成延伸，導致重量失配。已定位可由同段落、來源可追溯的 occurrence 還原修正，不需改 wire；原始回應不改寫。rough 另有單一多餘右括號，正在按原 rubric 判定；未隱藏或挑选成功結果。後 5 案及固定回歸維持暫停。

[最新實際 ledger](../.local/nmt-worktree/.local/evidence/repairs-v10/test-ledger-after-affected-smoke.json) 為 21 次保留／3,173 碼點；smoke 剩 1,827，總剩 96,827。預期 checker-only 修正優先重播這批完整錄製回應，不因版本號改變重跑六案。

## v11 複驗通過後的固定回歸（部分執行，未通過）

[獨立複驗](../.local/nmt-worktree/.local/verification/recheck-v11/verification-report-v11.json) 已閉合 LIVE05，258 定向測試與 10 個獨立邊界控制通過；原 v10 六筆完整 exact replay 全可用，沒有重新付費六案。後續五個結構／術語實測全部可用，逐案 [全文審閱](../.local/nmt-worktree/.local/evidence/repairs-v11/structure-smoke-review.json) 保留理由；其 quality gate 唯一問題是 partial-scope-cannot-pass-full-regression，不能用這五案宣稱全量通過。Low LIVE06 的多餘右括號保留揭露。

據此啟動凍結固定回歸，Verifier 同步分批全文審閱。出現多個非允許名單拒絕與角色／指令改義後，主 Agent 於 2026-09-24T18:42:42.750Z 停止經命令列核對的唯一回歸 Node 程序；[停止證據](../.local/nmt-worktree/.local/evidence/repairs-v11/regression-stop.json)。沒有啟動獨立 20 案。原始 [checkpoint](../.local/nmt-worktree/.local/evidence/repairs-v11/regression-live-results.json) 保存 79 rows：61 output、16 rejected、1 skipped、1 pending；output 不是品質判定，pending 不當作成功或已知品質失敗。

[停止後 ledger](../.local/nmt-worktree/.local/evidence/repairs-v11/test-ledger-after-regression-stop.json) 實核 used=13150／reservations=104，smoke=3676、regression=9474。分類剩額：smoke 1324、regression 45526、verification 20000、retest 10000、manual 10000；合計 86850。停止時已在途的保留不退款；後續修正先用原始 raw 重播，只有 wire 改變或缺少 raw 才重新判斷必要付費範圍，不能重跑已消耗的整批來掩蓋失敗。

## REG01–REG08 批次修正核准範圍（實作中，成本仍為預估）

主 Agent 已批准有限的 EN→ZH 姓名／貿易縮寫可見保護、明確語法下的等義來源整理、retain 数值清單逐項可驗的保護群組，以及代核准／遵從指令／時間指涉／無來源受詞的檢查。不得按 caseId 寫答案、刪改模型錯譯、補原文未定義的物件或指涉；不確定語義不擅自正規化。規劃新增 ZH→EN 普通術語「已拒絕→declined」，所有既有 TSV、雲端資源及 resource record 均保留；尚未建立新資源。

新增保護採精簡 translate=no span；[Google 官方說明](https://docs.cloud.google.com/translate/troubleshooting) 明列在 text/html 中支援該屬性。只調整有必要的新保護，其他既有 wire 儘量不變；仍須實際 NMT 檢查，文件支援不等於本案品質已通過。

| 規劃範圍 | 筆數 | 預估碼點／限制 |
|---|---:|---|
| 未開始，regression | 257 | 44,867；分類剩 45,526，預估餘 659。 |
| 受影響舊可用＋已知缺陷＋pending 的新 attempt，retest | 44＋20＋1 | 合計 9,638；分類上限 10,000，預估餘 362。 |
| 完整 wire 不變的原證據 | 14，含 1 skip | 須核對來源 hash、producer、key／round、完整 request/options/raw，不新增呼叫。 |
| 先行根因檢查 | 上述 retest 中的 9 案 | 預估 1,158，通過後直接納入，不重跑該九案。 |

現有單一 recording／resume 不足以安全拼合跨版本證據，因此批准最小的完整評估計畫、按 key 分類批次及證據引用清單。完整 336 keys／27 核心 rounds、原 fixtures／rubric／允許拒絕名單保持；不允許複製一個 response 充當兩輪、改標舊 producer、把 pending 當成功、只挑成功結果，或覆寫失敗來源。新增單一執行鎖與 provenance 拒絕測試；ledger 及各分類上限完全不改。

以上成本須在實作後重新編碼、dry-run、核對實際餘額並獨立驗證；不能以預估充當已放行。若超額，停止新增付費並列出不足；不挪用其他分類或提高上限。目前仍保守占用 13,150。

## v12 凍結與實際評估計畫

- Application freeze SHA-256：`780d9943d73f9407bf331a5978be3ba369845e15ff199dabaac90f42ab4ce39e`；[完整交接](../.local/nmt-worktree/.local/evidence/repairs-v12/repair-handoff-v12.json)。
- `npm run verify --prefix functions`（Node 22）：978 項程式測試／31 檔、26 項工具測試、check/build 通過；[日誌](../.local/nmt-worktree/.local/evidence/repairs-v12/verify-release.log)。
- 新 ZH 資源 `nmt-trade-zh-en-v12` 17 條已建立，EN 保留 `nmt-trade-en-zh-v9` 32 條；兩者皆在測試 projectNumber 371659743970，舊資源與原證據保留，[實際資源](../.local/nmt-worktree/.local/evidence/nmt-glossary-resources-v12.json)。
- [不可變評估計畫](../.local/nmt-worktree/.local/evidence/repairs-v12/evaluation-plan-v12.json) hash `d87769ff5c0217382003747c89583e46cade7295c179883e11ddcf91b051e06d`，336 keys／335 requests；沿用 13 筆真實付費 raw＋1 skip，只對完整請求相容者沿用原 producer 身分。
- [九案合約](../.local/nmt-worktree/.local/evidence/repairs-v12/retest-canary-contract.json) hash `7956e5053633e444cd96ac5da3122a00322813e40fbfe8d822582baaf6ac4cb9`，retest 1,158 碼點，包含在 65 案／9,638 中，實際執行待原 Verifier 放行。
- 本階段未送出新翻譯請求，ledger 仍為 13,150。新請求、術語表與語意修正的品質仍待實測；回歸及重測計畫完成後分類餘裕僅 659／362 碼點，不能挪用其他分類。
## v13 定向修正與凍結

[交接](../.local/nmt-worktree/.local/evidence/repairs-v13/repair-handoff-v13.json) 與 [檢查命令／結果](../.local/nmt-worktree/.local/evidence/repairs-v13/validation-results.json)：133 項受影響測試／4 檔、11 項 plan／collision 工具測試、型別檢查及建置通過；未無理由重跑完整套件或 ledger emulator。

- freeze SHA-256 `95ff3fb4d1c576a2f579919cb6908708f06bae59bdbd7913afe615ad21f8b307`，原 Verifier 六項複驗中，尚未放行。
- [完整 wire 核對](../.local/nmt-worktree/.local/evidence/repairs-v13/request-inheritance-v13.json)：336 keys 的來源、ranges、round、完整 request/options 與 v12 相同，成本維持 44,867 regression＋9,638 retest，原 9 案／1,158 是 retest 子集。
- [新 plan](../.local/nmt-worktree/.local/evidence/repairs-v13/evaluation-plan-v13.json) hash `39720e3dbed4e2367cd27e9ac50a866b08cadd23ac992276eeb2a62441538214`；[canary](../.local/nmt-worktree/.local/evidence/repairs-v13/retest-canary-contract.json) hash `3ea1a050257429b0ba2f8b9fcee583fff308a0ef1676b7d933cd53c6a50a522d`。
- 保留 v12 資源／plan／原 raw，未再建立 glossary，未新增 cloud／paid call；字元仍為 13,150，新模型品質、完整回歸、独立 20 案、部署與人工驗收未完成。
## v14 複驗通過與九案真實定向重測

[窄複驗報告](../.local/nmt-worktree/.local/verification/recheck-v14/verification-report-v14.json)：REG05-R2、REG06-R2、REG07-R2 全閉合；188 測試、28 獨立 controls 通過，239 freeze 檔相符。完整 request 與 v13 相同。

依既有授權執行凍結九案，入口核對測試身分／資源及 ledger；9／9 completed，8 output／1 rejected，無自動重試。[本次原始結果](../.local/nmt-worktree/.local/evidence/repairs-v14/retest-canary-live-results.json) SHA-256 `6dc357d3c4e7c4fe4309152be2ff8a8c4c06a7a06d8b2b28ddd89e8fdcab8a7c`，實際新增 retest 1,158，累計 14,308。

獨立全文初核發現兩項 Medium：v2h16 正確 make an approval on behalf of Alex 被誤拒；v2h15「不要遵從」被弱化為「不要盲目遵從」且漏放。後 56 retest／257 regression 暫停，正式審閱為 7 可用／2 defect，見 [報告](../.local/nmt-worktree/.local/verification/live-v14/verification-report.json)；九案完成不代表品質通過。
## v15 最小修正與 successor 計畫（實作中，未執行）

[已核准提案](../.local/nmt-worktree/.local/evidence/repairs-v15/successor-plan-proposal.json)：checker 修正已通過 159 項定向測試及 check/build，v14 九筆 exact raw 離線重播為 8 output／1 rejected；獨立修正複驗尚未完成。

唯一預定 wire 改動為明確引述標籤指令的否定句改用 do not carry out the instruction on the label，保留原 quote、auxiliary 與其他上下文；離線成本 v2h15 142→176 碼點，其餘 335 keys 不變。此 176 字元為必要 retest replacement，尚未呼叫 API。

successor 計畫將引用 v14 parent plan 及全部九筆 canonical journal，保留 v11 原 producer、v14 原失敗與 review；v2h16 須另有獨立 checker-recovery adjudication 才能沿用。預計 22 keys 沿用、314 執行（257 regression 44,867；56 retest 8,480＋單案 replacement 176），結束後 retest 餘 186、regression 餘 659；不挪用其他分類。工具／lineage 完成並凍結後，仍須原 Verifier 複驗及補充獨立 adjudication 才可產生可執行 plan。
## v19 checker 凍結與待批准工具補丁

[checker 交接](../.local/nmt-worktree/.local/evidence/repairs-v19/checker-handoff-v19.json)／[凍結](../.local/nmt-worktree/.local/evidence/repairs-v19/checker-freeze-v19.json) SHA `e43e67db977095f20d3042ba7ef8d3d28c563a2f0ad85c3caeb68e306c5f78e1`：269 tests／8 files、check/build 通過；同 v18 176 字元原 raw 精確重播為 1 output、0 rejected、0 incompatible。336 完整 request/options、rubric、resources 全同，無新增 API 請求；原 Verifier 已通過 checker 窄複驗，此時尚未放行整體執行。

多代 successor 具體 [補丁](../.local/nmt-worktree/.local/evidence/repairs-v19/successor-multigeneration-proposed.patch) SHA `6af203572000b259fec618d221e0fca271d0cabf0402e800643fe7825d882535` 與 [摘要](../.local/nmt-worktree/.local/evidence/repairs-v19/proposal-review-summary.json) 已保存、未套用、未測試，只涉及 `nmt-evaluation-plan.mjs`／`nmt-successor-plan.mjs`。過渡修改已由 Implementer 復原並核對兩工具與 v18 byte-exact；沒有啟用半成品。

自動批准審核拒絕該工具修改，理由為涉及持久化安全／授權邊界，缺少此具體範圍的明確使用者授權；已向使用者提出一次具體兩檔補丁批准請求，等待答覆，不繞過拒絕。提案保留現有 ledger、上限、原子保留、無重試、live identity、共享 lock、全部舊 claims 與原證據，只增加完整 ancestry 讀驗與避免舊 parent 重複執行的保護。

[目前交付檔案清單](../.local/nmt-worktree/.local/evidence/delivery-files-v19-checker.json) 記錄分支、base 與 114 個 Git 可見變更檔案雜湊；全數 UTF-8／CRLF。這是階段快照，不表示工具、完整品質、測試部署或人工驗收完成。原始資料與憑證仍在 ignored local evidence，沒有提交／推送。
## 最新阶段交付：checker 通過，等待具體工具補丁批准

[獨立 v19 checker 報告](../.local/nmt-worktree/.local/verification/recheck-v19-checker/verification-report.json) 已閉合 REG06-R7，269 tests／8 files 及 8 個獨立 public controls 全通，246 個 frozen artifacts 相符；相同 v18 producer／原始 176 字元回應正常輸出，沒有改 raw、沒有重付費。此結論只適用 checker，不代表未套用工具已驗證或完整品質已通過。

[實際命令與結果](../.local/nmt-worktree/.local/evidence/repairs-v19/checker-validation-v19.json) 使用 Node 22.23.2：`npm run check --prefix functions`、`npm run build --prefix functions`、列明八檔的 `vitest run`、`replay-nmt.mjs --recording=...repairs-v18/replacement-live-results.json` 全部 exit 0；獨立 Verifier 另重跑相同定向範圍與關係控制。未因版本 hash 改變重跑全量付費或 ledger emulator。

後續仍需：取得兩檔具體補丁批准後套用與測試；凍結工具並獨立驗證多代證據／兩筆恢復裁定／實際續跑 plan；56 retest（8,480）、257 regression（44,867）、原獨立 20 案、測試 Function 部署／test OA Webhook 核對及人工驗收。預計沿用 23 keys、執行 313；此為未驗證的工具提案成本，不是已執行紀錄。ledger 用量 14,484、餘 85,516；沒有放寬品質門檻或允許拒絕名單。

剩餘風險：全固定集合與獨立20未完成、未知語法可能保守拒絕、Low 括號／retained-list English and 仍揭露；source archive／正式 revision 的可核對回復基準見本文件基準章，實際未回復正式服務。人工驗收順序及 owner placeholder／既有 test OA endpoint 限制見 [維運文件](NMT隔離測試環境維運.md#使用者人工驗收步驟尚未執行)。
## v20 tracking-only 模式凍結（live 尚未遷移）

依使用者明確取消本次測試累計字元及分類上限的指示，新增精確 dev project 才能使用的 v2 tracking-only ledger；v1 原上限／預設及歷史契約仍照原樣讀驗。新模式仍在每次請求前以持久交易記錄全部 contents，保留歷史計數、safe-integer／分類總和驗證、失效停止、每次 30,000 單請求限制、15 秒與無重試。

[交接](../.local/nmt-worktree/.local/evidence/repairs-v20/repair-handoff-v20.json)；application freeze SHA `e277e71eaf50b10bd74cb117198e03bb1d9f83f7728a776ccc7d561af69294bc`。check/build、70 項受影響單元測試／3 檔及 42 項工具測試通過；未改 quality checker，沿用其已獨立通過的 269 項證據。336 完整 model wire 全同，23 reuse／313 execute，retest 8,480＋regression 44,867。

真 localhost Firestore emulator 驗證 v1 cap、2 個同時遷移者、8 個 tracking clients、重啟及失效保護，最終 synthetic used=175001／reservations=19、113 transaction callbacks；[結果](../.local/nmt-worktree/.local/evidence/repairs-v20/emulator-2026-09-24T22-35-06-096Z/result.json)。首輪較高競爭的 emulator lock timeout 原日誌保留，未加入 provider 翻譯重試。

原 Verifier 正獨立驗證。獲放行後由主 Agent 執行 `node functions/scripts/nmt-admin.mjs enable-tracking-only --project=line-auto-translate-bot-dev --execute`；單一交易保存不可覆寫的原 ledger history 並只改 policy，原 used／reservations／categories 保留，重跑為冪等核對。此命令尚未執行，live 仍為最後實核 14484／114。新 recovery template 兩筆 pending，preview 不可執行；須 migration actual record＋新獨立裁定後才能建立 actual successor，仍需最後核對才續跑。
## v20 僅記帳模式與實際接續計畫

獨立驗證見 .local/verification/recheck-v20/verification-report.json；70 項定向單元測試、42 項工具測試、型別檢查、建置及独立 Firestore emulator 並行／遷移／失效測試通過。live 遷移歷史保存於 nmtEvaluationBudget/approved-20260924/policyHistory/tracking-only-20260925；總上限與分類上限均為 null，used=14484、reservations=114 與分類值未變。遷移讀回證據明確區分 admin 執行與事後 Firestore 讀回。

實際 successor-plan-v20.json planHash=a0ed781bca430d7a44c9d6d12f0bc7829df34f95b3a82451a37775de00ba34f4；56 案 retest 契約 a4f75e45d3f442e0108a5a477fa5a89c8bc686329f43b152f68a3197b290ee10，8480 輸入字元。原 23 案沿用，剩餘 313 案待執行；付費執行前由原 Verifier 核對實際契約。本節不代表完整品質通過、部署或人工驗收。

## v20 真實 56 案重測完成，後续派送因品質 finding 停止

受控 execute exit0，56/56 complete：52 output、4 rejected，無 pending。live ledger 新增8480／56，used22964／reservations170；tracking-only 模式維持。原 Verifier 已確認 price-inclusion 人物重複，程式 exact_occurrence_changed 正確拒絕，但不是原允許拒絕案例；因此不能算品質通過。完整審閱為51可用／5缺陷，四笔人物重複或角色錯置，另一筆將未知涵蓋範圍補成服務；原Implementer正定向修正，257／獨立20／部署未啟動，不因取消額度上限降低品質門檻。

## 最後一輪修正邊界

2026-09-25 使用者指定目前進行中的 v21 為最後一輪修正，不另外起算。完成既定 v21 並凍結後，只做必要測試與獨立驗證；若仍有未解 Blocking／High／Medium，停止後續付費及部署，交付未完成清單，不開 v22、不更名追加修正輪，品質門檻維持。

## v21 最後一輪實作凍結

[交接](../.local/nmt-worktree/.local/evidence/repairs-v21/repair-handoff-v21.json)、[測試命令與結果](../.local/nmt-worktree/.local/evidence/repairs-v21/validation-results.json)、[修改檔案清單](../.local/nmt-worktree/.local/evidence/repairs-v21/delivery-files-v21.json)。隔離分支 codex/nmt-glossary-isolated、HEAD 基準 46c5e29a1ff7eb13713139f77483cab521e73cd0，應用 freeze eebacc4730eddb85c5650e75ab5a0d33edc9d56476cceffc1da76178b9567108。119 個 Git 可見修改／新增檔案均為 UTF-8／CRLF，完整 raw/auth/evidence 留在忽略目錄，不含在此 Git 清單。最終文件更新可能改變文件雜湊，應用 freeze 不變。

修正 EN→ZH 人名 span 加標準 notranslate class、未知涵蓋範圍的中性語序與防止新增分類檢查；保留原人物 occurrence 守門。必要 successor 擴充以逐 key 來源、前後完整 request/options hash、原 producer/review 與明確批准區分「舊回應正確但請求已變」和「原品質缺陷」，不抹掉歷史。

142 個定向單元測試／6 檔、45 個工具測試、型別檢查與建置通過。原四筆壞人物 raw 仍拒絕；原 services 誤放行 raw 現拒絕。完整 v20 56 回應對 v21 exact replay 為35可沿用、21因請求改變不能當新版本證據；合併祖先共56可沿用。336 keys中45 request改變、291不變；待執行280＝257 regression（45807字元）＋23 retest（5865字元）。原五缺陷最小canary為1674字元，是23子集，其後remaining僅18／4191，不另重付一次。

上述只是本機驗證；新模型輸出品質尚未實测。45逐key wire批准、2筆新checker-recovery裁定及原Verifier獨立驗證尚待完成，preview不可執行，actual plan／claim尚未建立。無新glossary或cloud變更。本輪凍結後不再追加修正；若未解B/H/M，停止付費及部署，交付未完成。

## 最新交付與部署狀態

完整結果見[NMT v21交付](NMT最終交付v21.md)。v21獨立驗證3項OPEN（1High／2Medium），未追加修正。使用者之後明確要求dev部署，但完整預檢1241pass／8fail阻擋，Function不存在，ledger22964／170不變。8項由同一stale mock造成，僅一檔一行相容補丁已準備待使用者批准，原斷言／應用不變；尚未套用、未部署、未人工驗收。

## 最終部署及交付里程碑

2026-09-25 使用者知悉v21三項品質finding後仍明確要求dev部署，並批准單一測試mock相容例外；完整1249應用測試、45工具及check/build通過。dev已ACTIVE於linewebhook-00001-gor，新測試OA @249opyjp已接dev且LINE空事件連線200。原品質FAILED／最後一輪限制不變，沒有新增付費回歸或應用品質修正，owner占位及人工驗收未完成；帳本22964／170未變。

[最終交付](NMT最終交付v21.md)列出完整WI狀態、修改檔案、測試、finding、字元數、測試OA人工步驟與回復基準。128個上傳runtime/source/package逐檔比對吻合，測試映像與來源generation已保存。CLI清理政策後處理未設定不影響實際ACTIVE，未強制清理。

## owner Secret綁定里程碑

2026-09-25 使用者完成dev LINE_OWNER_USER_ID第2版後，已重新部署綁定至linewebhook-00002-qoh（ACTIVE）；1249應用／45工具／check/build通過，128個部署檔案與前版相同，原測試OA Webhook連線200且網址未改，ledger22964／170不變，群組人工驗收待使用者確認。
