# DEV 部署封裝工具

> 2026-10-01：DEV 已加入 Wei bro／Wei brother 的私密 userId 對應，現行工具仍硬性要求空別名，因此新的 DEV dotenv 會被前檢查阻擋；下次完整部署須先修正並驗證別名設定契約，不可清空已確認對應或直接重用空別名的舊凍結包，詳 [DEV Wei 設定更新](LINE原生提及.md#2026-10-01-dev-wei-設定更新)。

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
