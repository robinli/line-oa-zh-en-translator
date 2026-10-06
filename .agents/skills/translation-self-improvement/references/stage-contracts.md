# 階段與交接契約

## 一份工作、一份證據索引

所有真實資料、階段報告、raw 回應與執行日誌都保存在 `.local/translation-improvement/{runId}/`。全檔案用 UTF-8／CRLF；PowerShell 5.1 的含中文腳本另用 UTF-8 BOM。引用既有資料路徑與 hash 即可，不複製全部歷史或把真人資料放入 Skill／可提交文件。

主 Agent 維護以下三個控制檔：

- `00-scope.md`：PRD／DEV 專案、群組範圍、起迄與固定截止時間（Asia/Taipei）、資料來源、有效動作／資料授權、既有暫停、未解問題及環境缺口。核對主／子模型與推理的期望值、已知實際值或未知狀態。
- `run-state.json`：當前階段、各步結果、下個動作、角色 ID、版本及人工關卡。這是本機交接資料，並非執行器或平台 goal。
- `evidence-index.json`：runId、各階段文件及來源路徑、需要交付的 hash、根因 ID／修正輪次、現行候選類型、未解 findings、真實 NMT roundId／manifest 路徑與累計、有效授權及待決事項。只在證據變動時更新，不能覆寫失敗或 raw。

`run-state.json` 至少保存：

```json
{
  "runId": "translation-improvement-YYYYMMDD-unique",
  "currentStep": 1,
  "workflowStatus": "IN_PROGRESS",
  "stepResults": {},
  "nextAction": "分析指定期間已保存的 PRD 記錄",
  "roles": {},
  "candidate": null,
  "humanReview": {
    "status": "NOT_REQUESTED",
    "devRevision": null,
    "packageHash": null,
    "testedByUserAt": null,
    "approvedScope": null,
    "continueToPrdRequested": false
  }
}
```

流程狀態可用 `IN_PROGRESS`、`NO_CODE_CHANGE`、`WAITING_HUMAN`、`VERIFICATION_INCOMPLETE`、`NEEDS_INPUT`、`STOPPED_BY_RULE`、`COMPLETED`。主 Agent 只能按已發生的事更新；第 5 步完成仍是 `WAITING_HUMAN`，第 7 步發布及核對完成才是 `COMPLETED`。單純分析／無可修正項目的工作以 `NO_CODE_CHANGE` 交付，後續步驟標 `NOT_APPLICABLE`；缺權限／服務則記 `NEEDS_INPUT` 或 `VERIFICATION_INCOMPLETE`，不能當成沒問題。

## 每步文件的共同交接欄位

每份文件保留以下緊湊欄位，具體細節只列本階段所需：

```text
runId／步驟／結論及驗收範圍：
作者角色／模型與推理／實際命令執行者：
前一份文件、輸入證據路徑與需要核對的 hash：
候選類型、應用來源／建置、凍結包及版本：
本階段輸出與可支持結論的證據：
未解問題、授權／資料／服務缺口、根因輪次及停止條件：
交給哪個角色、下一步、放行條件及使用者待辦：
```

主 Agent 核對文件對應當前範圍與候選，條件通過再派下一步。下一個角色先讀前一份文件及必要來源，缺關鍵證據時回報缺項，不以口頭「已完成」放行。read-only 子角色回傳文件內容，由主 Agent 落盤；此時標註文件作者與保存者，不冒稱主 Agent 完成了獨立工作。

## 1. 分析：01-analysis.md

主 Agent 唯讀取得使用者指定 PRD 群組及期間的記錄／人工案例，保存查詢、分頁、截止時間及原資料 hash；優先沿用已核對的匯出。現有 `functions/scripts/export-translation-quality.mjs` 尚有限 DEV 的契約，先查目前支援範圍；不能直接改參數假裝可匯出 PRD，也不能為這次讀取擅自解除 DEV 工具隔離。必要時使用專案固定、範圍明確的唯讀 PRD 查詢。

