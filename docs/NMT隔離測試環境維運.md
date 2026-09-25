# NMT 隔離測試環境維運

> v21已部署隔離dev，Function ACTIVE／linewebhook-00002-qoh，新測試OA @249opyjp Webhook連線200；原品質FAILED、owner第2版已綁定，群組人工驗收未完成。帳本tracking-only／22964碼點，無新付費回歸。最新交付見 [NMT v21交付](NMT最終交付v21.md)。

## 已提供的目標與待核對項目

| 項目 | 設定／狀態 |
|---|---|
| 測試 Google 帳號 | ruibbin@gmail.com，獨立 CLI／ADC／Firebase 身分均已實核 |
| 測試專案 | line-auto-translate-bot-dev，已核對 ACTIVE；projectNumber 371659743970 |
| 新帳單帳戶 | 014734-3FA407-25CF9A，已核對測試專案綁定且 billingEnabled=true |
| 新 LINE OA／Messaging API | 兩個測試 LINE Secret 版本已核對 ENABLED；bot/info 為 Robin Auto Translate（@249opyjp），使用者已明確確認為新測試 OA |
| runtime service account | 已建立 `nmt-test-runtime@line-auto-translate-bot-dev.iam.gserviceaccount.com`，執行所需 IAM 已建立並保存唯讀核對證據 |
| ledger／Firestore／glossary | Firestore 與 bucket 已建；目前使用 `nmt-trade-zh-en-v12`／`nmt-trade-en-zh-v9`，已核對 17／32 條（新增 已拒絕→declined，舊 zh-en-v8 16 條保留），原 en-zh-v8 28 條保留，canonical 名稱檢查已修正並通過實際核對；ledger 已使用170次保留，used=22964／tracking-only，總額及分類上限null（smoke3676、regression9474、retest9814） |
| 測試部署與 Webhook | ACTIVE；https://asia-east1-line-auto-translate-bot-dev.cloudfunctions.net/lineWebhook；測試OA已接此端點並active，LINE空事件成功200。 |

## 本機登入

