import {resolveNmtRuntimeProfile, type NmtRequestProfile} from "./nmt-request-profile.js";
import {FirestoreDevEventOperationStore} from "./dev-event-operation-store.js";
import type {DevEventSession} from "./dev-event-operation.js";
import {FirestoreTranslationQualityStore} from "./translation-quality-store.js";
import {FirestoreTranslationFailureStore} from "./translation-failure-store.js";
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
const nmtRequestProfile = defineString("NMT_REQUEST_PROFILE", {default: "legacy-glossary"});
const translationModel = defineString("TRANSLATION_MODEL", {default: "gemini-3.5-flash"});
const translationLocation = defineString("TRANSLATION_LOCATION", {default: "global"});
const translationLlmLocation = defineString("TRANSLATION_LLM_LOCATION", {default: "us-central1"});
const translationLlmGlossaryZhEn = defineString("TRANSLATION_LLM_GLOSSARY_ZH_EN", {default: "trade-zh-en-v8"});
const translationLlmGlossaryEnZh = defineString("TRANSLATION_LLM_GLOSSARY_EN_ZH", {default: "trade-en-zh-v8"});
const protectedNames = defineString("TRADE_PROTECTED_NAMES", {default: DEFAULT_PROTECTED_NAMES.join(",")});

const runtimeServiceAccount = defineString("TEST_RUNTIME_SERVICE_ACCOUNT", {default: NMT_RUNTIME_ACCOUNT});

const firebaseApp = getApps()[0] ?? initializeApp();
const translationFailureStore = new FirestoreTranslationFailureStore(getFirestore(firebaseApp));
const conversationSettingsStore = new FirestoreConversationSettingsStore(getFirestore(firebaseApp));

function controlledClient(session?: DevEventSession, profile: NmtRequestProfile = "legacy-glossary") {
  if (projectID.value() !== NMT_TEST_PROJECT || runtimeServiceAccount.value() !== NMT_RUNTIME_ACCOUNT) throw new Error("Isolated NMT runtime target mismatch");
  const transport = new AuthenticatedNmtTransport();
  return new ControlledNmtClient(transport, new FirestoreNmtBudget(getFirestore(firebaseApp), NMT_TEST_PROJECT), "manual", () => transport.identity(), true, session, profile);
}

const eventTranslationProgram = (session: DevEventSession) => createTranslationProgramRouter(() => {
  let aliases: MentionAlias[] = [];
  try { aliases = parseMentionAliases(mentionAliases.value()); } catch {
    logger.warn("LINE mention aliases are disabled because configuration is invalid.");
  }
  const profile = resolveNmtRuntimeProfile(translationEngine.value(), nmtRequestProfile.value());
  const client = controlledClient(session, profile);
  return {
    translator: createTranslator({
      engine: translationEngine.value(),
      projectId: projectID.value(),
      model: translationModel.value(),
      location: translationLocation.value(),
      protectedNames: protectedNames.value(),
      nmtGlossary: {location: "us-central1",
        glossaryZhEn: "projects/" + NMT_TEST_PROJECT + "/locations/us-central1/glossaries/" + NMT_GLOSSARIES.zhEn,
        glossaryEnZh: "projects/" + NMT_TEST_PROJECT + "/locations/us-central1/glossaries/" + NMT_GLOSSARIES.enZh, client},
      ...(profile === "legacy-glossary" ? {} : {nmtDirect: {profile, client}}),
      onNmtDirectMetric: metric => {
        Object.assign(session.telemetry, {engine: metric.engine, adapterVersion: metric.adapterVersion,
          protectionVersion: metric.protectionVersion, requestProfile: metric.profile,
          validationScope: metric.validationScope, semanticEvaluation: metric.semanticEvaluation, protectedCounts: metric.protectedCounts});
        session.duration("validation", Math.max(0, metric.elapsedMs - (session.telemetry.durations.identity ?? 0) - (session.telemetry.durations.ledger ?? 0) - (session.telemetry.durations.provider ?? 0)));
        if (metric.reason) {session.telemetry.reason = metric.reason; session.telemetry.failureStage = "validation";}
        if (metric.apiCalled === false) {session.telemetry.apiCalled = false; session.telemetry.outputCharacters = metric.outputCharacters;}
        logger.info("NMT direct request completed.", {operationId: session.operationId, ...metric});
      },
      onNmtMetric: metric => {
        session.telemetry.adapterVersion = metric.adapterVersion ?? "nmt-glossary-v21";
        session.telemetry.protectedCounts = metric.protectedCounts ?? {};
        session.telemetry.protectionVersion = "literal-code-20260929";
        session.duration("validation", Math.max(0, metric.elapsedMs - (session.telemetry.durations.identity ?? 0) - (session.telemetry.durations.ledger ?? 0) - (session.telemetry.durations.provider ?? 0)));
        if (metric.reason) {session.telemetry.reason = metric.reason; session.telemetry.failureStage = "validation";}
        // The client owns API certainty; a translator service error cannot imply a call.
        if (metric.apiCalled === false) {session.telemetry.apiCalled = false; session.telemetry.outputCharacters = metric.outputCharacters;}
        logger.info("NMT request completed.", {operationId: session.operationId, ...metric});
      },
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
}, () => new VietnameseNmtTranslator(projectID.value(), controlledClient(session), metric => {
  session.telemetry.adapterVersion = metric.adapterVersion;
  session.telemetry.protectionVersion = "literal-code-20260929";
  if (session.providerStatus === "not_started") session.telemetry.outputCharacters = metric.outputCharacters;
  if (metric.outcome === "quality_rejected" && session.providerStatus === "provider_succeeded" && session.telemetry.failureStage !== "provider_completion") {session.telemetry.reason = "nmt_output_validation"; session.telemetry.failureStage = "validation";}
  session.duration("validation", Math.max(0, metric.elapsedMs - (session.telemetry.durations.identity ?? 0) - (session.telemetry.durations.ledger ?? 0) - (session.telemetry.durations.provider ?? 0)));
  logger.info("Vietnamese NMT request completed.", {operationId: session.operationId, ...metric});
}));

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
        eventOperationStore: new FirestoreDevEventOperationStore(getFirestore(firebaseApp), projectID.value(), process.env.K_REVISION ?? null),
        createEventTranslationProgram: eventTranslationProgram,
        transcriber: new GoogleCloudSpeechTranscriber(projectID.value()),
        audioContentLoader: new LineMessagingApiContentLoader(
          lineChannelAccessToken.value(),
        ),
        replier: new LineMessagingApiReplier(lineChannelAccessToken.value()),
        settingsStore: conversationSettingsStore,
        failureStore: translationFailureStore,
        qualityStore: projectID.value() === NMT_TEST_PROJECT ? new FirestoreTranslationQualityStore(getFirestore(firebaseApp), {projectId: projectID.value(), revision: process.env.K_REVISION}) : undefined,
        qualityMetadata: (mode, source) => ({engine: mode === "zh-vi" ? "general/nmt" : translationEngine.value(),
          glossary: mode === "zh-vi" || !source || translationEngine.value() === "nmt-direct" && nmtRequestProfile.value() === "nmt-direct-v1" ? null : source === "zh-TW" ? NMT_GLOSSARIES.zhEn : NMT_GLOSSARIES.enZh,
          revision: process.env.K_REVISION ?? null}),
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

