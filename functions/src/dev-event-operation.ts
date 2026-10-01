import {createHash, randomUUID} from "node:crypto";
import type {NmtBudgetCategory} from "./nmt-budget.js";
import type {ControlledNmtRequest} from "./nmt-isolation.js";

export const DEV_OPERATIONS_COLLECTION = "lineDevEventOperations";
export const DEV_OPERATION_VERSION = "dev-operation-a1";
export type ProviderStatus = "not_started" | "provider_started" | "provider_succeeded" | "service_error" | "provider_unknown";
export type DeliveryStatus = "not_attempted" | "delivery_started" | "sent" | "delivery_unknown";
export interface OperationTelemetry {
  origin: "runtime"; revision: string | null; adapterVersion: string | null; protectionVersion: string | null; pricingVersion: string;
  engine: string | null; sourceLanguageCode: string | null; targetLanguageCode: string | null; glossary: string | null;
  apiCalled: boolean | "unknown"; sourceCharacters: number; reservedCharacters: number; wireCharacters: number;
  primaryTextWire: number; primaryMarkup: number; auxiliaryWire: number; outputCharacters: number;
  protectedCounts: Record<string, number>; reason: string | null; failureStage: string | null; durations: Record<string, number>;
}
export interface DevEventOperation {
  schemaVersion: 1; version: typeof DEV_OPERATION_VERSION; operationId: string; groupKey: string | null;
  deduplication: "available" | "unavailable"; ownerAttempt: string; fence: 1;
  claimedAt: string; updatedAt: string; completedAt: string | null;
  providerStatus: ProviderStatus; translationStatus: "pending" | "skipped" | "validated" | "quality_rejected" | "service_error";
  deliveryStatus: DeliveryStatus; telemetry: OperationTelemetry;
}
export interface OperationOwner {operationId: string; ownerAttempt: string; fence: 1}
export interface DevEventOperationStore {
  claim(event: unknown): Promise<DevEventSession | null>;
  reserveProvider(owner: OperationOwner, category: NmtBudgetCategory, characters: number, telemetry: OperationTelemetry): Promise<void>;
  update(owner: OperationOwner, patch: Partial<Pick<DevEventOperation, "providerStatus" | "translationStatus" | "deliveryStatus" | "completedAt">>, telemetry: OperationTelemetry): Promise<void>;
}
export function operationIdentity(event: unknown): {operationId: string; groupKey: string | null; deduplication: "available" | "unavailable"; sourceCharacters: number} {
  const value = event as {webhookEventId?: unknown; source?: {type?: string; groupId?: unknown}; message?: {id?: unknown; text?: unknown}} | null;
  const group = value?.source?.type === "group" && typeof value.source.groupId === "string" && value.source.groupId ? value.source.groupId : null;
  const id = typeof value?.webhookEventId === "string" && value.webhookEventId ? ["event", value.webhookEventId]
    : group && typeof value?.message?.id === "string" && value.message.id ? ["message", group, value.message.id] : null;
  const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return {operationId: id ? hash(id) : randomUUID(), groupKey: group ? hash([group]) : null,
    deduplication: id ? "available" : "unavailable", sourceCharacters: typeof value?.message?.text === "string" ? [...value.message.text].length : 0};
}
export function initialOperation(event: unknown, revision: string | null = null): DevEventOperation {
  const now = new Date().toISOString();
  const {sourceCharacters, ...identity} = operationIdentity(event);
  return {schemaVersion: 1, version: DEV_OPERATION_VERSION, ...identity, ownerAttempt: randomUUID(), fence: 1,
    claimedAt: now, updatedAt: now, completedAt: null, providerStatus: "not_started", translationStatus: "pending", deliveryStatus: "not_attempted",
    telemetry: {origin: "runtime", revision, adapterVersion: null, protectionVersion: null, pricingVersion: "google-nmt-usd20-per-million-20260930",
      engine: null, sourceLanguageCode: null, targetLanguageCode: null, glossary: null, apiCalled: false,
      sourceCharacters, reservedCharacters: 0, wireCharacters: 0, primaryTextWire: 0, primaryMarkup: 0, auxiliaryWire: 0, outputCharacters: 0,
      protectedCounts: {}, reason: null, failureStage: null, durations: {}}};
}
// Only fixed schema fields are persisted. Neither event bodies nor arbitrary callback/error objects enter the store.
export function operationData(record: DevEventOperation): DevEventOperation {
  const {schemaVersion, version, operationId, groupKey, deduplication, ownerAttempt, fence, claimedAt, updatedAt, completedAt,
    providerStatus, translationStatus, deliveryStatus} = record;
  const t = record.telemetry;
  return {schemaVersion, version, operationId, groupKey, deduplication, ownerAttempt, fence, claimedAt, updatedAt, completedAt,
    providerStatus, translationStatus, deliveryStatus, telemetry: {origin: t.origin, revision: t.revision, adapterVersion: t.adapterVersion,
      protectionVersion: t.protectionVersion, pricingVersion: t.pricingVersion, engine: t.engine, sourceLanguageCode: t.sourceLanguageCode,
      targetLanguageCode: t.targetLanguageCode, glossary: t.glossary, apiCalled: t.apiCalled, sourceCharacters: t.sourceCharacters,
      reservedCharacters: t.reservedCharacters, wireCharacters: t.wireCharacters, primaryTextWire: t.primaryTextWire,
      primaryMarkup: t.primaryMarkup, auxiliaryWire: t.auxiliaryWire, outputCharacters: t.outputCharacters, protectedCounts: {...t.protectedCounts}, reason: t.reason,
      failureStage: t.failureStage, durations: {...t.durations}}};
}
export class DevEventSession {
  public readonly telemetry: OperationTelemetry;
  public providerStatus: ProviderStatus = "not_started";
  public deliveryStatus: DeliveryStatus = "not_attempted";
  public translationStatus: DevEventOperation["translationStatus"] = "pending";
  private readonly started: number;
  public constructor(private readonly store: DevEventOperationStore, public readonly owner: OperationOwner, record: DevEventOperation) {
    this.started = Date.parse(record.claimedAt);
    this.telemetry = structuredClone(record.telemetry);
  }
  public get operationId(): string {return this.owner.operationId;}
  public duration(stage: string, elapsed: number): void {this.telemetry.durations[stage] = (this.telemetry.durations[stage] ?? 0) + Math.max(0, elapsed);}
  public async timed<T>(stage: string, run: () => Promise<T>): Promise<T> {const start = Date.now(); try {return await run();} finally {this.duration(stage, Date.now() - start);}}
  public prepare(request: ControlledNmtRequest): void {
    const contents = request.contents, primary = request.glossaryConfig ? contents[0] ?? "" : contents.join("");
    const markup = request.mimeType === "text/html" ? [...primary.matchAll(/<[^>]*>/gu)].reduce((sum, item) => sum + [...item[0]].length, 0) : 0;
    Object.assign(this.telemetry, {engine: request.glossaryConfig ? "nmt-glossary" : "general/nmt", sourceLanguageCode: request.sourceLanguageCode,
      targetLanguageCode: request.targetLanguageCode, glossary: request.glossaryConfig?.glossary ?? null,
      wireCharacters: contents.reduce((sum, item) => sum + [...item].length, 0), primaryTextWire: [...primary].length - markup,
      primaryMarkup: markup, auxiliaryWire: request.glossaryConfig ? contents.slice(1).reduce((sum, item) => sum + [...item].length, 0) : 0});
  }
  public async reserveProvider(category: NmtBudgetCategory, characters: number): Promise<void> {
    const next = {...this.telemetry, reservedCharacters: characters, apiCalled: "unknown" as const};
    await this.timed("ledger", () => this.store.reserveProvider(this.owner, category, characters, next));
    Object.assign(this.telemetry, next); this.providerStatus = "provider_started";
  }
  public async providerFinished(outputCharacters: number): Promise<void> {
    Object.assign(this.telemetry, {apiCalled: true, outputCharacters});
    // The provider response is already known, independently of the following control write.
    this.providerStatus = "provider_succeeded";
    await this.store.update(this.owner, {providerStatus: "provider_succeeded"}, this.telemetry);
  }
  public async providerServiceError(): Promise<void> {
    this.telemetry.apiCalled = true; this.providerStatus = "service_error";
    await this.store.update(this.owner, {providerStatus: "service_error"}, this.telemetry);
  }
  public async providerUnknown(): Promise<void> {
    this.telemetry.apiCalled = "unknown"; this.providerStatus = "provider_unknown";
    await this.store.update(this.owner, {providerStatus: "provider_unknown"}, this.telemetry);
  }
  public async translation(status: DevEventOperation["translationStatus"]): Promise<void> {await this.store.update(this.owner, {translationStatus: status}, this.telemetry); this.translationStatus = status;}
  public async deliver(run: () => Promise<void>): Promise<void> {
    try {await this.store.update(this.owner, {deliveryStatus: "delivery_started"}, this.telemetry);}
    catch (error) {this.telemetry.failureStage = "delivery_start"; this.telemetry.reason = "operation_store_error"; throw error;}
    this.deliveryStatus = "delivery_started";
    try {await this.timed("line", run);} catch (error) {
      this.deliveryStatus = "delivery_unknown"; this.telemetry.failureStage = "line"; this.telemetry.reason = "line_reply_error";
      try {await this.store.update(this.owner, {deliveryStatus: "delivery_unknown"}, this.telemetry);} catch { /* Durable started already prevents another send. */ }
      throw error;
    }
    this.deliveryStatus = "sent";
    // An accepted reply must never cause a compensating error reply when completion persistence fails.
    try {await this.store.update(this.owner, {deliveryStatus: "sent"}, this.telemetry);} catch {this.deliveryStatus = "delivery_unknown"; this.telemetry.failureStage = "delivery_completion"; this.telemetry.reason = "operation_store_error";}
  }
  public async complete(): Promise<void> {
    this.duration("total", Date.now() - this.started);
    await this.store.update(this.owner, {completedAt: new Date().toISOString()}, this.telemetry);
  }
}