本機命令預設使用 Windows 內建 `powershell.exe`，不假定已安裝 `pwsh`。原工作區 `.local/nmt-execution-20260924/Login-Test.ps1` 是本次登入輔助腳本；它將 CLI 與 ADC 寫入隔離 worktree `.local/nmt-auth/gcloud`，不修改預設 gcloud 登入。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\CodexSpace\LINE_OA_中翻英\.local\nmt-execution-20260924\Login-Test.ps1"
```

两次授權均選 `ruibbin@gmail.com`。腳本含中文路徑，採 UTF-8 BOM／CRLF 供 Windows PowerShell 5.1 讀取。Bypass 僅限該程序；不改系統執行原則。密碼、OAuth 授權碼、Token、Secret 不貼入對話或文件。

ADC 路徑必須明確指定到隔離目錄的 `application_default_credentials.json`；Firebase 部署不得沿用其他帳號登入。實際部署／評估入口須驗證身分、project、billing、runtime SA、model、glossary，不能只驗環境變數。Firebase 使用獨立 `XDG_CONFIG_HOME=.local/nmt-auth/firebase`；本機預設 Node 24 曾導致 CLI libuv 例外，後續操作固定使用 Node 22.23.2。具體修正後命令待獨立複驗完成補入。

## 付費翻譯與證據

- 所有實際翻譯共用持久 ledger，送出前以 Unicode code points 原子保留全部 contents；HTML、空白、保護標記及輔助內容都計入。
- 2026-09-25 使用者最新要求取消測試翻譯累計 100,000 上限及原分類配額，改用 dev-only tracking-only 模式；總額／分類數據仍逐次保存。程式經獨立驗證後，測試 ledger 已切換 version=2、mode=tracking-only、limit=null、categoryLimits=null；保留全部舊計數與不可覆寫遷移歷史。原 5,000／55,000／20,000／10,000／10,000 保留為歷史規劃記錄。
- WI-03 原子記帳與新模式遷移未完成並驗證前不恢復付費翻譯；ledger 缺失、毀損、計數不一致或不可用時停止，不能重建為零或另開 ledger 續跑。
- 失敗與逾時保守保留額度。每則一次請求、無 SDK／品質重試、不跨引擎 fallback。
- 優先離線重播；新 NMT 的 API 結果須標記实际模型、候選、資料／術語／請求雜湊。v13 舊結果不得改標為 NMT 實測。
- 正常服務日誌不存聊天正文、譯文、Secret 或真實身分對應；評估只用合成資料。

## 使用者人工驗收步驟（尚未執行）

開始前確認 OA 名稱／channel 與新測試專案相符、測試部署及健康檢查已通過、共用 ledger 模式與部署契約一致且可原子記帳。只在新測試群組輸入合成資料；不要加入正式業務群組。

先私訊新 OA `/我的ID`，將回覆的測試 provider userId 安全寫入測試 Secret Manager 的 `LINE_OWNER_USER_ID`；不可沿用正式 channel 的 userId，也不要貼入驗證報告。owner 尚未設定前不要推定群組設定可正常運作。

初次部署前已唯讀確認 owner Secret 無任何版本，再建立 version 1 的明確占位值 NMT_OWNER_PENDING，並非真人 LINE ID；現有 exact-match 授權規則會拒絕所有群組設定，但私訊 /我的ID 仍可使用。取得真正測試 ID 後，由使用者安全新增 Secret 版本，再重新部署綁定；占位版不代表 owner 設定或人工驗收完成。證據 `test-owner-bootstrap.json`。

| 操作 | 預期 |
|---|---|
| 私訊 `/我的ID` 及帶前後空白的同指令 | 回覆自己的測試 userId。 |
| 私訊一般文字、`/翻譯設定`、模式指令與語音 | 一律無回覆；不呼叫翻譯或語音服务。 |
| 測試群組 `/我的ID`、舊 `/啟用翻譯`、`/停用翻譯`、`/翻譯狀態` | 忽略；不改設定。 |
| 群組由 owner 執行 `/中英翻譯`，所有成員查 `/翻譯設定` | 文字開啟、模式正確，語音開關維持。非 owner 不得修改。 |
| 切 `/中翻英`，輸入中文後再輸入英文；切 `/英翻中` 做相反測試 | 僅指定來源方向有翻譯。 |
| 兩段合成報價 `USD 9.50/carton` 與 `USD 2.40/bag` | 可接受每箱／每袋自然語序，金額、精度、幣別、分母與段落對應正確。 |
| 用 LINE 原生提及選兩名測試成員並輸入含數量的合成句 | 提及身分及數量／人物對應保留，手機顯示與通知由使用者確認。 |
| `OK`、`Yes`、`No`；再輸入預期同文的 `PP-BK?` | 不回覆；同譯文規則不因提及而繞過。 |
| owner 切 `/中越翻譯`，測一則中文與一則越文 | 雙向翻譯、不載入中英商務術語；仍逐次原子記錄於同一 ledger 的 manual 分類。 |
| 切文字開關並查設定；另一測試群組查設定 | 文字／語音互不連動，群組之間互不覆寫。 |

品質失敗靜默及服務錯誤以受控離線注入和後台證據驗證；不要為了人工驗收破壞服務、重設 ledger 或故意把費用額度耗盡。本輪語音辨識僅離線回歸，不新增付費語音案例。

記錄每項實際結果、測試部署 revision、UTC 時間與 ledger 前後值；未操作的項目記未完成。簽章事件、HTTP 200、LINE validate／無效 replyToken 檢查都不能代替使用端驗收。

## 回復與剩餘限制

本輪未改正式服務，因此不需要回切正式流量。原正式來源封存、Git 基準與映像可用性證據已保留；未来正式切換仍需另行授權及再次核對。

測試環境後續部署須先保存當時設定、映像與 ledger 狀態；不可將 ledger 回復成較少消耗或重新建立另一份測試累計額度。程式回復不能以正式 Token／glossary／群組資料替代缺少的測試資源。

NMT＋glossary 的商務語意仍需完整品質評估；有限機械檢查及少量合成案例不保證一般翻譯完全正確。

## 2026-09-25 外部設定歷史（以下零用量為初始化當時快照）

原指定測試專案 `line-auto-translate-bot-dev` 已確認與正式專案使用不同帳單；證據 `distinct-billing-check.json`。首次 addFirebase 曾回 403；使用者完成 Console 設定後，已成功啟用原指定專案，並以 Firebase CLI 核對 ID、number 與 ACTIVE 狀態；證據 `test-firebase-project.json`。測試 OA `@249opyjp` 已由使用者確認；證據 `test-line-bot-info.json`。

使用者曾提供另一個同名 Firebase 專案 `line-auto-translate-bot-b81bd`（1073038923984）；澄清後已明確確認 GCP 與 Firebase 都使用 `line-auto-translate-bot-dev`（371659743970），目標疑義解除。沿用 dev 的既有測試資源，不切換、刪除或在 b81bd 建立資源。Display name 不作身分或資源目標依據。

本輪跨日仍共用 `approved-20260924` 與原 100,000 上限，不重置、不新增另一份累計。實際翻譯送出仍為 0 字元；目前只建立測試資源及術語表。

2026-09-25 非付費前置已完成：修正後 provision 成功，runtime project roles／自訂最小身分角色與三個 Secret 的 secretAccessor 均已核對；共用 ledger 首次建立、limit=100000／used=0／reservations=0，初始證據為 test-ledger-initial.json；glossaries 指令沿用既有 16／28 條資源並通過完整核對，未重建。付費 API 仍等待 v3 最終 F04 複驗。

## 測試 OA 既有 Webhook（部署前唯讀基準）

新測試 OA @249opyjp 的 bot/info 再次確認一致；目前 Webhook 已啟用，指向 `https://line-audio-text-598330307384.asia-east1.run.app/webhook`，並非本次 dev／371659743970。已保存 `test-line-webhook-before-deploy.json`，未發訊息、未呼叫該服務、未修改 Webhook 或另一專案。測試 OA 人工驗收必須等本次 dev 部署完成及 Webhook 指向核對後才開始；這個既有端點只是觀察與回復參考，不代表本次有權修改該服務。

