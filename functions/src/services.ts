export interface Translator {
  translateTraditionalChineseToEnglish(text: string): Promise<string>;
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

