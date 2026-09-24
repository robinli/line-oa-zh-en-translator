# 單一入口與 Translation LLM 實作結果

> 歷史紀錄：目前已完成 v12 正式切換，現況見 [持續轉換進度](TranslationLLM持續轉換進度.md)；本頁數字不代表現況。

日期：2026-09-23。

> 此頁保留 v1 HTML 實驗與單一入口的歷史結果；v12 已正式部署，僅原生提及採可見姓名 HTML，其他純文字；現況與品質門檻見 [持續轉換進度](TranslationLLM持續轉換進度.md)。下列 v1 數字不代表最新版。

## 結論與交付狀態

- 本機已恢復單一 LINE OA／lineWebhook／lineTranslationGroups，依聊天室模式延遲建立中英或中越翻譯程序。
- 中越程序使用 general/nmt；中英仍使用既有 business／Gemini。兩個程序共用入口與設定，商務規則及稱呼別名僅中英載入。
- TranslationLlmTranslator、術語表、合成評估與資料保護測試已完成；**品質放行失敗，未加入正式 translator factory，不能以 TRANSLATION_ENGINE=translation-llm 啟用**。
- Node.js 22.23.2 的 TypeScript 檢查、359 項測試及建置通過。本次沒有部署、修改正式環境參數、重設聊天室或向真人發送測試訊息。
- 已建立兩個 Google glossary 與非公開術語檔儲存桶；這是評估資源建立，不是正式 Function 切換。

## 單一入口行為

原有 /翻譯設定 只讀取狀態並顯示全部模式指令；/中英翻譯、/中越翻譯、/中翻英、/英翻中 寫入同一個聊天室文件。切換模式只開啟文字，不改語音與其他聊天室。

getTranslationProgram(mode) 延遲初始化並快取成功的程序。只有 zh-vi 建立 VietnameseNmtTranslator；其他三個模式共用中英程序。中英設定錯誤不阻止中越、設定指令或純語音辨識；文字及語音翻譯使用同一路由。原生 mention metadata 在兩者保留，中英別名不傳給中越。

已移除未部署的 programs/、雙 Firebase 配置、第二個 Function 入口及 profile 限制；根目錄 deploy 回到 firebase deploy --only functions:lineWebhook，原 Webhook URL、Secret 名稱及 Firestore schema 均不變。舊 enabled 欄位繼續相容，沒有自動遷移。

## Translation LLM 介面與實測限制

新 adapter 沿用 Translator 與 {text, ranges} 介面，使用完整模型路徑 general/translation-llm、固定中英方向、15 秒逾時、關閉 SDK 重試；品質拒絕最多重試一次，服務錯誤不重試、不跨引擎備援。只接受 glossaryTranslations，沒有回退讀取未套術語表的 translations。

資料以完整段落送出，逐項保護數字、公式、幣別、單位、已知人名、代碼、聯絡資料、字面 markup 及來源提及；保留段落分隔及提及來源位置，資料遺漏／重複／改名／新增數字會拒絕。prepareTradeText 新增選用的 protectLiteralMarkup，預設 false，因此未改變正式 Gemini 的保護行為。

原計畫的 contextual glossary + text/html 經兩次合成探測均回 HTTP 400：

~~~text
Contextual translation is only supported for text/plain mime type.
~~~

因此正式候選實驗改成 **一般 glossary（contextualTranslationEnabled=false）＋text/html**，不是已驗證 contextual glossary。不能為了開啟 contextual glossary 而取消原生提及及數字保護。Google 指南介紹兩種 glossary，但此 MIME 限制以本次實測回應為依據。

## 三輪結果與未放行原因

固定資料為既有 26 則中英案例及事先建立、未參與術語表調整的 30 則獨立案例，每則三輪。所有內容、人物及提及均為合成資料。

| 項目 | 實際結果 |
|---|---|
| 案例執行 | 56 × 3 = 168 |
| API 呼叫 | 186 次，全部 HTTP 200；另有先前 2 次 MIME 限制探測 HTTP 400 |
| API 呼叫較多的原因 | 21 次品質拒絕各重試一次；3 次 code-only 直接安全還原，沒有 API 呼叫 |
| 既有案例機械通過 | 60/78 |
| 獨立案例機械通過 | 87/90 |
| 合計機械通過／拒絕 | 147/168（87.5%）／21/168 |
| 未被機械攔截的重大錯誤 | h04、h12，各三輪皆出現 |
| API 耗時 P50／P95 | 461／904 毫秒，為本機樣本，非 LINE 端到端 SLA |
| 送收字元 | 43,269／44,283，含編碼膨脹與品質重試 |
| 標準價估算 | US$0.87552，不含探測、儲存、稅金等；非實際帳單核對 |
| 重複結果 | 每則三輪輸出相同，可能受服務快取影響，不能當三份獨立品質證據 |

