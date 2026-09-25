# NMT v21 最後一輪交付

2026-09-25：依使用者最新指示，v21 已部署至隔離測試專案，並將確認的新測試 OA 接至新端點。使用者指定目前 v21 為最後一輪，另明確批准單一測試 mock 相容補丁；沒有追加應用品質修正輪。原三項品質 finding 仍未解，整體 WI 驗收未通過。

| 狀態 | 實際結果 |
|---|---|
| 開發完成 | v21 實作已凍結；仍有1 High／2 Medium，開發驗收未完成。 |
| 測試通過 | 完整自動預檢通過；独立品質驗證 FAILED，固定回歸及原未見20未完成。 |
| 測試區已部署 | 是。dev Function ACTIVE，revision linewebhook-00002-qoh，LINE Webhook active。 |
| 使用者已完成人工驗收 | 否。owner第2版已綁定；私訊/myID已由使用者截圖確認，群組操作待使用者驗收。 |

測試網址：https://asia-east1-line-auto-translate-bot-dev.cloudfunctions.net/lineWebhook 。新測試 OA：Robin Auto Translate／@249opyjp。正式環境未修改。

## WI-01～WI-08

| WI | 實際狀態 |
|---|---|
| WI-01 | 完成正式來源核對、419檔保存快照及隔離worktree。原v13程式、測試及raw保留；原workspace僅AGENTS、總覽及日誌有授權文件更新。 |
| WI-02 | 完成獨立CLI／ADC／Firebase、dev部署設定、runtime SA／Secrets與每次目標核對；沒有沿用正式憑證。 |
| WI-03 | 測試Firestore、bucket、glossaries、Function及新OA Webhook已建立。共用原子ledger已獨立驗證；依最新使用者指示取消總額／分類上限，仍逐次原子記帳且計數失效停止。 |
| WI-04 | nmt-glossary已實作及測試部署，同請求general/nmt＋一般glossary；保留Translator／群組模式／中越隔離，每訊息一次請求、無自動重試或其他模型備援。品質未完整通過。 |
| WI-05 | 保護及自然每箱／每袋計價已有離線驗證，仍有coverage關係漏放／誤拒；未完成品質驗收。 |
| WI-06 | 測試術語表與小量實測、部分固定回歸及全文審閱完成。完整336工作／318 unique／27 core輪次門檻未完成，未放寬允許拒絕名單。 |
| WI-07 | 原Verifier完成獨立code／raw／控制檢查，仍有3項OPEN。LINE空事件連線成功不能替代原獨立20或OA人工驗收，兩者未完成。 |
| WI-08 | 已更新本交付、總覽、維運、日誌及原始證據索引，明確區分凍結、自動測試、品質、部署及人工驗收。 |

## 版本、修改與檔案

- 原工作區：E:\CodexSpace\LINE_OA_中翻英，分支codex-local。
- 隔離worktree：E:\CodexSpace\LINE_OA_中翻英\.local\nmt-worktree，分支codex/nmt-glossary-isolated。
- Git基準：46c5e29a1ff7eb13713139f77483cab521e73cd0；沒有commit／push／PR。
- v21原application freeze：eebacc4730eddb85c5650e75ab5a0d33edc9d56476cceffc1da76178b9567108，251 artifacts；原紀錄保留。
- 已批准的唯一例外為nmt-verifier-repairs.test.ts第5行mock擷取可接受notranslate class。新test SHA-256：74108e165817a6d7a815595515f41d0591d0e9864ecbc8822fde72c16f3e4cf2；其餘250檔完全一致，斷言未改。
- [完整檔案清單](../.local/evidence/owner-bind-v21-20260925/delivery-files.json)、[v21交接](../.local/evidence/repairs-v21/repair-handoff-v21.json)、[測試相容補充freeze](../.local/evidence/repairs-v21/deploy-test-compat-handoff.json)。檔案為UTF-8／Windows CRLF；忽略的raw／auth／evidence不屬於Git可見清單。

修改涵蓋NMT引擎、來源／HTML／人物／商務關係保護、原子帳本、dev身分及部署守門、受控評估／重播／逐筆品質審閱／多代證據接續。35個舊入口守門與先前兩檔successor補丁均有使用者明確批准，只套用隔離worktree，保留舊內容。

v21處理人名span的標準class及未知coverage中性語序／檢查，另以逐key來源、round、完整request/options hash與原producer/review區分舊結果失效原因。45個wire改變、291不變，未改固定集合、品質門檻或glossary；不把舊LLM v13 raw冒充NMT實測。

