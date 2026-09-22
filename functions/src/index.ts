import {logger} from "firebase-functions";
import {defineInt, defineSecret, defineString, projectID} from "firebase-functions/params";
import {onRequest} from "firebase-functions/v2/https";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {
  FirestoreConversationSettingsStore,
  GoogleCloudSpeechTranscriber,
  LineMessagingApiReplier,
  LineMessagingApiContentLoader,
} from "./services.js";
import {processLineWebhook} from "./webhook.js";
import {createTranslator} from "./translator-factory.js";
import {DEFAULT_PROTECTED_NAMES} from "./trade-policy.js";
import {parseMentionAliases, type MentionAlias} from "./mentions.js";

const lineChannelSecret = defineSecret("LINE_CHANNEL_SECRET");
const lineChannelAccessToken = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
const lineOwnerUserId = defineSecret("LINE_OWNER_USER_ID");
const maxMessageLength = defineInt("MAX_MESSAGE_LENGTH", {default: 2_000});
const maxAudioDurationMs = defineInt("MAX_AUDIO_DURATION_MS", {default: 59_000});
const maxAudioBytes = defineInt("MAX_AUDIO_BYTES", {default: 10_000_000});

const mentionAliases = defineString("LINE_MENTION_ALIASES_JSON", {default: "[]"});

const translationEngine = defineString("TRANSLATION_ENGINE", {default: "business"});
const translationModel = defineString("TRANSLATION_MODEL", {default: "gemini-3.5-flash"});
const translationLocation = defineString("TRANSLATION_LOCATION", {default: "global"});
const protectedNames = defineString("TRADE_PROTECTED_NAMES", {default: DEFAULT_PROTECTED_NAMES.join(",")});

const firebaseApp = getApps()[0] ?? initializeApp();
const conversationSettingsStore = new FirestoreConversationSettingsStore(getFirestore(firebaseApp));

export const lineWebhook = onRequest(
  {
    region: "asia-east1",
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 5,
    serviceAccount:
      "line-translator-runtime@line-auto-translate-bot.iam.gserviceaccount.com",
    secrets: [lineChannelSecret, lineChannelAccessToken, lineOwnerUserId],
  },
  async (request, response) => {
    let aliases: MentionAlias[] = [];
    try { aliases = parseMentionAliases(mentionAliases.value()); } catch {
      logger.warn("LINE mention aliases are disabled because configuration is invalid.");
    }
    const signatureHeader = request.header("x-line-signature");
    const result = await processLineWebhook(
      {
        method: request.method,
        rawBody: request.rawBody,
        signature: signatureHeader,
      },
      {
        channelSecret: lineChannelSecret.value(),
        translator: createTranslator({
          engine: translationEngine.value(),
          projectId: projectID.value(),
          model: translationModel.value(),
          location: translationLocation.value(),
          protectedNames: protectedNames.value(),
          onValidationRetry: (reason) => logger.warn("Retrying trade translation validation.", {reason}),
        }),
        transcriber: new GoogleCloudSpeechTranscriber(projectID.value()),
        audioContentLoader: new LineMessagingApiContentLoader(
          lineChannelAccessToken.value(),
        ),
        replier: new LineMessagingApiReplier(lineChannelAccessToken.value()),
        mentionAliases: aliases,
        settingsStore: conversationSettingsStore,
        ownerUserId: lineOwnerUserId.value(),
        logger,
        maxMessageLength: maxMessageLength.value(),
        maxAudioDurationMs: maxAudioDurationMs.value(),
        maxAudioBytes: maxAudioBytes.value(),
      },
    );

    if (result.status === 405) {
      response.set("Allow", "POST");
    }

    response.status(result.status).json(result.body);
  },
);