planner 依資料對比原文 → 實際 NMT contents → raw NMT → 還原譯文 → 最後回覆，交付：

- 資料涵蓋期間、群組、記錄／真正翻譯筆數與缺欄位。標明採集起點、關閉區間及無法得知的缺失；核對可得 Logging 接收與寫入診斷，不能以已存筆數證明所有交談完整。
- 案例表：穩定案例 ID、時間／群組、必要原文與最後輸出、偏差、根因分類／信心、影響、上下文缺口及證據路徑。成功譯文、🚧 誤拒、漏放與正常略過分開判斷。
- 按共通根因列 `PROGRAM_FIXABLE` 候選；提出代表性原失敗、忠實正例、錯誤負例及相鄰邊界。商務用語替代建議不能直接當作唯一正解或程式修正需求。
- `NMT_LIMITATION` 及 `NEEDS_CONTEXT` 分別保留，不能用猜測責任、交易條件、單位或全文理解硬修。

若沒有可安全處理的程式項目，主 Agent 用本文件交付 `NO_CODE_CHANGE`；不要繼續開發／部署以湊齊流程。

## 2. 計畫：02-plan.md

沿用同一 planner，只補需要實作的計畫與必要環境準備：

- 根因／工作項目 ID、現況與預期、範圍、owned files、共通方案、相容性及退步風險；禁止逐句硬編碼。標明仍是研究、修正或交付候選。
- 最小可行性檢查、可觀察的接受／拒絕結果、必要離線及獨立驗證集合；先證明代表性正反例可行，再擴大實作。
- 所需既有 GCP 服務／API、DEV／PRD 身分與專案、用途、可用性及必要準備；主 Agent 完成預檢，缺項先調整計畫。開發／驗證期間不新增服務或啟用 API。
- 當輪真實 DEV NMT 的資料授權、原失敗及相鄰正反例、共用 manifest、實送 contents 的 Unicode 碼點預留與上限，以及回覆捕捉替身。一般開發不反覆估費／盤點額度。
- 系統性失敗與同根因兩輪上限、可否部署 DEV、未解項目及人工複測範圍。

主 Agent 核對可修正性、授權及依賴後派 implementer；缺實質設計解答就維持研究，不進入交付。

## 3. 開發：03-development.md

implementer 是唯一應用寫入者，按 owned files 開發，保存其他任務異動。交付根因與方案、實際 diff 範圍、必要定向／離線檢查與型別／建置、原失敗與正常對照結果、候選路徑／hash、修正輪次及未解項目。

先定向驗證，穩定交付前完成 `scripts/check-local.ps1` 的必要完整檢查；測試入口依 `docs/本機離線檢查.md`，不是任意縮小測試範圍。實作者不能宣稱獨立驗證 PASS。

主 Agent 接收候選、凍結 verifier 檢查範圍後派第 4 步；驗證期間不改該範圍。

## 4. 驗證：04-verification.md

verifier 從需求、候選、實際 diff、原失敗及 evidence provenance 獨立判斷：

- 親執或指定主 Agent 代跑必要檢查，記錄角色及真正執行者；不足的離線／服務／資料證據列缺口。
- 每輪影響核心的驗證／修正複驗都使用當前凍結應用路徑完成保護 → 既有 DEV NMT → 還原／完整性檢查 → LINE 回覆內容生成。正負例均觀察真實 NMT；LINE 用替身捕捉，禁止為此向真人發送。
- 各角色及對照請求共用一輪 ID／manifest，送前預留實際 contents 的碼點；每輪合計最多 10,000，含 HTML、標點、空白及換行。可能已發出的失敗／逾時仍保留預留量，無法取得結果時保留 unknown，不自動重試。
- 保存凍結來源／build、request profile、請求及字元、raw 回應、還原／檢查／回覆結果、正反例是否符合預期。歷史回應不得改標為本輪新結果。
- 結論用 `VERIFICATION_PASSED`、`VERIFICATION_FAILED` 或 `VERIFICATION_INCOMPLETE`，明確限定候選與驗收範圍；有未解 Blocking／High／Medium 或缺必要實测不得 PASS。既有範圍外品質問題保留，不冒稱整體語意放行。

