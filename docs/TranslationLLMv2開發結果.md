# Translation LLM v2 開發與品質結果

> 歷史紀錄：最新候選與仍待完成工作見 [持續轉換進度](TranslationLLM持續轉換進度.md)；本頁數字不代表現況。

日期：2026-09-23。最新狀態：候選程式已改善，品質仍未放行，沒有部署或正式切換。

## 已完成

保留同一個 LINE OA、lineWebhook 及聊天室設定。中越 NMT 路由與中英 Gemini 基準不變；Translation LLM 仍限離線評估，translator factory 未加入啟用入口。

- 新增 translation-llm-protection.ts：改成 text/plain 短標記，每個受保護值都有唯一標記；相鄰幣別、金額、單位、貿易條件作為整組保護，不跨逗號或句子合併。
- 原生提及仍依來源 UTF-16 範圍還原，支援重複同名和重新排序；人名、代碼、聯絡資料、公式與字面 entity 受保護。
- 每次品質重試換一組標記，最多兩次；未新增跨引擎備援。服務錯誤不重試，API 單次 15 秒、SDK retry 關閉。
- 加上 not required/obliged/obligated 與 can 被改成不應等有限規則；這不是完整語意驗證，不能保證其他否定與義務關係正確。
- 真實 API 在 text/plain 仍回傳 &#39;、&quot;，新增一次性 transport entity 解碼，先解 API 輸出再還原來源值；原文 &#39;、&amp;amp; 等不被解碼。非法碼點拒絕，數字 entity 不能繞過新增數字驗證。
- 新增獨立 v2 glossary：中英 14 詞、英中 20 詞；英中增加 Instead of only／instead of only → 除了。v1 未覆寫。
- Node.js 22.23.2 下型別檢查、371 項測試及建置通過；含金額整組保護、20 處原生提及、Emoji 位移、標記損毀、重試、entity 邊界與語意攔截測試。

## 實際 API 結果

基線使用 56 個既有案例，加上事前固定的 30 個新留出案例，全部跑三輪。發現 transport 解碼問題後，只修正解碼並對同 86 個案例跑一輪；此時所有案例均屬回歸資料，不再宣稱新的獨立留出驗證。

| 項目 | v2 三輪基線 | 修正解碼後最新版 |
|---|---:|---:|
| 案例執行 | 86 × 3 = 258 | 86 × 1 = 86 |
| 完整性檢查通過 | 242/258（93.8%） | 85/86（98.8%） |
| 拒絕 | 16 | 1 |
| API 呼叫／服務失敗 | 272/0 | 86/0 |
| 送入／回傳字元 | 18397/22763 | 5939/7009 |
| API 嘗試耗時 P50/P95（毫秒） | 470/876 | 444/523 |
| 標準價估算（美元） | 0.4116 | 0.12948 |

兩次主評估合計 US$0.54108，按输入与输出各 US$10/百萬字元估算；不含額外探測、儲存、稅、免費額度或折扣，也不是帳單核對。P50/P95 是本機 API 嘗試與驗證時間，不是 LINE 端到端 SLA。計價依 [Google 官方價格頁](https://cloud.google.com/products/translate/pricing)。

最新版唯一完整性拒絕為 v2h21：三個金額均被模型遺漏，第二次仍相同，程式沒有送出不完整譯文。原生提及的合成位置檢查皆通過；20 處提及僅完成本機測試，尚未真人通知或雲端壓力驗收。

**98.8% 是機械完整性檢查通過率，絕不是翻譯準確率。** 未攔截的重大語意錯誤仍存在，因此即使數量門檻表面通過，也不允許接入正式流量。

## 已改善與剩餘問題

舊 h04 的「Alex 無需核准」現在保留；h12 的 USD 1,045.70、3.25 MT 和 0.85% 不再相互錯配；原 modality 案例與新增兩個 Instead of only 案例均保留「可以」程度。人名重複的主要舊案例已通過數量保護，但不代表所有代詞或稱呼已正確。

仍阻擋放行：

1. v2h07：原文單價 at EUR 846.25/MT CFR，被翻成「地點在 EUR 846.25/MT CFR」。保護值完整，但價格關係錯誤。
2. instruction-as-data：USD 845 的報價，被翻成 quote from USD 845，金額被當成報價來源。
3. v2h21：成本價、底價、對客報價的三個金額被漏掉；已攔截，但無可用譯文。
4. v2h15：引用的 reply only approved 沒有翻譯。v2h16、v2h20 使用 it 指稱人物，責任主體不清。
5. h08/v2h11 術語重複，h11 簡體「这」，alias-address「請請」，以及稱呼與語法不自然；逐句附錄另記錄參與者遺漏等問題。

根據目前證據，短標記能保護值卻遮住其語意類型。額外 8 則合成探測把金額可見化後，部分關係恢復，但模型將 EUR/MT 改成歐元／公噸，違反原字面資料保留要求，因此沒有採用這個替代策略。也未以硬改完整譯句、取消驗證或增加未驗證備援掩蓋錯誤。

## 評估工具與證據

- [逐句附錄](評估附錄/2026-09-23TranslationLLMv2逐句輸出.md)
- [機器可讀 review、不同輸出及 SHA-256](../functions/evaluation/tllm-v2-review.json)
- 原始三輪回應：.local/tllm-evaluation/2026-09-23T11-50-28-027Z.json
- 最新一輪回應：.local/tllm-evaluation/2026-09-23T11-54-35-553Z.json
- .local/ 僅為 Git 忽略的本機合成評估輸出；review 與附錄保留可審查證據。
- evaluate:tllm 現在執行 v2 候選；舊 v1 結果及 v1 review 保留歷史，不宣稱用新版 adapter 能重現 v1 HTML 實驗。

重跑最新版（Node.js 22）：

~~~powershell
npm.cmd run verify
$env:GOOGLE_CLOUD_PROJECT = "line-auto-translate-bot"
$env:TLLM_EVAL_ROUNDS = "1" # 可設為 3；不是語意自動放行
try {
  $env:TRANSLATION_EVAL_TOKEN = (gcloud.cmd auth print-access-token).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Unable to acquire evaluation token." }
  npm.cmd run evaluate:tllm
} finally {
  Remove-Item Env:TRANSLATION_EVAL_TOKEN -ErrorAction SilentlyContinue
}
~~~

只讀固定合成資料，不接受任意真實聊天檔。取得短期 token，沒有新建金鑰或變更 IAM。v2 來源為既有非公開 bucket 的 v2/zh-en-v2.tsv、v2/en-zh-v2.tsv，glossary 在 us-central1，名稱 trade-zh-en-v2／trade-en-zh-v2。provision:tllm-glossaries:v2 僅建立這兩個版本化資源，既有配置不同即拒絕。

## 後續必要工作

下一個可驗證的開發方向是讓模型知道標記代表人物、單價或數量，同時維持字面值與提及位置的嚴格還原；需另外處理術語表局部替換造成的重複、完整翻譯及繁體輸出。這些仍是待開發方案，不能寫成已解決。

候選品質通過後，才進行引擎 factory／環境參數接入、runtime glossary 帳號實測、正式部署與 LINE 真人驗收。本次沒有改正式 LINE OA、聊天室設定、Function 參數或流量，也沒有發送真人訊息；已知正式版本仍以先前核對的 linewebhook-00015-poq 為準，本次未重新查詢正式狀態。
