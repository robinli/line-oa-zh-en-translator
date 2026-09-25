import {ControlledNmtClient, AuthenticatedNmtTransport} from "./nmt-controlled-client.js";
import {FirestoreNmtBudget} from "./nmt-budget.js";
import {NMT_TEST_PROJECT, NMT_RUNTIME_ACCOUNT, NMT_GLOSSARIES} from "./nmt-isolation.js";
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
import {createTranslationProgramRouter} from "./translation-program.js";
import {VietnameseNmtTranslator} from "./vietnamese-nmt-translator.js";
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
const translationLlmLocation = defineString("TRANSLATION_LLM_LOCATION", {default: "us-central1"});
const translationLlmGlossaryZhEn = defineString("TRANSLATION_LLM_GLOSSARY_ZH_EN", {default: "trade-zh-en-v8"});
const translationLlmGlossaryEnZh = defineString("TRANSLATION_LLM_GLOSSARY_EN_ZH", {default: "trade-en-zh-v8"});
const protectedNames = defineString("TRADE_PROTECTED_NAMES", {default: DEFAULT_PROTECTED_NAMES.join(",")});

const runtimeServiceAccount = defineString("TEST_RUNTIME_SERVICE_ACCOUNT", {default: NMT_RUNTIME_ACCOUNT});

const firebaseApp = getApps()[0] ?? initializeApp();
const conversationSettingsStore = new FirestoreConversationSettingsStore(getFirestore(firebaseApp));

function controlledClient() {
  if (projectID.value() !== NMT_TEST_PROJECT || runtimeServiceAccount.value() !== NMT_RUNTIME_ACCOUNT) throw new Error("Isolated NMT runtime target mismatch");
  const transport = new AuthenticatedNmtTransport();
  return new ControlledNmtClient(transport, new FirestoreNmtBudget(getFirestore(firebaseApp), NMT_TEST_PROJECT), "manual", () => transport.identity(), true);
}

const getTranslationProgram = createTranslationProgramRouter(() => {
  let aliases: MentionAlias[] = [];
  try { aliases = parseMentionAliases(mentionAliases.value()); } catch {
    logger.warn("LINE mention aliases are disabled because configuration is invalid.");
  }
  if (translationEngine.value() !== "nmt-glossary") throw new Error("Isolated test runtime requires nmt-glossary");
  return {
    translator: createTranslator({
      engine: translationEngine.value(),
      projectId: projectID.value(),
      model: translationModel.value(),
      location: translationLocation.value(),
      protectedNames: protectedNames.value(),
      nmtGlossary: {location: "us-central1",
        glossaryZhEn: "projects/" + NMT_TEST_PROJECT + "/locations/us-central1/glossaries/" + NMT_GLOSSARIES.zhEn,
        glossaryEnZh: "projects/" + NMT_TEST_PROJECT + "/locations/us-central1/glossaries/" + NMT_GLOSSARIES.enZh, client: controlledClient()},
      onNmtMetric: metric => logger.info("NMT request completed.", {...metric}),
      translationLlm: {
        location: translationLlmLocation.value(),
        glossaryZhEn: "projects/" + projectID.value() + "/locations/" + translationLlmLocation.value() + "/glossaries/" + translationLlmGlossaryZhEn.value(),
        glossaryEnZh: "projects/" + projectID.value() + "/locations/" + translationLlmLocation.value() + "/glossaries/" + translationLlmGlossaryEnZh.value(),
      },
      onTranslationMetric: metric => logger.info("Translation LLM request completed.", {...metric}),
      onValidationRetry: (reason) => logger.warn("Retrying trade translation validation.", {reason}),
    }),
    mentionAliases: aliases,
  };
}, () => new VietnameseNmtTranslator(projectID.value(), controlledClient()));

export const lineWebhook = onRequest(
  {
    region: "asia-east1",
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 5,
    serviceAccount:
      runtimeServiceAccount,
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
        getTranslationProgram,
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