失敗交同一 implementer 定向修正、同一 verifier 複驗；rootCauseId 及輪次延續。首次系統性問題先查共通設計；兩輪未收斂停止，不能另命名或換 xhigh 再修。

## 5. DEV 部署：05-dev-deployment.md

主 Agent 按當前 `docs/DEV部署封裝工具.md` 選取有效的指定 DEV dotenv／auth／evidence，以 `prepare:dev` 在 `.local/dev-deploy/` 新建包、完整 verify 並凍結。不抄歷史 env 路徑作為永遠有效來源，不更新或清空 Wei 別名。

同一 verifier 核對包與第 4 步凍結候選的 byte／hash 一致及必要證據。若核心應用變更使實測候選失效，先回第 4 步完成當輪實測，不用舊 PASS 直接發布。主 Agent 沿用有效 DEV 部署授權執行包內 `deploy.ps1 -Execute`；保留 launcher、完整 predeploy 及部署前必要快照。

發布後主 Agent 核對 Function ACTIVE、Cloud Run revision／流量、固定引擎／profile、指定設定／Secret 綁定、部署來源與包一致及必要合成檢查；verifier 獨立評閱版本與證據。CLI 清理收尾非零時先查實際雲端狀態，不能盲目重複部署。

本文件交付版本、包路徑及 hash、發布／核對結果、未解限制與人工測試入口。只有真部署及必要核對通過才 PASS；包準備成功不算部署成功。

第 5 步完成即建立下一份人工文件，主 Agent 記 `WAITING_HUMAN`、通知使用者並結束本輪；不進入 PRD。

## 6. 人工複測：06-human-review.md

第 5 步產生時文件狀態是 `PENDING`，包含 DEV OA／版本與時間、包 hash、修正與未解範圍，以及以下表格：

| 案例 ID | 操作／必要測試原文 | 預期結果與允許的忠實變體 | 使用者實際結果 | 通過／失敗 |
|---|---|---|---|---|

覆蓋原失敗、正常案例及本次相關排版／提及／🚧／👆 行為，避免把 exact wording 當作自然語言唯一答案。標明測試僅限 DEV；使用者自行人工發送，主 Agent 不以自動真人訊息代替。

主 Agent 從使用者回覆記錄測試時間、實際 DEV revision、案例結果、通過範圍、剩餘問題及是否要求承接 PRD。未收到結果不能填 PASS。使用者對當前版本確認通過並要求繼續，承接既定第 7 步，不重複問相同授權。

FAIL 回第 2／3 步並按根因輪次重驗；DEV 重部署後文件更新為該版本 PENDING，再通知使用者測試。

## 7. PRD 發布：07-prd-deployment.md

僅在第 6 步對當前適用候選 PASS、使用者要求繼續及發布門檻仍成立時執行。主 Agent 準備新的 PRD 隔離包、正式身分／設定適配、相容備份及回復方案；不用 DEV OA、Secret、身分對應或資料覆蓋 PRD。

同一 verifier 核對適配 diff、凍結來源、DEV／人工證據適用性、必要完整離線與正式 `production-deploy-check`。新增核心修改回第 3／4 步並完成當輪真實 DEV NMT；有實質新 DEV 候選須再取得對應人工結果。

主 Agent 發布並核對正式 revision、ACTIVE／流量、來源與包、既有設定及按變更所需合成檢查。報告 PRD 上線版本、驗證範圍、保留問題、回復相容性及後續觀察；不得清空 lineEventOperations 或帳本來重試，也不為驗證向真人 LINE 發送。

發布與必要核對完成後更新 `COMPLETED`，通知使用者；正式發布成功仍不等於所有翻譯語意或手機顯示已驗收。
