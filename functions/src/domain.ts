export const DEFAULT_MAX_MESSAGE_LENGTH = 2_000;
export const DEFAULT_MAX_AUDIO_DURATION_MS = 59_000;
export const DEFAULT_MAX_AUDIO_BYTES = 10_000_000;

const CHINESE_CHARACTER_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

export interface LineWebhookBody {
  destination?: string;
  events?: unknown[];
}

export interface GroupTextMessageEvent {
  type: "message";
  replyToken: string;
  source: {
    type: "group";
    groupId: string;
    userId?: string;
  };
  message: {
    type: "text";
    id?: string;
    text: string;
  };
  webhookEventId?: string;
  deliveryContext?: {
    isRedelivery?: boolean;
  };
}

export interface GroupAudioMessageEvent {
  type: "message";
  replyToken: string;
  source: {
    type: "group";
    groupId: string;
    userId?: string;
  };
  message: {
    type: "audio";
    id: string;
    duration?: number;
    contentProvider: {
      type: "line";
    };
  };
  webhookEventId?: string;
  deliveryContext?: {
    isRedelivery?: boolean;
  };
}

export interface GroupJoinEvent {
  type: "join";
  replyToken: string;
  source: {
    type: "group";
    groupId: string;
  };
  webhookEventId?: string;
}

export interface UserTextMessageEvent {
  type: "message";
  replyToken: string;
  source: {
    type: "user";
    userId: string;
  };
  message: {
    type: "text";
    id?: string;
    text: string;
  };
  webhookEventId?: string;
}

export interface UserAudioMessageEvent {
  type: "message";
  replyToken: string;
  source: {
    type: "user";
    userId: string;
  };
  message: {
    type: "audio";
    id: string;
    duration?: number;
    contentProvider: {
      type: "line";
    };
  };
  webhookEventId?: string;
  deliveryContext?: {
    isRedelivery?: boolean;
  };
}

export function containsChinese(text: string): boolean {
  return CHINESE_CHARACTER_PATTERN.test(text);
}

export function isGroupTextMessageEvent(event: unknown): event is GroupTextMessageEvent {
  if (!isRecord(event) || event.type !== "message") {
    return false;
  }

  const source = event.source;
  const message = event.message;

  return (
    typeof event.replyToken === "string" &&
    isRecord(source) &&
    source.type === "group" &&
    typeof source.groupId === "string" &&
    isRecord(message) &&
    message.type === "text" &&
    typeof message.text === "string"
  );
}

export function isGroupAudioMessageEvent(event: unknown): event is GroupAudioMessageEvent {
  if (!isRecord(event) || event.type !== "message") {
    return false;
  }

  const source = event.source;
  const message = event.message;

  return (
    typeof event.replyToken === "string" &&
    isRecord(source) &&
    source.type === "group" &&
    typeof source.groupId === "string" &&
    isRecord(message) &&
    message.type === "audio" &&
    typeof message.id === "string" &&
    (message.duration === undefined || typeof message.duration === "number") &&
    isRecord(message.contentProvider) &&
    message.contentProvider.type === "line"
  );
}

export function isGroupJoinEvent(event: unknown): event is GroupJoinEvent {
  if (!isRecord(event) || event.type !== "join") {
    return false;
  }

  const source = event.source;
  return (
    typeof event.replyToken === "string" &&
    isRecord(source) &&
    source.type === "group" &&
    typeof source.groupId === "string"
  );
}

export function isUserTextMessageEvent(event: unknown): event is UserTextMessageEvent {
  if (!isRecord(event) || event.type !== "message") {
    return false;
  }

  const source = event.source;
  const message = event.message;
  return (
    typeof event.replyToken === "string" &&
    isRecord(source) &&
    source.type === "user" &&
    typeof source.userId === "string" &&
    isRecord(message) &&
    message.type === "text" &&
    typeof message.text === "string"
  );
}

export function isUserAudioMessageEvent(event: unknown): event is UserAudioMessageEvent {
  if (!isRecord(event) || event.type !== "message") {
    return false;
  }

  const source = event.source;
  const message = event.message;
  return (
    typeof event.replyToken === "string" &&
    isRecord(source) &&
    source.type === "user" &&
    typeof source.userId === "string" &&
    isRecord(message) &&
    message.type === "audio" &&
    typeof message.id === "string" &&
    (message.duration === undefined || typeof message.duration === "number") &&
    isRecord(message.contentProvider) &&
    message.contentProvider.type === "line"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