獨立案例的機械通過率雖為 96.7%，**不等於有效翻譯率或語義正確率**；重大錯誤未被攔截，因此零重大錯誤的放行條件不成立。沒有為提高通過率調低規則或改寫期待結果。

重大錯誤：

1. h04 原文：Alex should check the freight, but Alex is not required to approve the quotation.
   譯文：Alex應核對運費，但Alex核准該報價。
   「不需要核准」的否定與義務區別消失，機械驗證卻通過。
2. h12 原文：Please retain 612+28, USD 1,045.70, 3.25 MT and 0.85%.
   譯文：請保留612+28 、 USD 1,045.70 MT及3.25 0.85% 。
   原值都保留，但 MT 與金額錯配；逐值驗證不能保證數量與單位關係正確。
3. modality-can-should-must 仍出現「不應只是」加強語氣，同時 Alex 的位置與詢問對象受損；因重複人名被拒絕。
4. price-inclusion、negated-commission、name-and-party、alias-address、distinct-names、h14 等存在人名重複或錯位並被拒絕；六個既有問題未全部解決。
5. h11 譯文混入簡體「这」，未完整符合繁體要求；h08 有角色用語重複。

逐句檢視由 Codex 完成，不是業務人員人工驗收。見 [逐句附錄](評估附錄/2026-09-23TranslationLLM術語表逐句輸出.md) 及 [機器可讀評估結果](../functions/evaluation/tllm-v1-review.json)。原始重試回應存於 Git 忽略的 .local/tllm-evaluation/2026-09-23T11-13-58-217Z.json。

## 雲端資源與重現

專案 line-auto-translate-bot，位置 us-central1：

- 非公開 bucket：line-auto-translate-bot-translation-glossaries，uniform bucket-level access 與 public access prevention 啟用。
- trade-zh-en-v1：14 個中翻英術語。
- trade-en-zh-v1：18 個英翻中術語。
- GCS 來源為 v1/zh-en-v1.tsv、v1/en-zh-v1.tsv；來源同時保存在 functions/glossaries/。後續更改另建 v2，不覆寫 v1。
- 建立與實測使用登入帳號的短期 access token；未新建長期金鑰、未改 IAM，尚未驗證正式 runtime 帳號的 glossary 存取。
- Cloud Translation 不另收 glossary 建立費，但 GCS 有自身計費。資源保留供重現與後續評估。

已有術語表時，可在 Node.js 22 下執行：

~~~powershell
npm.cmd run verify
$env:GOOGLE_CLOUD_PROJECT = "line-auto-translate-bot"
$env:TLLM_EVAL_ROUNDS = "3"
try {
  $env:TRANSLATION_EVAL_TOKEN = (gcloud.cmd auth print-access-token).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Unable to obtain evaluation credential." }
  npm.cmd run evaluate:tllm
} finally {
  Remove-Item Env:TRANSLATION_EVAL_TOKEN -ErrorAction SilentlyContinue
}
~~~

evaluate:tllm 僅讀固定合成資料，沒有任意聊天檔輸入參數；每則結果即時存檔。腳本成功執行不代表品質放行，semanticGate 仍須逐句檢視。provision:tllm-glossaries 可建立固定版本資源，發現既有語言／來源設定不同即停止，不覆寫資源；首次需先以受控帳號建立非公開 bucket 並上傳固定術語檔。

## 正式切換與回復狀態

依核准計畫的第一階段門檻，本次 **停止 Translation LLM 正式接入與切換**。單一入口的 Gemini＋NMT 基準已完成本機開發，但尚未部署；現有正式第 15 版不受本次變更影響。

本次未做的後續工作：Translation LLM 正式 factory／環境參數啟用、runtime glossary 授權驗收、正式部署、LINE 真人提及通知驗收、長文／高負載實測及長期監控。原因是品質未放行，不能記成完成。OpenAI／Adaptive Translation／模型訓練也不在此階段。

後續若有新的保護策略，需先消除已知否定與數量單位錯配問題，使用新的獨立案例再驗證；不能以硬套用詞、取消人名驗證或未驗證備援引擎繞過門檻。屆時以新版本術語表與輸入策略建立新的評估紀錄。

單一入口未來部署前仍需重新核對正式版本、備份設定及可用映像。中英回復使用 business／Gemini，讓中越繼續 NMT；目前沒有需要回復的正式變更。

## 官方參考

- [Translation LLM](https://docs.cloud.google.com/translate/docs/translation-llm)
- [Glossary](https://docs.cloud.google.com/translate/docs/advanced/glossary)
- [API 回應欄位](https://docs.cloud.google.com/translate/docs/reference/rest/v3/TranslateTextResponse)
- [計費](https://cloud.google.com/products/translate/pricing)

