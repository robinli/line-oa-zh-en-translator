import {isDeepStrictEqual} from "node:util";
import type {Firestore} from "firebase-admin/firestore";
import {NMT_TEST_PROJECT} from "./nmt-isolation.js";
export const NMT_LIMITS = {smoke: 5000, regression: 55000, verification: 20000, retest: 10000, manual: 10000} as const;
export type NmtBudgetCategory = keyof typeof NMT_LIMITS;
export type NmtBudgetMode = "capped" | "tracking-only";
export const NMT_TOTAL_LIMIT = 100000;
export const NMT_LEDGER_PATH = "nmtEvaluationBudget/approved-20260924";
export const NMT_TRACKING_MIGRATION = "tracking-only-20260925";
export const NMT_MIGRATION_PATH = NMT_LEDGER_PATH + "/policyHistory/" + NMT_TRACKING_MIGRATION;
interface Counters {projectId: string; used: number; categories: Record<NmtBudgetCategory, number>; reservations: number}
export interface CappedNmtLedger extends Counters {version: 1; limit: 100000; mode?: never; categoryLimits?: never; migrationId?: never}
export interface TrackingNmtLedger extends Counters {version: 2; mode: "tracking-only"; limit: null; categoryLimits: null; migrationId: typeof NMT_TRACKING_MIGRATION}
export type NmtLedger = CappedNmtLedger | TrackingNmtLedger;
export interface NmtPolicyHistory {version: 1; projectId: string; migrationId: typeof NMT_TRACKING_MIGRATION; changedAt: string; before: CappedNmtLedger; after: TrackingNmtLedger}
export interface BudgetStore {reserve(category: NmtBudgetCategory, characters: number): Promise<void>}
export function initialNmtLedger(projectId: string): NmtLedger {
  return {version: 1, projectId, limit: NMT_TOTAL_LIMIT, used: 0, reservations: 0,
    categories: {smoke: 0, regression: 0, verification: 0, retest: 0, manual: 0}};
}
export function validateNmtLedger(value: unknown, projectId: string): NmtLedger {
  const ledger = value as NmtLedger | undefined;
  if (!ledger || ledger.projectId !== projectId || !Number.isSafeInteger(ledger.used) || ledger.used < 0 ||
      !Number.isSafeInteger(ledger.reservations) || ledger.reservations < 0 || !ledger.categories ||
      Object.keys(ledger.categories).sort().join() !== Object.keys(NMT_LIMITS).sort().join()) throw new Error("NMT ledger invalid");
  if (ledger.version === 1) {
    if (ledger.limit !== NMT_TOTAL_LIMIT || ledger.mode !== undefined || ledger.categoryLimits !== undefined || ledger.migrationId !== undefined || ledger.used > NMT_TOTAL_LIMIT) throw new Error("NMT ledger invalid");
  } else if (ledger.version !== 2 || projectId !== NMT_TEST_PROJECT || ledger.mode !== "tracking-only" || ledger.limit !== null || ledger.categoryLimits !== null || ledger.migrationId !== NMT_TRACKING_MIGRATION) throw new Error("NMT ledger invalid");
  let sum = 0;
  for (const key of Object.keys(NMT_LIMITS) as NmtBudgetCategory[]) {
    const used = ledger.categories[key];
    if (!Number.isSafeInteger(used) || used < 0 || ledger.version === 1 && used > NMT_LIMITS[key]) throw new Error("NMT ledger invalid");
    sum += used;
    if (!Number.isSafeInteger(sum)) throw new Error("NMT ledger invalid");
  }
  if (sum !== ledger.used) throw new Error("NMT ledger invalid");
  return ledger;
}
export function normalizeNmtBudgetMode(value: unknown): NmtBudgetMode {
  if (value === undefined || value === "capped") return "capped";
  if (value === "tracking-only") return "tracking-only";
  throw new Error("NMT budget mode invalid");
}
export function nmtBudgetMode(value: unknown, projectId: string): NmtBudgetMode {
  return validateNmtLedger(value, projectId).version === 2 ? "tracking-only" : "capped";
}
export function reserveNmtLedger(value: unknown, projectId: string, category: NmtBudgetCategory, characters: number): NmtLedger {
  const ledger = validateNmtLedger(value, projectId);
  if (!Object.hasOwn(NMT_LIMITS, category) || !Number.isSafeInteger(characters) || characters <= 0 ||
      !Number.isSafeInteger(ledger.used + characters) || !Number.isSafeInteger(ledger.categories[category] + characters) ||
      !Number.isSafeInteger(ledger.reservations + 1)) throw new Error("NMT ledger invalid");
  if (ledger.version === 1 && (ledger.used + characters > NMT_TOTAL_LIMIT || ledger.categories[category] + characters > NMT_LIMITS[category])) throw new Error("NMT budget exhausted");
  return {...ledger, used: ledger.used + characters, reservations: ledger.reservations + 1,
    categories: {...ledger.categories, [category]: ledger.categories[category] + characters}};
}
export function trackingOnlyMigration(value: unknown, projectId: string, changedAt: string): {ledger: TrackingNmtLedger; history: NmtPolicyHistory} {
  const before = validateNmtLedger(value, projectId);
  if (projectId !== NMT_TEST_PROJECT || before.version !== 1 || typeof changedAt !== "string" || !Number.isFinite(Date.parse(changedAt))) throw new Error("NMT tracking migration invalid");
  const ledger: TrackingNmtLedger = {...structuredClone(before), version: 2, mode: "tracking-only", limit: null, categoryLimits: null, migrationId: NMT_TRACKING_MIGRATION};
  return {ledger, history: {version: 1, projectId, migrationId: NMT_TRACKING_MIGRATION, changedAt, before: structuredClone(before), after: structuredClone(ledger)}};
}
export function validateNmtPolicyHistory(value: unknown, ledger: TrackingNmtLedger): NmtPolicyHistory {
  const history = value as NmtPolicyHistory | undefined;
  if (!history || history.version !== 1 || history.projectId !== ledger.projectId || history.migrationId !== NMT_TRACKING_MIGRATION) throw new Error("NMT policy history invalid");
  const expected = trackingOnlyMigration(history.before, ledger.projectId, history.changedAt);
  if (!isDeepStrictEqual(expected.history, history)) throw new Error("NMT policy history invalid");
  if (ledger.used < history.after.used || ledger.reservations < history.after.reservations ||
      (Object.keys(NMT_LIMITS) as NmtBudgetCategory[]).some(key => ledger.categories[key] < history.after.categories[key])) throw new Error("NMT policy history counter regression");
  return history;
}
export async function enableTrackingOnlyBudget(firestore: Firestore, projectId: string, changedAt = new Date().toISOString()): Promise<{changed: boolean; ledger: TrackingNmtLedger; history: NmtPolicyHistory}> {
  if (projectId !== NMT_TEST_PROJECT) throw new Error("NMT tracking migration project mismatch");
  const ref = firestore.doc(NMT_LEDGER_PATH), historyRef = firestore.doc(NMT_MIGRATION_PATH);
  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref), historySnapshot = await transaction.get(historyRef);
    const before = validateNmtLedger(snapshot.data(), projectId);
    if (before.version === 2) return {changed: false, ledger: before, history: validateNmtPolicyHistory(historySnapshot.data(), before)};
    if (historySnapshot.exists) throw new Error("NMT policy history already exists");
    const migration = trackingOnlyMigration(before, projectId, changedAt);
    transaction.create(historyRef, migration.history);
    transaction.update(ref, {...migration.ledger});
    return {changed: true, ...migration};
  });
}
export class FirestoreNmtBudget implements BudgetStore {
  public constructor(private readonly firestore: Firestore, private readonly projectId: string) {}
  public async reserve(category: NmtBudgetCategory, characters: number): Promise<void> {
    const ref = this.firestore.doc(NMT_LEDGER_PATH);
    await this.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref), ledger = validateNmtLedger(snapshot.data(), this.projectId);
      if (ledger.version === 2) validateNmtPolicyHistory((await transaction.get(this.firestore.doc(NMT_MIGRATION_PATH))).data(), ledger);
      // Runtime never initializes, migrates, recreates, refunds, or resets a ledger.
      transaction.update(ref, {...reserveNmtLedger(ledger, this.projectId, category, characters)});
    });
  }
}
export function countNmtCharacters(contents: readonly string[]): number {
  if (!Array.isArray(contents) || !contents.length || contents.some(text => typeof text !== "string")) throw new Error("Invalid NMT contents");
  if (contents.some(text => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))) throw new Error("Invalid NMT Unicode");
  return contents.reduce((sum, text) => sum + [...text].length, 0);
}