部署另只補齊九項非秘密dev dotenv參數：[設定來源及值](../.local/evidence/repairs-v21/dev-dotenv-parameter-fill.json)。數字沿用既有預設，姓名清單與評估一致；引擎仍nmt-glossary，舊模型／LLM參數只供Firebase宣告解析，不會因此呼叫其他引擎。

## 測試命令及結果

使用Node v22.23.2、Windows powershell.exe；工作目錄為隔離worktree。

```powershell
node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run check --prefix functions
node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run build --prefix functions
node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run verify --prefix functions
node functions/scripts/nmt-admin.mjs deploy --project=line-auto-translate-bot-dev --execute
```

v21實作階段142定向單元／6檔及45工具測試通過；原Verifier另做18定向／3工具及獨立錯誤注入。單行mock補丁44測試通過，獨立差異核對通過。最終部署prehook親自執行完整verify：1249應用測試／40檔、45工具測試、check及build全部通過。先前1241pass／8fail的stale mock失敗與診斷仍保留，不刪除失敗證據。

[最終prehook與Firebase輸出](../.local/evidence/repairs-v21/firebase-deploy-after-parameters.json)、[補丁獨立核對](../.local/verification/recheck-v21/deploy-test-compat-review.json)、[v21測試命令](../.local/evidence/repairs-v21/validation-results.json)。v20帳本的兩組實際Firestore emulator並行／遷移／重啟／失效驗證通過；v21未改帳本，不無理由重跑。

v20真56案有52output／4rejected，原Verifier完整逐筆判定51usable／5defect。v21沒有新付費翻譯；離線重播不能當新wire模型品質證據。舊raw、第一回應、失敗、pending、reviews及claims完整保留。

## Verification findings

[最終獨立報告](../.local/verification/recheck-v21/verification-report.json) 維持 **VERIFICATION FAILED**：

| Finding | 嚴重度 | 未解問題 |
|---|---|---|
| NMT-RETEST-02-R1 | Medium | 中性涵蓋範圍句後新增「僅限服務」仍被放行。 |
| NMT-RETEST-02-R2 | Medium | 相鄰另一項正確的確認出貨日期句會造成誤拒。 |
| NMT-RETEST-02-R3 | High | 原文must confirm變為「不必確認」仍被放行。 |

[獨立重現](../.local/verification/recheck-v21/independent-controls.json)。原NMT-RETEST-01四筆人物重複／角色錯置已準備新標記輸入，但尚未實測證明改善；原壞raw仍正確拒絕。Low措辭、空格及既有glossary括號問題保留披露。

使用者在知悉品質未過後明確要求部署，再批准單行mock例外；這些授權不改變品質判定。未簽發v21實際回歸計畫、45wire批准或2recovery新承接批准，不恢復付費回歸，不追加v22或更名修正輪。

## 字元消耗及未完成集合

同一帳本nmtEvaluationBudget/approved-20260924已為version2／tracking-only，limit及categoryLimits均null；使用者已取消原100000總上限、分類配額及Codex管制。原子逐次記帳、失敗占用、不退款、計數失效停止仍保留。

[部署後實際讀回](../.local/evidence/repairs-v21/test-ledger-after-deployment.json)：**22964輸入Unicode碼點／170次保留**；smoke3676、regression9474、retest9814、verification0、manual0。包括HTML、空白、標記、輔助contents及一筆歷史pending；不將保留次數冒稱全部成功請求。部署與LINE空事件驗證未增加翻譯消耗。

沒有有限的剩餘字元配額。未批准的v21 preview估計56可沿用、280待執行＝23retest5865＋257regression45807，共51672；其中5原缺陷canary1674屬23子集，未執行、不另加計。原獨立20、完整固定門檻及OA人工驗收未完成。

Codex逐階段未快取／快取／輸出token遙測不可得。角色配置為planner／implementer／verifier Astra/high，實際runtime模型／推理metadata不可觀測；沒有宣稱確認或切换xhigh。

## 實際測試部署

Google ruibbin@gmail.com；GCP及Firebase line-auto-translate-bot-dev／371659743970；帳單014734-3FA407-25CF9A。Function為ACTIVE／Node22／256Mi／60秒／maxInstances5，runtime為nmt-test-runtime@line-auto-translate-bot-dev.iam.gserviceaccount.com；100%測試流量在linewebhook-00002-qoh。

[目前Function metadata](../.local/evidence/owner-bind-v21-20260925/deployed-function.json)、[目前revision與映像](../.local/evidence/owner-bind-v21-20260925/deployed-run-revision.json)。綁定dev Secret版本：LINE_CHANNEL_SECRET=2、LINE_CHANNEL_ACCESS_TOKEN=1、LINE_OWNER_USER_ID=2，已在記憶體核對有效LINE userId格式且非占位；不記錄或公開值。

