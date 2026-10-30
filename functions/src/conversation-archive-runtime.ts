import {buildReplyMessages} from "./line-messages.js";
import {remainingTimeout, withinTime} from "./translation-deadline.js";
import type {WebhookDependencies} from "./webhook.js";
import type {LineReplyObserver} from "./services.js";
import {ArchivePersistenceError, type ArchiveEvent} from "./conversation-archive.js";

export function archiveEventDependencies(dependencies: WebhookDependencies, record: ArchiveEvent): WebhookDependencies {
  const store = dependencies.archiveStore!;
  const bounded = <T>(run: () => Promise<T>) => withinTime(run, remainingTimeout(dependencies.deadlineAtMs, 2000));
  let attempt = 0;
  return {...dependencies, replier: {
    replyText: async (token, text, context, deadlineAtMs) => {
      let replyId: string | null = null;
      const observer: LineReplyObserver = {
        prepare: async messages => {
          try {replyId = await bounded(() => store.prepareReply(record, attempt++, messages));}
          catch (error) {if (error instanceof Error && error.name === "ArchiveRedactedError") throw error; throw new ArchivePersistenceError();}
        },
        complete: async result => {
          if (!replyId) return;
          try {await bounded(() => store.finishReply(replyId!, result));}
          catch {dependencies.logger.error("Conversation reply result unavailable.", {reason: "archive_reply_store_error", archiveEventId: record.id});}
        },
      };
      if (dependencies.replier.supportsReplyObserver) {
        await dependencies.replier.replyText(token, text, context, deadlineAtMs, observer);
      } else {
        await observer.prepare(buildReplyMessages(text, context?.mentions));
        try {
          if (deadlineAtMs !== undefined) await dependencies.replier.replyText(token, text, context, deadlineAtMs);
          else if (context) await dependencies.replier.replyText(token, text, context);
          else await dependencies.replier.replyText(token, text);
          await observer.complete({status: "accepted"});
        } catch (error) {await observer.complete({status: "unknown"}); throw error;}
      }
    },
  }};
}