Cloud billing／IAM 的 raw REST 身分查詢必須明確帶測試 x-goog-user-project=dev，不可僅取 ADC access token 後省略 quota header；本輪已觀察省略時落至 SDK quota consumer 而回 429，明確 dev 後同一唯讀查詢回 200。這不授權提高配額、換專案或忽略 403／429；發生身分查詢失敗仍須停止，不保留額度、不送翻譯。v7 起可用 `node functions/scripts/nmt-admin.mjs transport-identity --project=line-auto-translate-bot-dev` 做非付費安全診斷，仍須先設定本文件規定的隔離 env／Node22；診斷不代表翻譯品質通過。

## v21實際部署與owner待辦

2026-09-25 使用者知悉v21三項品質finding後仍明確要求dev部署，並批准單一測試mock相容例外；完整1249應用測試、45工具及check/build通過。dev已ACTIVE於linewebhook-00001-gor，新測試OA @249opyjp已接dev且LINE空事件連線200。原品質FAILED／最後一輪限制不變，沒有新增付費回歸或應用品質修正，owner占位及人工驗收未完成；帳本22964／170未變。

九個非秘密參數已寫入忽略的functions/.env.line-auto-translate-bot-dev，來源／值見repairs-v21/dev-dotenv-parameter-fill.json；沒有修改應用或Secrets值。現Secret版本channel-secret2／token1／owner1，owner仍為NMT_OWNER_PENDING。先私訊測試OA /我的ID，安全新增dev owner Secret版本並重新部署綁定，再執行上方群組清單。

## 最新owner綁定狀態

2026-09-25 使用者完成dev LINE_OWNER_USER_ID第2版後，已重新部署綁定至linewebhook-00002-qoh（ACTIVE）；1249應用／45工具／check/build通過，128個部署檔案與前版相同，原測試OA Webhook連線200且網址未改，ledger22964／170不變，群組人工驗收待使用者確認。

LINE_OWNER_USER_ID第2版已綁定，不再使用owner占位；真實ID不記錄於此文件。私訊/myID成功已由使用者提供截圖，私訊/翻譯設定不回覆符合現行規則。現在可把新測試OA加入測試群組，由owner輸入/中英翻譯，再由成員輸入/翻譯設定；使用端結果仍待確認，不能用empty-events成功取代。
