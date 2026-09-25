# LINE OA dev 回應與失敗記錄

2026-09-25：依使用者確認方案在 codex-local 開發；只部署至 line-auto-translate-bot-dev／測試 OA @249opyjp，正式 OA 維持 9/21 回復版本。

> 2026-09-25 正常略過補強：群組文字 OK／Yes／No、方向不符、純數字／符號／Emoji、僅提及，以及文字或語音功能停用，改回覆 👆 並計 processed，不呼叫相關翻譯／語音服務、不保存失敗記錄。私訊、退役指令、群組 /我的ID 與不支援事件維持原入口規則；語音已產生的逐字稿仍照常回覆。已部署至 dev OA @249opyjp／linewebhook-00004-teb（ACTIVE、100% 流量）；1,471 應用／45 工具測試與獨立驗證通過，五類部署後合成檢查通過；手機端顯示待人工驗收。

## 行為

- 群組文字譯文依既有 NFKC、空白、指定標點規則比對相同：只回覆 👆，不附提及、不保存；計 processed。
- 已啟用的群組文字／語音因翻譯 API、品質檢查、程式初始化、輸出格式或長度／時長／大小限制失敗：只回覆 🚧，計 failed，保存可取得原文／逐字稿；正常略過回覆 👆 且不保存；管理指令與設定讀取失敗不保存。
- 語音無逐字稿時只記事件資訊，sourceText=null；成功時仍為逐字稿及選擇性的譯文，相同語音譯文不套用 👆。
- 資料庫與回覆平行啟動，各自捕捉失敗並等待完成；不因記錄失敗取消回覆，也不因 LINE 失敗取消保存。不新增持久補寫佇列。
- LINE 發送錯誤不再次補送符號、不誤存成翻譯失敗；同批其他事件持續處理，HTTP 回應維持 processed／ignored／failed。

## 資料庫

服務為 **Google Cloud Firestore**，專案 `line-auto-translate-bot-dev`，資料庫 `(default)`；與 dev 聊天室設定共用，與正式專案分開。

| 集合／文件 | 保存內容 | 用途 |
|---|---|---|
| `lineTranslationGroups/{groupId}` | 文字／語音開關、翻譯模式、changedBy（設定修改者 LINE userId）、changedAt | 各群組設定，merge 更新；非完整修改歷程 |
| `lineTranslationFailures/{id}` | 原文／可取得逐字稿、群組與訊息資訊、方向、失敗階段／原因及時間 | 翻譯錯誤與限制阻擋排查，欄位詳列如下 |
| `nmtEvaluationBudget/approved-20260924` | projectId、used、reservations、分類用量、version、mode、limit、categoryLimits、migrationId | 呼叫前原子記帳；目前 tracking-only，總額及分類上限為 null |
| 上述帳本的 `policyHistory/tracking-only-20260925` | 政策版本、專案、變更 ID／時間、before／after 帳本快照 | 保存取消上限時的變更證據 |

用量帳本保存累計計數，不保存聊天內容；reservations 是呼叫前記帳次數，不等於成功翻譯次數。正常略過不呼叫翻譯 API，因此不增加翻譯用量；相同譯文先呼叫翻譯，仍可能增加用量。

- 使用 dev Firestore 的 lineTranslationFailures；無 TTL，保留至手動清除。
- 欄位：schemaVersion=1、groupId、messageType、sourceText、translationMode、stage、reason、recordedAt；可取得時另存 webhookEventId、messageId、sourceLanguageCode、targetLanguageCode。
- 原文或逐字稿完整保存，不保存音訊、被拒譯文、發送者 userId、replyToken、Secret、SDK 原始錯誤或任何附加物件。
- 使用事件 ID 的 SHA-256 作文件鍵；無事件 ID 則 hash 群組＋message ID，皆缺少則隨機 UUID。Firestore create 前置條件保留首筆；並行或重送不覆寫首筆時間／內容。不宣稱這是整個 webhook 的發送去重。
- reason 僅保存程式定義的代碼；品質原因採白名單，其餘歸類 quality_rejected，SDK 錯誤不保留原始 message/cause。一般日誌無本文或逐字稿。
- 查閱使用既有 dev 管理權限；本次不建立對外查詢 API，也不新增公開存取規則。

## 第一階段歷史：相同譯文與失敗記錄（00003-huh）

