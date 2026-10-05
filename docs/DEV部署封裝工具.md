# DEV 部署封裝工具

> 2026-10-01：依使用者要求，封裝忽略 Wei 別名更新，原樣保留指定 DEV dotenv 的現有設定；封裝與 `nmt-admin` 部署前檢查不再硬性要求空別名，不主動查詢、更新或清空人物對應，DEV 引擎／runtime、隔離與凍結檢查維持。歷史空別名包保留原狀，不能用它取代目前設定，詳 [DEV Wei 設定更新](LINE原生提及.md#2026-10-01-dev-wei-設定更新)。

2026-09-26：`npm run prepare:dev` 統一建立隔離 DEV 部署包，取代從歷次 `.local/quality-*/prepare.ps1` 複製後臨時補檔的做法。本工具只準備及驗證本機檔案；執行成功不代表已部署、雲端身分已核對或手機驗收完成。

## 準備與使用

在專案根目錄、Node.js 22 的 npm 環境中執行。先完成既有依賴安裝；工具不下載 Node、套件或登入雲端。

合併後本機的 DEV 私密設定仍位於 `.local/nmt-worktree/`，目前命令如下；更換機器或 checkout 時須明確指定當地的 DEV 設定路徑，不能使用正式參數替代。

```powershell
npm.cmd run prepare:dev -- --out=.local/dev-deploy/my-change --env-file=.local/nmt-worktree/functions/.env.line-auto-translate-bot-dev --auth-dir=.local/nmt-worktree/.local/nmt-auth --evidence-dir=.local/nmt-worktree/.local/evidence --check-only

npm.cmd run prepare:dev -- --out=.local/dev-deploy/my-change --env-file=.local/nmt-worktree/functions/.env.line-auto-translate-bot-dev --auth-dir=.local/nmt-worktree/.local/nmt-auth --evidence-dir=.local/nmt-worktree/.local/evidence
```

`my-change` 改成此次候選名稱。`--check-only` 一次列出缺少的檔案，不建立資料夾、不執行測試；第二個命令會建立新包並在包內跑完整 `verify`，包含型別檢查、應用測試、建置、既有 NMT／匯出及部署工具測試。不是 Firebase predeploy，不查詢或修改雲端。

未指定來源選項時，使用 `functions/.env.line-auto-translate-bot-dev`、`.local/nmt-auth`、`.local/evidence`；不自動搜尋歷史工作目錄。直接用 `node` 啟動時另傳 `--npm-cli=完整的npm-cli.js路徑`，通常經 npm script 執行即可自動取得。

若系統 npm 綁定其他 Node 版本，可使用已安裝的 Node 22 完整路徑搭配 npm CLI；不要為了通過檢查改掉版本限制：

```powershell
# 兩個值需指向本機已安裝的檔案，範例為變數名稱，不是固定安裝路徑。
& $devNode22 $devNpmCli run prepare:dev -- --out=.local/dev-deploy/my-change --env-file=.local/nmt-worktree/functions/.env.line-auto-translate-bot-dev --auth-dir=.local/nmt-worktree/.local/nmt-auth --evidence-dir=.local/nmt-worktree/.local/evidence
```

## 封裝內容與凍結

- 複製根目錄 `package.json`、`firebase.json`、`.firebaserc` 及 `scripts/check-local.ps1`，保留既有 DEV 身分及完整驗證 predeploy。
- 複製 `functions/src`、`scripts`、`evaluation`、`glossaries`、`config`、package／lock／TypeScript／Vitest 設定，另外只複製明確指定的 DEV dotenv；本機入口與 `vitest.config.mts` 是必要且納入雜湊的檔案，包內 verify 同樣執行本機檢查工具測試，詳見 [本機離線檢查](本機離線檢查.md)。
- 指定的 DEV dotenv 逐 byte 複製並納入 SHA-256；現有別名（含 Wei）不更新、不清空，也不因非空而阻擋。原生提及模組仍負責既有別名解析，真實 userId 不加入可提交檔案。
- 在新包建置 `lib`；不沿用來源的舊 `lib`，也不複製正式或未限定專案的 dotenv。
- 當前術語表資源紀錄複製到包內獨立 `.local/evidence`；測試不共用歷史 evidence 輸出，本次測試產生的包內 evidence 檔案亦納入最後的雜湊清單。`node_modules` 與隔離登入資料以本機 junction 連結，包不能視為可任意移機的獨立安裝品。
- `dev-package.json` 保存狀態與檔案 SHA-256。驗證期間來源新增、刪除或內容變更即失敗；驗證後的來源、編譯檔、參數、啟動腳本與連結變更也會阻擋此包部署。依賴目錄的內容仍由 lockfile、既有安裝及測試保證，沒有逐檔鎖住 node_modules。
- 輸出限定 `.local/dev-deploy/` 的新子目錄，拒絕舊目錄及穿越 junction。失敗候選保留 `status: failed` 與日誌，不自動清除或續寫；修正來源後換新候選名稱重建。

先完成程式及 CRLF 整理，再封裝、凍結與驗證。後續修改候選時重建新包，不能直接補檔後沿用先前通過結論。檔案清單與雜湊是防止操作失誤的證據，不是防竄改簽章；僅狀態檔、根目錄 verify.log／deploy.log 與兩個宣告連結不作一般檔案列舉，其他新增檔案（包含 .npmrc）或來源目錄 junction 都會阻擋。

## 授權後部署

先沿用專案要求備份當時 DEV 版本、參數與帳本，完成獨立驗證。取得該次 DEV 部署授權後，才執行包內啟動腳本：

```powershell
powershell.exe -NoProfile -File .local/dev-deploy/my-change/deploy.ps1 -Execute
```

不加 `-Execute` 只顯示說明。腳本先核對包內雜湊，固定使用建立候選時的 Node 22，設定隔離 gcloud／ADC／Firebase 路徑，再呼叫原有 `nmt-admin.mjs deploy --project=line-auto-translate-bot-dev --execute`；所有即時身分、專案、帳單、帳本、術語表及 Firebase predeploy 保護照常執行。Windows 的 npm shim 同樣固定 Node 22。

Firebase stdout／stderr 會進入包內 `deploy.log`，失敗保留原非零退出碼；超大輸出仍受既有同步命令 buffer 上限限制，這次未改成串流。若日誌同時出現 Function 更新成功與清理政策錯誤，須唯讀核對實際 revision、ACTIVE、流量及部署後檢查，不能只看退出碼重複部署或直接宣稱成功；工具不自動重試、不修改清理政策。

部署後依本次變更執行必要的版本比對、DEV 合成檢查及人工驗收。準備工具不執行付費翻譯、真實資料匯出、Secret／IAM 修改或正式部署。

## 本次驗證

Node 22 的實際隔離包已通過型別檢查、建置、1,539 項應用、45 項既有工具、5 項匯出與 12 項部署工具測試；一位 verifier 獨立複驗通過，含未宣告檔案／junction 阻擋、真管理入口與 Windows 啟動器在完全模擬依賴下的退出碼 23／0，沒有呼叫雲端。

最終候選為 `.local/dev-deploy/tool-validation-20260926-correction-1-final/`，354 個檔案已凍結；完整結果、歷次失敗及獨立報告保留在 `.local/dev-deploy-tool-20260926/`。本次沒有執行部署、付費翻譯或真人訊息。

## 2026-10-01 新主路徑的本機 profile 候選

[新主路徑開發紀錄](NMT主路徑重設本機開發紀錄20261001.md) 所述封裝／管理入口已本機接入可信 request profile，尚未建立或部署此版本的實際 DEV 包。既有包與當前 runtime 繼續使用其凍結契約。

| TRANSLATION_ENGINE | NMT_REQUEST_PROFILE | 詞表證據 |
|---|---|---|
| nmt-glossary | 缺省或 legacy-glossary | 舊 HTML／指定詞表 |
| nmt-direct | nmt-direct-v1 | 無詞表，免讀詞表資源 |
| nmt-direct | nmt-direct-glossary-v1 | 指定現有中英詞表 |

[共用配置驗證](../functions/scripts/dev-request-profile.mjs) 拒絕重複受控鍵與不匹配引擎／profile；固定 DEV project、runtime、NMT 模型及 identity 控制保留。新 direct 包要求六個新編譯模組（包含 nmt-exact-directives.js），無詞表也要執行包內完整 verify、必要 predeploy 及 ledger／operations 歷史保護。別名仍逐 byte 保留，不主動重新核對人物。

本次新增 profile、管理 hook、必要 compiled entry 與封裝離線 fixture 測試；工具 18 項通過。這些模擬證據不等於實際隔離包或雲端入口已通過，NMT 效果對照及有效部署授權仍是後續門檻。

2026-10-02 使用者固定使用 NMT，Gemini 新候選撤回。plain profile 線上不查術語表，但完整離線驗證包含 archived glossary-contract 工具，因此所有 profile 封裝均須明確攜帶既有 glossary resource metadata 並凍結。缺少 metadata 於 preflight 即阻擋；這不啟用 plain runtime glossary。首包 FAILED 保留，修正後工具19項及隔離包完整 verify通過，423檔凍結；尚未部署，見 [固定 NMT 交付](NMT固定主路徑交付20261002.md)。

最後獨立複驗已發現 copy-exact 同根因仍未收斂，達兩輪上限後停止修補；此主路徑候選不可交付或部署，以上只記錄本機實作範圍，未改現行 DEV。

2026-10-02 明確宣告限縮版已完成有限 M1 本機交付，原自動推斷停止與兩輪紀錄保留；新的 directive 模組是必要包內 entry，完整離線最新 2,056 項應用／18 項部署工具通過，獨立引號 finding 未放行，不能直接部署。

2026-10-02固定原文NMT套件nmt-only-20261002-final2已按新增明確部署授權經包內launcher及完整Firebase predeploy發布DEV：linewebhook-00010-xew，ACTIVE／100%；部署後423檔凍結、208個雲端來源檔及健康檢查通過。上文未部署與不可交付段落保留為各歷史候選結果，不適用已限縮並獨立驗證的此包；整體NMT品質仍未通過、手機驗收待完成。詳[交付及部署](NMT固定主路徑交付20261002.md)。

2026-10-02 name-protection-20261002-final1已按再次明確部署授權完成發布：linewebhook-00011-wup／ACTIVE／100%，424檔凍結，完整包內及Firebase predeploy通過62檔／2,134應用與83工具；独立包驗證與208個雲端來源檔核對通過。此次實際--env-file採前一已部署凍結包nmt-only-20261002-final2/functions/.env.line-auto-translate-bot-dev，逐byte保留現行參數與別名；沒有修改文件範例的nmt-worktree來源。原真人驗收、double-check政策與整體語意品質仍待完成，詳[最新交付](NMT固定主路徑交付20261002.md)。

2026-10-03 nmt-content-20261003-final1 已依一般訊息「同意部署 DEV」發布 linewebhook-00012-fiz／ACTIVE／100%，429 檔凍結、63 檔／2,157 應用及 85 工具完整 verify／predeploy 通過，212 個雲端應用／建置／package 檔與封裝一致；本輪 5 筆真實 NMT 共 230 碼點，最後一筆實際 Firebase 新欄位及重送去重／合成清理通過。dotenv 逐 byte 沿用 name-protection-20261002-final1，現有別名與 Vertex 停用維持，未向真人發送測試訊息；詳 [NMT 內容記錄](DEV翻譯品質紀錄與錯誤案例回報.md#2026-10-03-nmt-傳輸內容記錄)。

2026-10-05 html-name-copy-20261005-final1 已依「部署到 DEV」授權，經標準 launcher 與完整 Firebase predeploy 發布 linewebhook-00013-gug／ACTIVE／100%，430 檔凍結、64 檔／2,178 應用與 85 工具檢查通過；獨立 verifier 確認 276 個實測應用檔逐 byte 相同，沿用 4 筆真實 NMT，dotenv bytes 沿用 nmt-content-20261003-final1，現有別名不變。212 個雲端來源及零翻譯健康檢查通過，Vertex AI 仍 DISABLED；HNC-I01／既有語意 findings 及手機驗收保持未結案。證據 .local/html-name-copy-deploy-20261005/，詳 [修復與部署](NMT固定主路徑交付20261002.md#html-冗餘人名保護副本修復2026-10-05)。
