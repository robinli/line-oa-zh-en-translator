import {deadlineFirestore} from "./translation-deadline.js";
import {remainingTimeout, withinTime, deadlineSignal, assertDeadlineActive} from "./translation-deadline.js";
import {ContentLimitError} from "./translation-failures.js";
import type {TranslationMode} from "./domain.js";
import type {RestoredTextRange} from "./message-text.js";
import {LineGroupMemberVerifier, type GroupMemberVerifier, type MentionReplyContext} from "./mentions.js";
import {buildReplyMessages} from "./line-messages.js";
import type {messagingApi} from "@line/bot-sdk";
import type {ReplyArchiveResult} from "./conversation-archive.js";

export interface LineReplyObserver {
  prepare(messages: readonly unknown[]): Promise<void>;
  complete(result: ReplyArchiveResult): Promise<void>;
}

export interface TranslationContext {
  quoteContext?: import("./sol-review-types.js").QuoteContext;
  deadlineAtMs?: number;
  protectedRanges?: ReadonlyArray<{start: number; length: number}>;
  // Trusted literal scopes; never inferred from LINE identities or untrusted metadata.
  copyExactRanges?: ReadonlyArray<{start: number; length: number}>;
}

export interface Translator {
  translate(text: string, sourceLanguageCode: string, targetLanguageCode: string,
    context?: TranslationContext): Promise<string>;
  translateWithRanges?(text: string, sourceLanguageCode: string, targetLanguageCode: string,
    context?: TranslationContext): Promise<{text: string; ranges: RestoredTextRange[]}>;
}

export interface TranscriptionResult {
  text: string;
  languageCode?: string;
}

export interface AudioTranscriber {
  transcribe(audioContent: Buffer, languageCodes: string[], deadlineAtMs?: number): Promise<TranscriptionResult>;
}

export interface AudioContentLoader {
  getMessageContent(messageId: string, maxBytes: number, deadlineAtMs?: number): Promise<Buffer>;
}

export interface LineReplier {
  supportsReplyObserver?: boolean;
  replyText(replyToken: string, text: string, context?: MentionReplyContext, deadlineAtMs?: number, observer?: LineReplyObserver): Promise<void>;
}

export interface ConversationSettings {
  recordingEnabled?: boolean;
  textTranslationEnabled: boolean;
  audioTranscriptionEnabled: boolean;
  translationMode: TranslationMode;
}

export interface ConversationSettingsStore {
  getSettings(conversationId: string): Promise<ConversationSettings>;
  setTextTranslationEnabled(conversationId: string, enabled: boolean, changedBy: string): Promise<void>;
  setAudioTranscriptionEnabled(conversationId: string, enabled: boolean, changedBy: string): Promise<void>;
  setModeAndEnabled(
    conversationId: string,
    translationMode: TranslationMode,
    changedBy: string,
  ): Promise<void>;
}

interface FirestoreDocumentSnapshot {
  get(field: string): unknown;
}

interface FirestoreDocumentReference {
  get(): Promise<FirestoreDocumentSnapshot>;
  set(data: Record<string, unknown>, options: {merge: boolean}): Promise<unknown>;
}

interface FirestoreClient {
  collection(path: string): {
    doc(id: string): FirestoreDocumentReference;
  };
}

export class FirestoreConversationSettingsStore implements ConversationSettingsStore {
  public constructor(private readonly firestore: FirestoreClient) {this.firestore = deadlineFirestore(firestore);}

  public async getSettings(conversationId: string): Promise<ConversationSettings> {
    const snapshot = await this.conversationDocument(conversationId).get();
    const storedMode = snapshot.get("translationMode");
    return {
      recordingEnabled: snapshot.get("recordingEnabled") === true,
      textTranslationEnabled: readFeatureFlag(snapshot, "textTranslationEnabled"),
      audioTranscriptionEnabled: readFeatureFlag(snapshot, "audioTranscriptionEnabled"),
      translationMode: storedMode === "zh-to-en" || storedMode === "en-to-zh" ||
        storedMode === "zh-vi" ? storedMode : "zh-en",
    };
  }

  public async setTextTranslationEnabled(
    conversationId: string, enabled: boolean, changedBy: string,
  ): Promise<void> {
    await this.setFeatureEnabled(conversationId, "textTranslationEnabled", enabled, changedBy);
  }