CLI最後exit1是建立成功後未設定Artifact Registry清理政策；雲端ACTIVE、Ready及ContainerHealthy已直接讀回確認。沒有重複部署、強制清理映像或升級套件。此清理政策尚未設定，後續映像可能累積；既有來源及映像回復證據保留。

新測試OA @249opyjp已核對身分、先對新端點執行官方LINE空事件測試成功200，再改測試Webhook並讀回endpoint正確／active=true。[切換前](../.local/evidence/repairs-v21/test-oa-webhook-before-v21.json)、[連線驗證](../.local/evidence/repairs-v21/test-oa-webhook-target-validation-v21.json)、[切換後](../.local/evidence/repairs-v21/test-oa-webhook-after-v21.json)。依[LINE官方說明](https://developers.line.biz/en/docs/messaging-api/verify-webhook-url/)，此測試只驗證通訊，不代表翻譯品質或手機人工驗收。

舊測試OA端點僅留作歷史參考，未呼叫或修改其背後其他專案服務。正式流量、正式Webhook／Secrets／帳單／登入及群組資料均未改。

## 使用者人工驗收步驟

1. 已完成：私訊新測試OA @249opyjp `/我的ID`，使用者截圖顯示成功回覆；不在報告保存真實ID。
2. 已完成：使用者安全新增dev LINE_OWNER_USER_ID第2版，linewebhook-00002-qoh已綁定。原函式固定綁第1版，不會因新增Secret版本自動改用新版，因此本次重新部署；程式未變。
3. 只在新測試群組按[維運清單](NMT隔離測試環境維運.md)驗證指令權限、中英雙向、原生提及、每箱／每袋USD金額、段落、相同譯文不回覆、中越模式及群組互不影響。普通私訊不翻譯；品質失敗／服務錯誤使用既有離線控制，不破壞雲端服務。
4. 每步記部署revision、時間、使用端實際結果及ledger前後值；目前尚未操作的項目一律未完成。原3項品質缺陷仍需知悉，不把測試環境作正式業務驗收通過。

## 回復基準與限制

首次dev部署來源封存（目前owner2來源見文末）：gs://gcf-v2-sources-371659743970-asia-east1/lineWebhook/function-source.zip#1790294355897703；SHA-256 1f497ecb9bf337946d09208e5458ab44d0be56dcb13f92da9c81d521913397ff。128個runtime／source／package檔案與本機完全相同，沒有缺runtime檔：[逐檔比對](../.local/evidence/repairs-v21/deployed-source-comparison.json)。首次部署映像digest：sha256:27e0a3665dac3af96cad746450226568e087aca00fb1d0cff3c16b0d398de861。來源封存不公開或提交Git。

正式未變，原revision linewebhook-00018-huk、正式來源SHA-256 6f65255fd10ace32c14bb07c89456aaeb4774a48f631c19dafe54655ab26acfa及Git基準已保存；正式封存含私密設定，不可公開。未實際回復，也不保證雲端來源永久存在；日後回復前重新核對，不降低ledger計數、不借用正式Token或資料。

剩餘風險是已知語意漏放／誤拒、人物新wire未實測、有限檢查無法證明一般語意正確、完整固定及未見集合未完成、群組人工驗收未完成。已部署僅代表測試服務可連線。

## owner第2版綁定完成

2026-09-25 使用者完成dev LINE_OWNER_USER_ID第2版後，已重新部署綁定至linewebhook-00002-qoh（ACTIVE）；1249應用／45工具／check/build通過，128個部署檔案與前版相同，原測試OA Webhook連線200且網址未改，ledger22964／170不變，群組人工驗收待使用者確認。

[Secret非內容預檢](../.local/evidence/owner-bind-v21-20260925/owner-preflight.json)、[部署完整輸出](../.local/evidence/owner-bind-v21-20260925/firebase-deploy.json)、[部署後LINE及ledger](../.local/evidence/owner-bind-v21-20260925/post-deploy-validation.json)、[128檔不變證據](../.local/evidence/owner-bind-v21-20260925/source-unchanged.json)。新來源generation1790296021907896、zip SHA-256 09990d4a38f96e8468ec0c1742a4755de44e9f6dfafdc2a2f2a704c40d3841c1；前版來源仍保留。CLI末尾同樣僅因未設定映像cleanup policy回傳exit1，雲端更新已成功、ACTIVE且owner2實際綁定；沒有因此重複部署或修改清理政策。