- 定向測試涵蓋四模式、正規化、原生提及、語音各階段、正常略過、停用、超限、LINE／資料庫失敗、批次續行與敏感內容診斷。
- Firestore emulator 驗證完整 Unicode 原文、十個並行重送、首筆時間不變、重新連線讀取及缺少逐字稿／選填欄位；入口 npm --prefix functions run test:failure-store。
- Node 22.23.2 完整型別檢查、1,464 項應用測試（48 檔）、45 項工具測試、建置及 Firestore emulator 通過；一位 verifier 另做 44 項測試與 11 個邊界控制，獨立驗證通過且無未解 findings。
- 首輪一項舊回覆次數斷言因新增 🚧 更新；另核對 npm 子程序後固定 Node22 PATH 重驗，保留先前輸出；emulator 範圍是多客戶端保存／去重，不宣稱 emulator 重啟持久性。
- 證據位於 .local/oa-response-20260925/，含 verify-node22.log、failure-store-emulator.json、verification.md、deploy-source-manifest.json、before-*、after-*、smoke.json 及 final-state.json。
- 第一階段當時部署至 dev：linewebhook-00003-huh，當時 ACTIVE、100% 流量，現已由 00004-teb 取代，OA @249opyjp；原 Webhook URL、runtime service account 及 Secret 版本綁定未變。223 個候選來源檔建立隔離包；從雲端重新下載來源後，148 個應用／建置／package 檔與候選逐 byte 相符。
- 部署 CLI 最後回傳 1，封裝器僅保留 Command failed，未留下能確定末尾原因的完整 Firebase 輸出；因此不將其推定為清理政策警告。未重複部署，改以 Cloud Functions／Cloud Run 實際狀態、148 檔來源比對及實際 webhook 驗證確認更新成功。
- 部署後 LINE 空事件連線與 👆／🚧 validate/reply 格式驗證通過；使用獨立合成群組設定、超長合成文字與無效 replyToken，確認實際入庫、failed=1 及重送首筆時間不變，沒有向真人發送訊息；合成設定與失敗文件在檢查後依 updateTime 清除。
- 部署前後及合成檢查後 ledger 均為 23,272 字元／175 次，未增加，本次翻譯 API 呼叫 0；手機端 👆／🚧 顯示仍待使用者在 dev 群組驗收。
- 既有 v21 未解品質 findings、付費回歸暫停及最後一輪限制繼續保留；本次不改翻譯請求、術語表或品質演算法。

## 2026-09-25 正常略過補強交付

- 新增 👆 回覆：群組文字的 OK／Yes／No、方向不符、純數字／符號／Emoji、僅原生提及、停用文字；LINE 託管群組語音在語音功能停用時亦回覆 👆。成功發送計 processed，不呼叫相關 provider、不保存失敗記錄。
- 保留私訊、退役指令、群組 /我的ID、不支援事件的入口規則；已啟用語音成功取得逐字稿仍照常回覆。符號發送失敗計 failed，不補送、不誤存翻譯失敗，同批繼續。
- Node22 完整 1,471 應用測試、45 工具測試、check/build 通過；verifier 獨立 162 測試與 16 組控制通過，無未解 findings。223 檔候選來源一致；148 個實際部署應用／建置／package 檔逐 byte 相符。
- dev linewebhook-00004-teb 已 ACTIVE、100% 流量；OA @249opyjp、Webhook、runtime 及 Secret 綁定沿用。部署 CLI 末尾回傳 1 且封裝器未保留具體原因，未重複部署；雲端狀態、來源比對與五類實際合成 webhook 檢查確認更新成功。
- 合成檢查使用無效 replyToken，確認五類正常略過均嘗試發送（LINE 拒絕無效 token，failed=1、ignored=0），而非靜默略過；各事件均無失敗記錄。此為回覆路徑證據，非真人接收驗收；所有自建合成設定已清除，未發送真人訊息。
- 本輪部署前後 ledger 均 24,124 字元／182 次，未增加；沒有翻譯 API 呼叫。與前一輪 23,272／175 不同是本輪預檢前既有數值，不列為本輪消耗。
- 證據：.local/oa-skip-20260925/，含 verify.log、verification.md、independent-controls.json、deploy-source-manifest.json、before/after 雲端快照、deployed-source-comparison.json、smoke.json、final-state.json。正式 OA 與既有 v21 品質 findings／付費暫停未變更；手機端符號顯示待使用者驗收。