  public async setAudioTranscriptionEnabled(
    conversationId: string, enabled: boolean, changedBy: string,
  ): Promise<void> {
    await this.setFeatureEnabled(conversationId, "audioTranscriptionEnabled", enabled, changedBy);
  }

  private async setFeatureEnabled(
    conversationId: string,
    field: "textTranslationEnabled" | "audioTranscriptionEnabled",
    enabled: boolean,
    changedBy: string,
  ): Promise<void> {
    await this.conversationDocument(conversationId).set(
      {
        [field]: enabled,
        changedBy,
        changedAt: new Date(),
      },
      {merge: true},
    );
  }

  public async setModeAndEnabled(
    conversationId: string,
    translationMode: TranslationMode,
    changedBy: string,
  ): Promise<void> {
    await this.conversationDocument(conversationId).set(
      {
        textTranslationEnabled: true,
        translationMode,
        changedBy,
        changedAt: new Date(),
      },
      {merge: true},
    );
  }

  private conversationDocument(conversationId: string): FirestoreDocumentReference {
    return this.firestore.collection("lineTranslationGroups").doc(conversationId);
  }
}

function readFeatureFlag(snapshot: FirestoreDocumentSnapshot, field: string): boolean {
  const value = snapshot.get(field);
  return typeof value === "boolean" ? value : snapshot.get("enabled") === true;
}

interface TranslationClient {
  translateText(request: {
    parent: string;
    contents: string[];
    mimeType: string;
    sourceLanguageCode: string;
    targetLanguageCode: string;
  }): Promise<[
    {
      translations?: Array<{translatedText?: string | null}> | null;
    },
    ...unknown[],
  ]>;
}

interface MessagingClient {
  replyMessage(request: {
    replyToken: string;
    messages: Array<messagingApi.TextMessage | messagingApi.TextMessageV2>;
  }): Promise<unknown>;
}

interface MessageContentStream extends AsyncIterable<unknown> {
  destroy?(error?: Error): unknown;
}

interface MessagingContentClient {
  getMessageContent(messageId: string): Promise<MessageContentStream>;
}

interface SpeechRecognitionRequest {
  recognizer: string;
  config: {
    autoDecodingConfig: Record<string, never>;
    languageCodes: string[];
    model: string;
    features: {
      enableAutomaticPunctuation: boolean;
    };
  };
  content: Buffer;
}

interface SpeechRecognitionResponse {
  results?: Array<{
    languageCode?: string | null;
    alternatives?: Array<{
      transcript?: string | null;
    }> | null;
  }> | null;
}

interface SpeechRecognitionClient {
  recognize(request: SpeechRecognitionRequest, options?: {timeout: number; retry: {retryCodes: number[]}}): Promise<[
    SpeechRecognitionResponse,
    ...unknown[],
  ]>;
}

export class GoogleCloudTranslator implements Translator {
  private client: TranslationClient | undefined;

  public constructor(
    private readonly projectId: string,
    client?: TranslationClient,
  ) {
    this.client = client;
  }

  public async translate(
    text: string,
    sourceLanguageCode: string,
    targetLanguageCode: string,
  ): Promise<string> {
    const client = await this.getClient();
    const [response] = await client.translateText({
      parent: `projects/${this.projectId}/locations/global`,
      contents: [text],
      mimeType: "text/plain",
      sourceLanguageCode,
      targetLanguageCode,
    });

    const translatedText = response.translations?.[0]?.translatedText?.trim();
    if (!translatedText) {
      throw new Error("Google Cloud Translation API returned an empty translation.");
    }

    return translatedText;
  }

  private async getClient(): Promise<TranslationClient> {
    if (!this.client) {
      const {v3} = await import("@google-cloud/translate");
      this.client = new v3.TranslationServiceClient();
    }

    return this.client;
  }
}

export class GoogleCloudSpeechTranscriber implements AudioTranscriber {
  private client: SpeechRecognitionClient | undefined;

  public constructor(
    private readonly projectId: string,
    client?: SpeechRecognitionClient,
  ) {
    this.client = client;
  }

