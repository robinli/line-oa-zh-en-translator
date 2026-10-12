import {AsyncLocalStorage} from "node:async_hooks";
// A bounded wait also revokes admission for every continuation in that operation.
export class TranslationDeadlineError extends Error {
  constructor() {super("Translation deadline exceeded."); this.name = "TranslationDeadlineError";}
}
const activeScope = new AsyncLocalStorage<DeadlineScope>();
export class DeadlineScope {
  private readonly controller = new AbortController();
  private closed = false;
  constructor(public readonly deadlineAtMs: number, private readonly parent = activeScope.getStore()) {}
  get signal(): AbortSignal {return this.controller.signal;}
  assertActive(): void {
    this.parent?.assertActive();
    if (this.closed || !Number.isFinite(this.deadlineAtMs) || Date.now() >= this.deadlineAtMs) throw new TranslationDeadlineError();
  }
  close(): void {this.closed = true; this.controller.abort();}
  async run<T>(run: () => Promise<T>): Promise<T> {
    this.assertActive();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        activeScope.run(this, async () => {this.assertActive(); const result = await run(); this.assertActive(); return result;}),
        new Promise<never>((_, reject) => {timer = setTimeout(() => {this.close(); reject(new TranslationDeadlineError());}, this.deadlineAtMs - Date.now());}),
      ]);
    } finally {if (timer) clearTimeout(timer); this.close();}
  }
}
export function assertDeadlineActive(): void {activeScope.getStore()?.assertActive();}
export function currentDeadline(): number | undefined {const scope = activeScope.getStore(); scope?.assertActive(); return scope?.deadlineAtMs;}
export function remainingTimeout(deadlineAtMs?: number, maxMs = 15000): number {
  assertDeadlineActive();
  const end = Math.min(deadlineAtMs ?? Infinity, activeScope.getStore()?.deadlineAtMs ?? Infinity);
  const remaining = Math.min(maxMs, Math.floor(end - Date.now()));
  if (!Number.isFinite(remaining) || remaining <= 0) throw new TranslationDeadlineError();
  return remaining;
}
export function requestTimeout(deadlineAtMs?: number, maxMs = 15000): number {
  return remainingTimeout(deadlineAtMs === undefined ? undefined : deadlineAtMs - 10000, maxMs);
}
export function deadlineSignal(deadlineAtMs?: number, maxMs = 15000): AbortSignal {
  const timeout = AbortSignal.timeout(remainingTimeout(deadlineAtMs, maxMs));
  const scope = activeScope.getStore();
  return scope ? AbortSignal.any([timeout, scope.signal]) : timeout;
}
export function withinTime<T>(run: () => Promise<T>, timeout: number): Promise<T> {
  const end = Date.now() + remainingTimeout(undefined, timeout);
  return new DeadlineScope(end).run(run);
}
// One lifecycle budget covers NMT identity, reservation, transport and completion.
export async function withinNmtRequest<T>(deadlineAtMs: number | undefined, run: (end?: number) => Promise<T>): Promise<T> {
  const startedAt = Date.now(), parentDeadline = currentDeadline();
  if (deadlineAtMs === undefined && parentDeadline === undefined) return run();
  const end = Math.min(startedAt + 15000, deadlineAtMs ?? Infinity, parentDeadline ?? Infinity);
  return new DeadlineScope(end).run(() => run(end));
}
// Firestore cannot retract an admitted commit. Guard each RPC and transaction continuation,
// use one scoped attempt, and snapshot writes so a late commit cannot capture mutable telemetry.
export function deadlineFirestore<T extends object>(firestore: T): T {
  const cache = new WeakMap<object, object>();
  const builders = new Set(["collection", "doc", "where", "limit", "orderBy", "startAfter", "startAt", "endAt", "endBefore", "select"]);
  const writes = new Set(["set", "create", "update", "delete"]);
  const wrap = (target: object, transaction = false): object => {
    const previous = cache.get(target); if (previous) return previous;
    const proxy = new Proxy(target, {get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const scope = activeScope.getStore(); scope?.assertActive();
        if (property === "runTransaction") {
          const callback = args[0] as (transaction: object) => Promise<unknown>;
          const options = scope ? {...args[1] as object, maxAttempts: 1} : args[1];
          const result = value.call(object, async (tx: object) => {
            const run = async () => {scope?.assertActive(); const result = await callback(wrap(tx, true)); scope?.assertActive(); return result;};
            return scope ? activeScope.run(scope, run) : run();
          }, options);
          return Promise.resolve(result).then(result => {scope?.assertActive(); return result;});
        }
        if (writes.has(String(property))) {
          const index = transaction ? 1 : 0;
          if (args[index] && typeof args[index] === "object") args[index] = structuredClone(args[index]);
        }
        const result = value.apply(object, args);
        if (builders.has(String(property)) && result && typeof result === "object") return wrap(result);
        if (result && typeof result.then === "function") return Promise.resolve(result).then(result => {scope?.assertActive(); return result;});
        return result;
      };
    }});
    cache.set(target, proxy); return proxy;
  };
  return wrap(firestore) as T;
}
