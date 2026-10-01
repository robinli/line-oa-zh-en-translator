# DEV 事件去重與翻譯觀測

2026-09-30：A 候選 dev-operation-a1 第一輪修正後已獨立放行（freeze 397c24ee…95876f97），已隨限縮版部署 DEV linewebhook-00008-fad（ACTIVE、100%）；整體 B 及既有 NMT 語意品質未放行。本文件對應 [DEV 改善計畫](DEV翻譯品質改善開發計畫.md) WI-01～03。

## 行為與成本目的

LINE 重送同一事件時，對話記錄原本雖會去重，翻譯 API 與回覆仍可能再次執行。A 在每事件任何副作用之前取得持久處理權；同一穩定事件只容許一個執行者。不同事件即使文字相同，也不是重送。沒有可靠事件識別時明列無法去重，不假裝成功保證。

這項控制獨立於群組的對話記錄開關；關閉記錄仍要避免重複收費，但操作紀錄只留識別雜湊、狀態、版本及安全統計，不另存原文、譯文、候選、姓名、replyToken 或原始錯誤。原有記錄開關仍決定 quality 對話內容是否採集；既有 translation failureStore 保存失敗原文的契約維持，這次沒有把該故障紀錄政策改成受此開關控制。

保留 NMT 一次請求、零自動重試。觀測本身不呼叫翻譯 API，也不改送出的文字、HTML、術語表或保護規則。

## 原子性與不確定結果

既有帳本的累計值、v1／v2 政策及分類維持。新 runtime 在同一筆 Firestore 交易驗證操作所有權、帳本與政策歷史，並同時更新字元預留及 provider_started。不能先更新帳本、再另外更新事件狀態；也不能在交易 callback 中呼叫外部 API。

「已預留字元」「已開始呼叫」「provider 已返回」「譯文通過」「LINE 已接受」是不同事實。API 開始前控制寫入失敗就不呼叫；寫入結果不明，也不能視為沒寫入而重試。

| 狀態 | 解讀及處理 |
|---|---|
| 未開始 provider | 不代表可以忽略已有命令或語音副作用；A 不自行重啟整個事件 |
| provider_started 留存但無完成 | 若沒有其他已保存的回應事實，可能未送出，也可能已由 Google 處理；apiCalled／帳單保持不確定，不重呼 |
| provider 成功、品質拒絕 | Google 已返回，但結果不能送出；記錄安全細拒絕碼，不保存拒絕候選 |
| delivery_started 留存但無完成 | 可能已由 LINE 接受；不使用新 replyToken 盲目補送 |
| 發送成功後完成寫入失敗 | 不觸發第二次錯誤回覆，不把狀態倒退成未發送 |

A 初版不做 stale lease 自動接管、恢復排程或 TTL。這是用少數需要人工查核的失聯事件，換取避免重複外部副作用；不能稱作外部 exactly-once。人工處理也不能直接刪除操作紀錄或退款累計帳本來重試。

## 觀測與營運費用

操作識別跟隨該事件的 translator／client，不綁在跨事件共享的快取 router 上；中英、中越與本機返回皆須可對帳。歷史缺欄位保持 unknown，不能把 translated 筆數乘上單價當實際帳單。

字元構成採互斥分類，可加總回 frozen request 的全部 contents；原文字數和 HTML／保護後字數分開。字元預留是控制紀錄，不是 Google 帳單。階段耗時也與手機端到端延遲分開。