  public async transcribe(
    audioContent: Buffer,
    languageCodes: string[],
    deadlineAtMs?: number,
  ): Promise<TranscriptionResult> {
    const request = {
      recognizer: `projects/${this.projectId}/locations/global/recognizers/_`,
      config: {autoDecodingConfig: {}, languageCodes, model: "long", features: {enableAutomaticPunctuation: true}},
      content: audioContent,
    };
    let response: SpeechRecognitionResponse;
    if (deadlineAtMs !== undefined && !this.client) {
      // Native fetch makes cancellation include credentials, HTTP and response body.
      const {GoogleAuth} = await import("google-auth-library");
      remainingTimeout(deadlineAtMs);
      const token = await new GoogleAuth({projectId: this.projectId, scopes: ["https://www.googleapis.com/auth/cloud-platform"]}).getAccessToken();
      remainingTimeout(deadlineAtMs);
      if (!token) throw new Error("Speech credentials unavailable.");
      const result = await fetch("https://speech.googleapis.com/v2/" + request.recognizer + ":recognize", {
        method: "POST", headers: {Authorization: "Bearer " + token, "content-type": "application/json", "x-goog-user-project": this.projectId},
        body: JSON.stringify({config: request.config, content: audioContent.toString("base64")}), signal: deadlineSignal(deadlineAtMs),
      });
      remainingTimeout(deadlineAtMs);
      if (!result.ok) throw new Error("Speech recognition unavailable.");
      response = await result.json() as SpeechRecognitionResponse;
      remainingTimeout(deadlineAtMs);
    } else {
      const client = await this.getClient();
      remainingTimeout(deadlineAtMs);
      [response] = await client.recognize(request, {timeout: remainingTimeout(deadlineAtMs), retry: {retryCodes: []}});
      assertDeadlineActive();
    }

    const transcript = (response.results ?? [])
      .map((result) => result.alternatives?.[0]?.transcript?.trim())
      .filter((part): part is string => Boolean(part))
      .join("\n");

    if (!transcript) {
      throw new Error("Google Cloud Speech-to-Text API returned an empty transcript.");
    }

    const languageCode = (response.results ?? [])
      .find((result) => result.languageCode)
      ?.languageCode ?? undefined;

    return {text: transcript, languageCode};
  }

  private async getClient(): Promise<SpeechRecognitionClient> {
    if (!this.client) {
      const {v2} = await import("@google-cloud/speech");
      this.client = new v2.SpeechClient();
    }

    return this.client;
  }
}

export class LineMessagingApiContentLoader implements AudioContentLoader {
  private client: MessagingContentClient | undefined;

  public constructor(
    private readonly channelAccessToken: string,
    client?: MessagingContentClient,
  ) {
    this.client = client;
  }

