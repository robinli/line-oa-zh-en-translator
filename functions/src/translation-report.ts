import type {UserTextMessageEvent} from "./domain.js";
import {qualityCaseId, REPORT_SESSION_MS, type QualityConfig, type QualityMessage, type QualitySearchResult, type ReportSession, type ReportTransition, type TranslationQualityStore} from "./translation-quality-store.js";

export const REPORT_COMMAND = "/翻譯錯誤";
const MENU = "翻譯錯誤回報\n1 搜尋已記錄訊息\n2 手動輸入\n隨時輸入 /返回 或 /取消。";
const DIRECTIONS = ["中→英", "英→中", "中→越", "越→中", "不確定"];
export async function processTranslationReport(event: UserTextMessageEvent, ownerId: string,
  store: TranslationQualityStore, config: QualityConfig, now = new Date(), onActiveSession?: () => void): Promise<string | null> {
  if (!ownerId || event.source.userId !== ownerId || (!event.webhookEventId && !event.message.id)) return null;
  const text = event.message.text.trim();
  const eventId = event.webhookEventId ?? `message:${event.message.id}`;
  // A transaction can retry; reuse its bounded search result rather than rescanning.
  const searches = new Map<string, Promise<QualitySearchResult>>();
  return store.transitionReport(ownerId, eventId, async previous => {
    if (previous) onActiveSession?.();
    const fresh = (): ReportSession => ({id: eventId, stage: "menu", expiresAt: now.getTime() + REPORT_SESSION_MS, draft: {kind: "search"}});
    let session: ReportSession = previous ? structuredClone(previous) : fresh();
    const respond = (reply: string): ReportTransition => ({session, reply});
    if (text === REPORT_COMMAND) {session = fresh(); return respond(MENU);}
    if (!previous) return {session: null, reply: text === "/取消" || text === "/返回" || text === "確認" ? "目前沒有有效的回報草稿，請輸入 /翻譯錯誤。" : null};
    if (session.stage === "submitted" && text !== "/取消") return respond(`已建立翻譯錯誤案件 ${qualityCaseId(ownerId, session.id)}，狀態：待分析。輸入 /翻譯錯誤 開始新回報。`);
    session.expiresAt = now.getTime() + REPORT_SESSION_MS;
    if (text === "/取消") return {session: null, reply: "已取消回報。"};
    if (text === "/返回") {
      const back: Record<string, string> = {searchGroup: "menu", searchDates: "searchGroup", searchKeyword: "searchDates", searchResults: "searchKeyword", view: "searchResults", issue: "searchResults", suggestion: "issue", preview: session.draft.kind === "manual" ? "manualSuggestion" : "suggestion", manualGroup: "menu", manualDirection: "manualGroup", manualSource: "manualDirection", manualTranslation: "manualSource", manualIssue: "manualTranslation", manualSuggestion: "manualIssue"};
      session.stage = back[session.stage] ?? "menu";
      return respond(prompt(session, config));
    }
    if (session.stage === "menu") {
      if (text === "1" || text === "搜尋") {session.stage = "searchGroup"; session.draft = {kind: "search"};}
      else if (text === "2" || text === "手動") {session.stage = "manualGroup"; session.draft = {kind: "manual"};}
      return respond(prompt(session, config));
    }
    if (session.stage === "searchGroup" || session.stage === "manualGroup") {
      const index = /^\d$/u.test(text) ? Number(text) : -1;
      const group = config.groups[index - 1];
      if (index !== 0 && !group) return respond(prompt(session, config));
      session.draft.groupId = group?.id ?? null;
      session.draft.groupName = group?.name ?? (session.stage === "manualGroup" ? "未指定" : "全部群組");
      if (session.stage === "manualGroup") session.stage = "manualDirection";
      else {session.search = {groupIds: group ? [group.id] : config.groups.map(item => item.id), start: now.getTime() - 7 * 86400000, end: now.getTime(), keyword: ""}; session.stage = "searchDates";}
      return respond(prompt(session, config));
    }
    if (session.stage === "searchDates") {
      if (text !== "7" && text !== "最近7天" && text !== "預設") {
        const dates = parseReportDates(text);
        if (!dates) return respond("日期無效。請輸入 7，或 YYYY-MM-DD YYYY-MM-DD（台灣時間，含起訖日）。");
        session.search!.start = dates.start; session.search!.end = dates.end;
      } else {session.search!.start = now.getTime() - 7 * 86400000; session.search!.end = now.getTime();}
      session.stage = "searchKeyword"; return respond(prompt(session, config));
    }
    if (session.stage === "searchKeyword" || (session.stage === "searchResults" && text === "下一頁")) {
      if (session.stage === "searchKeyword") {
        if (!text || text.length > 200) return respond("請輸入 1～200 字關鍵字；輸入 * 列出期間內有文字的訊息。");
        session.search!.keyword = text === "*" ? "" : text; delete session.search!.cursor;
      } else {
        if (!session.nextCursor) return respond("已無下一頁。\n" + prompt(session, config));
        session.search!.cursor = session.nextCursor;
      }
      const query = session.search!;
      const key = JSON.stringify(query);
      if (searches.size && !searches.has(key)) throw new Error("quality_search_conflict");
      if (!searches.has(key)) searches.set(key, store.search({...query, start: new Date(query.start), end: new Date(query.end)}));
      const results = await searches.get(key)!;
      session.results = results.messages; session.nextCursor = results.cursor; session.stage = "searchResults";
      return respond(prompt(session, config));
    }
    if (session.stage === "searchResults") {
      const selected = /^[1-5]$/u.test(text) ? session.results?.[Number(text) - 1] : undefined;
      if (!selected || !config.groups.some(group => group.id === selected.groupId)) return respond(prompt(session, config));
      session.draft.message = selected; session.draft.groupId = selected.groupId; session.draft.groupName = selected.groupName;
      session.draft.sourceText = selected.sourceText ?? ""; session.draft.translatedText = selected.translatedText ?? null;
      session.draft.direction = `${selected.sourceLanguageCode ?? "未判定"}→${selected.targetLanguageCode ?? "未判定"}`;
      session.viewOffset = 0; return showSelection(session);
    }
    if (session.stage === "view") {
      if (text !== "下一段") return respond("請輸入 下一段 閱讀完整訊息，或 /返回。");
      return showSelection(session);
    }
    if (session.stage === "manualDirection") {
      const direction = /^[1-5]$/u.test(text) ? DIRECTIONS[Number(text) - 1] : undefined;
      if (!direction) return respond(prompt(session, config));
      session.draft.direction = direction; session.stage = "manualSource"; return respond(prompt(session, config));
    }
    const fields: Record<string, {field: "sourceText" | "translatedText" | "issue" | "suggestion"; next: string; max: number; optional?: boolean}> = {
      manualSource: {field: "sourceText", next: "manualTranslation", max: 5000},
      manualTranslation: {field: "translatedText", next: "manualIssue", max: 6000, optional: true},
      manualIssue: {field: "issue", next: "manualSuggestion", max: 2000},
      issue: {field: "issue", next: "suggestion", max: 2000},
      manualSuggestion: {field: "suggestion", next: "preview", max: 6000, optional: true},
      suggestion: {field: "suggestion", next: "preview", max: 6000, optional: true},
    };
    const field = fields[session.stage];
    if (field) {
      if (!text || text.length > field.max) return respond(`請輸入 1～${field.max} 字。\n` + prompt(session, config));
      const value = field.optional && (text === "略過" || text === "無") ? null : text;
      if (field.field === "issue" || field.field === "sourceText") session.draft[field.field] = value!;
      else session.draft[field.field] = value;
      session.stage = field.next; return respond(prompt(session, config));
    }
    if (session.stage === "preview" && text === "確認") {
      if (!session.draft.issue?.trim() || (session.draft.kind === "search" && !session.draft.message)) return respond("草稿不完整，請 /返回 補充。");
      const id = qualityCaseId(ownerId, session.id);
      session.stage = "submitted";
      return {session, reply: `已建立翻譯錯誤案件 ${id}，狀態：待分析。`, errorCase: {id, ownerUserId: ownerId, status: "pending_analysis", createdAt: now, draft: session.draft}};
    }
    return respond(prompt(session, config));
  });
}
function prompt(session: ReportSession, config: QualityConfig): string {
  const groupChoices = config.groups.map((group, index) => `${index + 1} ${group.name}`).join("\n");
  switch (session.stage) {
    case "menu": return MENU;
    case "searchGroup": return "選擇搜尋群組：\n0 全部已設定群組\n" + groupChoices;
    case "manualGroup": return "選擇群組：\n0 未指定\n" + groupChoices;
    case "searchDates": return "搜尋期間：輸入 7 使用最近 7 天，或 YYYY-MM-DD YYYY-MM-DD（台灣時間，含起訖日）。";
    case "searchKeyword": return "輸入原文／譯文關鍵字（忽略大小寫、全半形、連續空白）；* 表示全部。";
    case "searchResults": return (session.results?.length ? session.results.map((message, i) => `${i + 1}. ${message.groupName} ${formatTime(message.eventTime)}\n${(message.sourceText ?? "").replace(/\s/gu, " ").slice(0, 100)}\n譯：${(message.translatedText ?? "無").replace(/\s/gu, " ").slice(0, 100)}`).join("\n\n") : "此批沒有符合訊息。") + `\n\n輸入編號查看全文。${session.nextCursor ? "輸入 下一頁 繼續搜尋（每次最多掃描 200 筆）。" : "已無下一頁。"}\n/返回 修改條件；/取消 結束。`;
    case "manualDirection": return "選擇翻譯方向：\n" + DIRECTIONS.map((direction, i) => `${i + 1} ${direction}`).join("\n");
    case "manualSource": return "輸入原文（必填，最多 5000 字）。";
    case "manualTranslation": return "輸入錯誤譯文；若沒有譯文，輸入 無（最多 6000 字）。";
    case "manualIssue": case "issue": return "請說明哪裡翻錯（必填，最多 2000 字）。";
    case "manualSuggestion": case "suggestion": return "輸入建議譯法（最多 6000 字），或輸入 略過。";
    case "preview": return `回報預覽\n群組：${session.draft.groupName}\n方向：${session.draft.direction}\n${session.draft.message ? `訊息：${session.draft.message.id}\n原文／譯文：已選取並保留剛才的完整訊息快照。` : `原文：${session.draft.sourceText}\n錯誤譯文：${session.draft.translatedText ?? "無"}`}\n問題：${session.draft.issue}\n建議：${session.draft.suggestion ?? "無"}\n\n輸入 確認 才會建立案件；/返回 修改；/取消 放棄。`;
    default: return MENU;
  }
}
function showSelection(session: ReportSession): ReportTransition {
  const message = session.draft.message!;
  const full = `群組：${message.groupName}\n時間：${formatTime(message.eventTime)}\n方向：${session.draft.direction}\n原文／逐字稿：\n${message.sourceText ?? "無"}\n\n系統譯文：\n${message.translatedText ?? "無"}\n\n實際回覆：\n${message.replyText ?? "無"}\n狀態：${message.outcome ?? "處理中"} / ${message.deliveryStatus ?? "未完成"}`;
  const offset = session.viewOffset ?? 0;
  let end = Math.min(offset + 18000, full.length);
  if (end < full.length && /[\uD800-\uDBFF]/u.test(full[end - 1]!)) end--;
  session.viewOffset = end;
  session.stage = end < full.length ? "view" : "issue";
  return {session, reply: full.slice(offset, end) + (session.stage === "view" ? "\n\n輸入 下一段 繼續閱讀。" : "\n\n請說明哪裡翻錯（必填，最多 2000 字）；/返回 重選。")};
}
function formatTime(value: unknown): string {
  const date = value instanceof Date ? value : value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function" ? value.toDate() : null;
  return date instanceof Date ? date.toLocaleString("zh-TW", {timeZone: "Asia/Taipei", hour12: false}) : "未知";
}
export function parseReportDates(text: string): {start: number; end: number} | null {
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/u.exec(text);
  if (!match) return null;
  const day = (value: string): number => {
    const timestamp = Date.parse(value + "T00:00:00+08:00");
    return Number.isFinite(timestamp) && new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10) === value ? timestamp : NaN;
  };
  const start = day(match[1]!); const end = day(match[2]!) + 86400000 - 1;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? {start, end} : null;
}
