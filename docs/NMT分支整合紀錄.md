# NMT dev 合併至 codex-local

2026-09-25 依使用者要求，先將隔離工作區既有未提交內容保存為來源提交 `85a3e38`，再合併至 `codex-local`（合併前 `18c10d8`）。

## 合併內容與保留項目

- 納入 NMT＋術語表、品質檢查、共用 tracking-only 帳本、dev 身分及部署防護、測試與維運文件。
- 保留 codex-local 的較新 LLM 候選與回歸資料；AGENTS、Codex 開發流程、總覽及日誌衝突以較新的流程與正式回復紀錄為準。
- 對 codex-local 新增的三個 evaluate 及一個 smoke 付費入口補上既有隔離防護；工具測試檢查的入口由 35 個擴為 39 個，不變更翻譯請求或品質判準。
- 正式仍為 9/21 NMT 回復版；dev 雲端仍為原部署，本次不部署、不呼叫付費翻譯、不發 LINE 訊息。v21 未解品質 findings 及暫停限制保留。
- 👆／🚧 與失敗資料庫記錄仍為後續待實作需求，不列為本次合併成果。

## 工作目錄與私密設定

- 後續一般開發可在主目錄 codex-local 進行；原 dev worktree 與來源分支保留。
- 未提交或搬移任何 `.env*`、CLI／ADC 憑證、Secret、帳本或原始私密證據。原 dev 設定與證據仍在 `.local/nmt-worktree`。
- 離線工具測試另需 Git 忽略的 `.local/evidence/nmt-glossary-resources-v12.json`；本次僅從原 dev 複製這份非機密資源中繼資料到主目錄，逐 byte 相同（SHA-256 `e0e725e219915a4611b037c046943c9362a6b375d2256a0ce306c249d6fccbc1`），未複製登入憑證或真人資料。其他 checkout 執行完整工具測試前也須備妥該紀錄；不可用此本機複製宣稱完成雲端資源核對。
- dev 部署工具會依 checkout 根目錄核對隔離設定與證據；主目錄保留舊正式 dotenv，且沒有搬入 dev 憑證，因此不能直接把主目錄視為已備妥的 dev 部署環境。既有拒絕混用正式 dotenv 與憑證的防護保持生效。
- 如後續需部署，先依維運文件準備及核對所選 checkout 的隔離環境；不可移除守門或使用正式憑證繞過。

## 驗證

- Node.js 22.23.2：型別檢查、1,435 項應用測試（46 檔）與建置通過；補齊資源紀錄後，45 項 NMT 工具測試全部通過。
- 首輪工具測試 33 通過／12 失敗，原因是主目錄缺少術語表資源紀錄；首輪輸出保留，不改測試斷言或品質判準。
- 一位 verifier 獨立合併驗證通過，另重現 39 項整合、3 項防護測試及直接部署拒絕檢查；沒有本次合併範圍內未解 findings。
- 本機證據位於 `.local/merge-nmt-20260925/`，含 `premerge.json`、`verify.log`、`tools-recheck.log`、`local-prerequisite.json` 與 `verification.md`。
- 自動測試通過僅代表此次合併檢查通過，不改變歷史 v21 品質驗證 FAILED，也不代表已部署或 LINE 使用端驗收。