  public async getMessageContent(messageId: string, maxBytes: number, deadlineAtMs?: number): Promise<Buffer> {
    let stream: MessageContentStream;
    if (deadlineAtMs !== undefined && !this.client) {
      remainingTimeout(deadlineAtMs);
      const response = await fetch("https://api-data.line.me/v2/bot/message/" + encodeURIComponent(messageId) + "/content",
        {headers: {Authorization: "Bearer " + this.channelAccessToken}, signal: deadlineSignal(deadlineAtMs)});
      remainingTimeout(deadlineAtMs);
      if (!response.ok || !response.body) throw new Error("LINE audio content unavailable.");
      const {Readable} = await import("node:stream");
      remainingTimeout(deadlineAtMs);
      stream = Readable.fromWeb(response.body as never);
    } else {
      const client = await this.getClient();
      const get = async () => {
        if (deadlineAtMs !== undefined) remainingTimeout(deadlineAtMs);
        const acquired = await client.getMessageContent(messageId);
        try {if (deadlineAtMs !== undefined) remainingTimeout(deadlineAtMs); assertDeadlineActive();}
        catch (error) {acquired.destroy?.(); throw error;}
        return acquired;
      };
      stream = deadlineAtMs === undefined ? await get() : await withinTime(get, remainingTimeout(deadlineAtMs));
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const signal = deadlineAtMs === undefined ? undefined : deadlineSignal(deadlineAtMs);
    const destroy = () => {stream.destroy?.();};
    signal?.addEventListener("abort", destroy, {once: true});
    try {
    for await (const chunk of stream) {
      if (deadlineAtMs !== undefined) remainingTimeout(deadlineAtMs);
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        stream.destroy?.();
        throw new ContentLimitError("audio_too_large", `LINE audio content exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(buffer);
    }

    if (totalBytes === 0) {
      throw new Error("LINE Messaging API returned empty audio content.");
    }

    if (deadlineAtMs !== undefined) remainingTimeout(deadlineAtMs);
    return Buffer.concat(chunks, totalBytes);
    } finally {signal?.removeEventListener("abort", destroy); if (signal?.aborted) destroy();}
  }

  private async getClient(): Promise<MessagingContentClient> {
    if (!this.client) {
      const {messagingApi} = await import("@line/bot-sdk");
      this.client = new messagingApi.MessagingApiBlobClient({
        channelAccessToken: this.channelAccessToken,
      });
    }

    return this.client;
  }
}

export class LineMessagingApiReplier implements LineReplier {
  readonly supportsReplyObserver = true;
  private client: MessagingClient | undefined;
  private readonly verifier: GroupMemberVerifier;

  public constructor(private readonly channelAccessToken: string, client?: MessagingClient,
    verifier?: GroupMemberVerifier) {
    this.client = client;
    this.verifier = verifier ?? new LineGroupMemberVerifier(channelAccessToken);
  }

  public async replyText(replyToken: string, text: string, context?: MentionReplyContext, deadlineAtMs?: number, observer?: LineReplyObserver): Promise<void> {
    const plainMessages = buildReplyMessages(text);
    let mentions = context?.mentions.slice(0, 20) ?? [];
    if (mentions.length && context) {
      const userIds = [...new Set(mentions.map((mention) => mention.userId))];
      const checks = await Promise.allSettled(userIds.map((userId) =>
        deadlineAtMs === undefined ? this.verifier.isMember(context.groupId, userId) :
          withinTime(() => this.verifier.isMember(context.groupId, userId), remainingTimeout(deadlineAtMs, 3000))));
      const members = new Set(userIds.filter((_, index) =>
        checks[index]?.status === "fulfilled" && checks[index].value === true));
      mentions = mentions.filter((mention) => members.has(mention.userId));
    }
    const messages = buildReplyMessages(text, mentions);
    let client: MessagingClient;
    if (deadlineAtMs !== undefined && !this.client) {
      client = {replyMessage: async request => {
        const response = await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST", headers: {Authorization: "Bearer " + this.channelAccessToken, "content-type": "application/json"},
          body: JSON.stringify(request), signal: deadlineSignal(deadlineAtMs),
        });
        remainingTimeout(deadlineAtMs);
        if (!response.ok) throw Object.assign(new Error("LINE request rejected."), {status: response.status});
        const body = await response.json(); remainingTimeout(deadlineAtMs); return body;
      }};
    } else {client = await this.getClient(); assertDeadlineActive();}
    const send = async (payload: typeof messages) => {
      if (deadlineAtMs !== undefined) remainingTimeout(deadlineAtMs);
      await observer?.prepare(payload);
      if (deadlineAtMs !== undefined) remainingTimeout(deadlineAtMs);
      let result: unknown;
      try {result = await client.replyMessage({replyToken, messages: payload});}
      catch (error) {
        const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
        await observer?.complete({status: status >= 400 && status < 500 ? "rejected" : "unknown"}); throw error;
      }
      const sent = result && typeof result === "object" && "sentMessages" in result && Array.isArray(result.sentMessages) ? result.sentMessages : [];
      await observer?.complete({status: "accepted", messageIds: sent.map(row => row?.id).filter((id): id is string => typeof id === "string")});
    };
    try {
      await send(messages);
    } catch (error: unknown) {
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      // Only a definite rejected request is safe to retry. Never retry a timeout or 5xx.
      if (status === 400 && messages.some((message) => message.type === "textV2")) {
        try {await send(plainMessages); return;} catch { /* sanitize below */ }
      }
      if (error instanceof Error && ["ArchivePersistenceError", "ArchiveRedactedError"].includes(error.name)) throw error;
      throw new Error("LINE reply could not be delivered.");
    }
  }

  private async getClient(): Promise<MessagingClient> {
    if (!this.client) {
      const {messagingApi} = await import("@line/bot-sdk");
      this.client = new messagingApi.MessagingApiClient({channelAccessToken: this.channelAccessToken});
    }
    return this.client;
  }
}
