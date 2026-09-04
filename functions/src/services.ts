export interface Translator {
  translateTraditionalChineseToEnglish(text: string): Promise<string>;
}

export interface AudioTranscriber {
  transcribe(audioContent: Buffer): Promise<string>;
}

export interface AudioContentLoader {
  getMessageContent(messageId: string, maxBytes: number): Promise<Buffer>;
}

export interface LineReplier {
  replyText(replyToken: string, text: string): Promise<void>;
}

export interface GroupActivationStore {
  isEnabled(groupId: string): Promise<boolean>;
  setEnabled(groupId: string, enabled: boolean, changedBy: string): Promise<void>;
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

export class FirestoreGroupActivationStore implements GroupActivationStore {
  public constructor(private readonly firestore: FirestoreClient) {}

  public async isEnabled(groupId: string): Promise<boolean> {
    const snapshot = await this.groupDocument(groupId).get();
    return snapshot.get("enabled") === true;
  }

  public async setEnabled(groupId: string, enabled: boolean, changedBy: string): Promise<void> {
    await this.groupDocument(groupId).set(
      {
        enabled,
        changedBy,
        changedAt: new Date(),
      },
      {merge: true},
    );
  }

  private groupDocument(groupId: string): FirestoreDocumentReference {
    return this.firestore.collection("lineTranslationGroups").doc(groupId);
  }
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
    messages: Array<{type: "text"; text: string}>;
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
    alternatives?: Array<{
      transcript?: string | null;
    }> | null;
  }> | null;
}

interface SpeechRecognitionClient {
  recognize(request: SpeechRecognitionRequest): Promise<[
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

  public async translateTraditionalChineseToEnglish(text: string): Promise<string> {
    const client = await this.getClient();
    const [response] = await client.translateText({
      parent: `projects/${this.projectId}/locations/global`,
      contents: [text],
      mimeType: "text/plain",
      sourceLanguageCode: "zh-TW",
      targetLanguageCode: "en",
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

  public async transcribe(audioContent: Buffer): Promise<string> {
    const client = await this.getClient();
    const [response] = await client.recognize({
      recognizer: `projects/${this.projectId}/locations/global/recognizers/_`,
      config: {
        autoDecodingConfig: {},
        languageCodes: ["cmn-Hant-TW", "en-US"],
        model: "long",
        features: {
          enableAutomaticPunctuation: true,
        },
      },
      content: audioContent,
    });

    const transcript = (response.results ?? [])
      .map((result) => result.alternatives?.[0]?.transcript?.trim())
      .filter((part): part is string => Boolean(part))
      .join("\n");

    if (!transcript) {
      throw new Error("Google Cloud Speech-to-Text API returned an empty transcript.");
    }

    return transcript;
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

  public async getMessageContent(messageId: string, maxBytes: number): Promise<Buffer> {
    const client = await this.getClient();
    const stream = await client.getMessageContent(messageId);
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        stream.destroy?.();
        throw new Error(`LINE audio content exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(buffer);
    }

    if (totalBytes === 0) {
      throw new Error("LINE Messaging API returned empty audio content.");
    }

    return Buffer.concat(chunks, totalBytes);
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
  private client: MessagingClient | undefined;

  public constructor(
    private readonly channelAccessToken: string,
    client?: MessagingClient,
  ) {
    this.client = client;
  }

  public async replyText(replyToken: string, text: string): Promise<void> {
    const client = await this.getClient();
    await client.replyMessage({
      replyToken,
      messages: [{type: "text", text}],
    });
  }

  private async getClient(): Promise<MessagingClient> {
    if (!this.client) {
      const {messagingApi} = await import("@line/bot-sdk");
      this.client = new messagingApi.MessagingApiClient({
        channelAccessToken: this.channelAccessToken,
      });
    }

    return this.client;
  }
}

