import type {Firestore} from "firebase-admin/firestore";
import {PRODUCTION_PROJECT, PRODUCTION_OPERATIONS_COLLECTION, isSupportedRuntimeProject} from "./production-target.js";
import {NMT_TEST_PROJECT} from "./nmt-isolation.js";
import {NMT_LEDGER_PATH, NMT_MIGRATION_PATH, validateNmtLedger, validateNmtPolicyHistory, reserveNmtLedger, type NmtBudgetCategory} from "./nmt-budget.js";
import {DEV_OPERATIONS_COLLECTION, DEV_OPERATION_VERSION, initialOperation, operationData, DevEventSession,
  type DevEventOperationStore, type DevEventOperation, type OperationOwner, type OperationTelemetry} from "./dev-event-operation.js";

export function assertOperationOwner(value: unknown, owner: OperationOwner): DevEventOperation {
  const record = value as DevEventOperation | undefined;
  if (!record || record.schemaVersion !== 1 || record.version !== DEV_OPERATION_VERSION || record.operationId !== owner.operationId ||
    record.ownerAttempt !== owner.ownerAttempt || record.fence !== owner.fence || record.completedAt) throw new Error("operation_owner_invalid");
  return record;
}
// A commit acknowledgement can be lost. A later best-effort completion must not erase durable reservation/call uncertainty.
export function completionTelemetry(record: DevEventOperation, telemetry: OperationTelemetry): OperationTelemetry {
  if (record.telemetry.reservedCharacters <= telemetry.reservedCharacters) return telemetry;
  const {reservedCharacters, wireCharacters, primaryTextWire, primaryMarkup, auxiliaryWire, apiCalled, outputCharacters} = record.telemetry;
  return {...telemetry, reservedCharacters, wireCharacters, primaryTextWire, primaryMarkup, auxiliaryWire, apiCalled, outputCharacters};
}
export class FirestoreDevEventOperationStore implements DevEventOperationStore {
  private readonly collection: string;
  constructor(private readonly firestore: Firestore, private readonly projectId: string, private readonly revision: string | null = null) {
    if (!isSupportedRuntimeProject(projectId)) throw new Error("operation_project_mismatch");
    this.collection = projectId === PRODUCTION_PROJECT ? PRODUCTION_OPERATIONS_COLLECTION : DEV_OPERATIONS_COLLECTION;
  }
  async claim(event: unknown): Promise<DevEventSession | null> {
    const record = initialOperation(event, this.revision), ref = this.firestore.collection(this.collection).doc(record.operationId);
    const source = event as {message?: {text?: unknown}};
    record.telemetry.sourceCharacters = typeof source?.message?.text === "string" ? [...source.message.text].length : 0;
    const claimed = await this.firestore.runTransaction(async transaction => {
      if ((await transaction.get(ref)).exists) return false;
      transaction.create(ref, operationData(record)); return true;
    });
    return claimed ? new DevEventSession(this, record, record) : null;
  }
  async reserveProvider(owner: OperationOwner, category: NmtBudgetCategory, characters: number, telemetry: OperationTelemetry): Promise<void> {
    const ref = this.firestore.collection(this.collection).doc(owner.operationId), ledgerRef = this.firestore.doc(NMT_LEDGER_PATH), historyRef = this.firestore.doc(NMT_MIGRATION_PATH);
    if (this.projectId === PRODUCTION_PROJECT) {
      if (!Number.isSafeInteger(characters) || characters <= 0 || characters > 30000) throw new Error("invalid_provider_reservation");
      await this.firestore.runTransaction(async transaction => {
        const record = assertOperationOwner((await transaction.get(ref)).data(), owner);
        if (record.providerStatus !== "not_started" || record.deliveryStatus !== "not_attempted") throw new Error("operation_provider_already_started");
        transaction.set(ref, operationData({...record, updatedAt: new Date().toISOString(), providerStatus: "provider_started", telemetry}));
      });
      return;
    }
    await this.firestore.runTransaction(async transaction => {
      // All reads precede writes, including immutable policy history. Runtime never migrates or resets it.
      const [operation, budget, history] = await transaction.getAll(ref, ledgerRef, historyRef);
      const record = assertOperationOwner(operation!.data(), owner), ledger = validateNmtLedger(budget!.data(), this.projectId);
      if (ledger.version === 2) validateNmtPolicyHistory(history!.data(), ledger);
      if (record.providerStatus !== "not_started" || record.deliveryStatus !== "not_attempted") throw new Error("operation_provider_already_started");
      transaction.update(ledgerRef, {...reserveNmtLedger(ledger, this.projectId, category, characters)});
      transaction.set(ref, operationData({...record, updatedAt: new Date().toISOString(), providerStatus: "provider_started", telemetry}));
    });
  }
  async update(owner: OperationOwner, patch: Parameters<DevEventOperationStore["update"]>[1], telemetry: OperationTelemetry): Promise<void> {
    const ref = this.firestore.collection(this.collection).doc(owner.operationId);
    await this.firestore.runTransaction(async transaction => {
      const record = assertOperationOwner((await transaction.get(ref)).data(), owner);
      if (patch.deliveryStatus === "delivery_started" && record.deliveryStatus !== "not_attempted") throw new Error("operation_delivery_already_started");
      transaction.set(ref, operationData({...record, ...patch, updatedAt: new Date().toISOString(), telemetry: completionTelemetry(record, telemetry)}));
    });
  }
}
