import {logger} from "firebase-functions";
import {defineInt, defineSecret, projectID} from "firebase-functions/params";
import {onRequest} from "firebase-functions/v2/https";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {
  FirestoreConversationSettingsStore,
  GoogleCloudSpeechTranscriber,
  LineMessagingApiReplier,
  LineMessagingApiContentLoader,
  GoogleCloudTranslator,
} from "./services.js";
import {processLineWebhook} from "./webhook.js";

const lineChannelSecret = defineSecret("LINE_CHANNEL_SECRET");
const lineChannelAccessToken = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
const lineOwnerUserId = defineSecret("LINE_OWNER_USER_ID");
const maxMessageLength = defineInt("MAX_MESSAGE_LENGTH", {default: 2_000});
const maxAudioDurationMs = defineInt("MAX_AUDIO_DURATION_MS", {default: 59_000});
const maxAudioBytes = defineInt("MAX_AUDIO_BYTES", {default: 10_000_000});

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
    const signatureHeader = request.header("x-line-signature");
    const result = await processLineWebhook(
      {
        method: request.method,
        rawBody: request.rawBody,
        signature: signatureHeader,
      },
      {
        channelSecret: lineChannelSecret.value(),
        translator: new GoogleCloudTranslator(projectID.value()),
        transcriber: new GoogleCloudSpeechTranscriber(projectID.value()),
        audioContentLoader: new LineMessagingApiContentLoader(
          lineChannelAccessToken.value(),
        ),
        replier: new LineMessagingApiReplier(lineChannelAccessToken.value()),
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