9/30 台北 18:38 唯讀核對 DEV 預設資料庫為 asia-east1／Native Standard，metadata 顯示 freeTier=true。官方免費額度為每日 50,000 次文件讀取、20,000 次寫入及 1 GiB 儲存；這些額度與 DEV 其他工作共用，不能只看新增控制就承諾零帳單，詳見 [Firestore 定價](https://cloud.google.com/firestore/pricing)。18:44 另以 Cloud Billing 公開 SKU 目錄核對台灣 Standard 超額單價：讀取每 100,000 次 US$0.0345，寫入每 100,000 次 US$0.1042；對應免費額度 SKU A5E9-AF91-F125／47C6-FED4-9307，非 Enterprise，也未假設 CUD 折扣。來源原始結果保存於 .local/dev-improvement-20260930/firestore-taiwan-prices.json；不是實際帳單。

持久去重增加 Firestore 讀寫與永久儲存；重送則能節省翻譯與回覆。按實作者整理的無重试路徑估算如下，最終獨立驗證仍須核對。高重送率更可能受益；低流量下這主要是可靠性與費用可稽核性的改善。刪除或保留天數另作產品決策。

## 驗證與回復

必要驗證包含真實 loopback Firestore emulator 的跨 client 並行、交易提交後回應遺失、provider 前後崩潰、LINE 接受但完成寫失敗；mock 的 reserve 次數不足以證明資料庫原子性。記錄關閉、多事件 webhook、同文不同事件、指令、純代碼、中越及原生提及降級亦須覆蓋。

A 通過只表示操作控制與觀測通過；不代表既有 NMT 語意問題解決。B 的相容回復基底應保留 A 的 operation schema 與控制。舊 DEV 00007 不讀這套去重狀態，因此不是自動相容的回復目標；部署前仍須凍結 A 基底或明確停流量／降級程序，不能用關閉控制或回退帳本作回復。

本機前置已確認 Node 22、Java 21 與 Firestore emulator JAR 可用；所有開發驗證使用 mock 翻譯／LINE，無付費翻譯呼叫。證據目錄為 .local/dev-improvement-20260930/；實際測試、獨立驗證、部署、手機驗收各自記錄，不互相代替。
## A 候選路徑成本估算

下表是新控制層本身的文件讀寫；不含既有 quality、failure、settings、LINE 成員查核、匯出查詢、Firestore transaction retries、索引儲存與網路費。成功 NMT 的總數包含原本就有的 ledger 2R／1W，因此淨增加是 7R／7W。provider unknown 列是假設仍能保存狀態並成功回覆 🚧 的路徑；程序直接崩潰則依實際已完成步驟計。

| 路徑 | 控制層文件讀取 R | 控制層文件寫入 W | 說明 |
|---|---:|---:|---|
| 新事件 NMT 成功並回覆 | 9 | 8 | 相對原 ledger 淨 +7R／+7W |
| 同一事件重送 | 1 | 0 | 不再翻譯或回覆 |
| 本機結果／指令有回覆 | 5 | 5 | 翻譯 API 0 次 |
| 略過、沒有回覆 | 3 | 3 | 翻譯 API 0 次 |
| provider unknown，完成紀錄並回覆 🚧 | 9 | 8 | 預留字元不退款，不重呼 |
| provider_started 後崩潰 | 4 | 3 | 已完成 claim＋reservation；不得以 lease 過期重呼 |

以已核對的台灣 Standard 清單價，不扣每日免費額度，每個成功新 NMT 事件淨增加約 US$0.000009709 的控制讀寫：

| 每月新 NMT 事件 | 新增控制讀寫估算 |
|---|---:|
| 1,000 | US$0.0097 |
| 10,000 | US$0.0971 |
| 100,000 | US$0.9709 |

以歷史中英平均 222.41 個實送字元、NMT US$20／百萬輸入字元作純清單價比較，一次避免的重複 NMT 約 US$0.00445；約 22 次可抵一萬個新 NMT 事件上述控制讀寫。這只是相同訊息組成下的比較，未計免費額度、其他原本可避免的讀寫／執行費、儲存與重試，也不是實際月帳單或保證節省率。

2026-09-30 A 實作者已通過完整 webhook emulator 及 40 案 wire 比對；完整離線 1,633 應用＋74 工具、型別與建置通過；verifier 結果仍待追加，不能據此標示 A 已獨立放行。證據：.local/dev-improvement-20260930/operation-emulator-2026-09-30T10-51-37-517Z/result.json 與 a-wire-comparison.json。
首次凍結索引：.local/dev-improvement-20260930/a-freeze-round0.json（aggregate SHA-256 bf634ff63f250d1c3d148f57d144f69f10181a79566716f7027ba1da267deb2d，15 檔）；完整檢查 .local/checks/20260930-185847-458-full-8f029a32.log，最終 emulator operation-emulator-2026-09-30T10-59-49-578Z/result.json。A source snapshot 已保存於同證據目錄的 a-source-snapshot/，未含憑證、dotenv 或部署封裝；相容回復仍需通過獨立驗證與發佈預檢。

## 首輪獨立驗證（修正中）

Verifier 重現兩項 Medium，A 暫不放行，原實作者進入第一次修正／複驗週期：

- A-OBS-01：provider 確已成功返回，但完成狀態持久寫失敗時，catch 將已知結果覆成 provider_unknown／apiCalled unknown；須分開保存外部已知成功與資料庫寫入失敗，不能新增 provider 重試；同家族另含 provider 回傳 null translation 時，輸出計數不能把已知回應誤記未知，而應交品質格式檢查拒絕。
- A-OBS-02：語音取得逐字稿後未更新 sourceCharacters，中英／中越逐字稿「你好」被記 0，同文文字訊息為 2；須在逐字稿可得後更新碼點數。

跨 client emulator 及 23 項控制定向已獨立通過，不能抵銷上述未解觀測缺陷。證據 .local/dev-improvement-20260930/verifier-probes.cjs／verifier-probes.json；原 a-source-snapshot/ 保留為初始凍結證據，尚不是已放行回復版。
首輪 verifier 報告：.local/dev-improvement-20260930/a-verification-round1.md（FAILED）；親跑 emulator 證據為 operation-emulator-2026-09-30T11-06-16-119Z/result.json。

第一次修正後重新凍結為 SHA-256 397c24ee85fe18383f839e9c18cb91a1c8a81490ec20efd2d91b260a95876f97（a-freeze.json）：146 項定向測試／6 檔、型別、建置、7 項品質匯出工具檢查通過，同一 verifier 複驗中，尚未放行。證據 .local/checks/20260930-192143-565-targeted-e8499221.log 與 a-observation-recheck-round1.json。

修正後，provider 已返回但 provider phase 寫入失敗，仍保留 apiCalled=true 與已知輸出字數；持久 phase 可能暫留 provider_started，另以 provider_completion 失敗階段與後續已知事實區分，不反覆呼叫 provider 或以寫入失敗抹成未知。沒有確定回應的逾時仍維持 unknown。語音逐字稿取得後按 Unicode 碼點記原文字數，尚未取得逐字稿則為 0 個已知文字碼點。
## A 功能放行

同一 verifier 第一次修正複驗 PASS，A-OBS-01／02 閉合，限定 freeze 397c24ee85fe18383f839e9c18cb91a1c8a81490ec20efd2d91b260a95876f97。親跑 30 項 operation 測試、7 項匯出測試、21 個定向原反例／相鄰控制及 4 個真 loopback emulator 提交故障案例；複驗前後 15 檔 hash 一致，其餘完整離線、wire 與 emulator 沿用已核對證據。報告 .local/dev-improvement-20260930/a-verification-recheck-round1.md；新證據 verifier-probes-round1.json、verifier-provider-emulator-round1/result.json，原失敗證據未覆寫。

已保存 a-verified-source-snapshot/，由初始 A 快照加已放行的 15 檔修正組裝，不含 B 未接入模組、憑證或 dotenv。這是 B 的相容程式回復基底，仍不是已部署封裝；發布預檢與手機驗收分開。未知事件不自動恢復、無可靠 key 無法去重及永久保留等取捨持續有效。
2026-09-30 部署後以一個合成略過事件及重送驗證雲端 durable claim／completion／duplicate，僅一筆 metadata 操作且重送不改內容；provider／LINE delivery 未啟動，帳本前後相同，詳 [部署紀錄](DEV改善限縮版部署20260930.md)，手機驗收仍待確認。
