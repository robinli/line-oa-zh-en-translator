export type NmtFailureStage = "request_validation" | "identity" | "identity.credentials" | "identity.token_info" | "identity.billing" | "identity.runtime_account" | "identity.project" | "identity.validation" | "reservation" | "provider.credentials" | "provider";
export interface NmtFailureDiagnostic {
 stage: NmtFailureStage; category: "authentication" | "permission" | "timeout" | "unavailable" | "budget" | "guard" | "unknown";
 code?: string | number; httpStatus?: number;
 reservation: "not_started" | "not_confirmed" | "committed";
 provider: "not_started" | "transport_started";
}
const codes = new Set(["UNAUTHENTICATED", "PERMISSION_DENIED", "DEADLINE_EXCEEDED", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"]);
export class NmtOperationError extends Error {
 public constructor(public readonly diagnostic: Readonly<NmtFailureDiagnostic>) {
  super("NMT operation failed at " + diagnostic.stage);
  this.name = "NmtOperationError";
 }
}
// Never retain error messages, URLs, bodies, headers, credentials, or a raw cause.
export function nmtFailure(error: unknown, stage: NmtFailureStage, progress?: Pick<NmtFailureDiagnostic, "reservation" | "provider">): NmtOperationError {
 if (error instanceof NmtOperationError) return new NmtOperationError({...error.diagnostic, ...progress});
 const value = error as {code?: unknown; status?: unknown; response?: {status?: unknown}; name?: unknown; message?: unknown} | undefined;
 const status = value?.response?.status ?? value?.status;
 const httpStatus = typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
 const rawCode = value?.code;
 let code = typeof rawCode === "number" && Number.isInteger(rawCode) && rawCode >= 1 && rawCode <= 16 || typeof rawCode === "string" && codes.has(rawCode) ? rawCode as string | number : undefined;
 if (value?.message === "NMT budget exhausted") code = "BUDGET_EXHAUSTED";
 if (value?.message === "NMT ledger invalid") code = "LEDGER_INVALID";
 const category = httpStatus === 401 || code === 16 || code === "UNAUTHENTICATED" ? "authentication"
  : httpStatus === 403 || code === 7 || code === "PERMISSION_DENIED" ? "permission"
  : value?.name === "TimeoutError" || value?.name === "AbortError" || code === 4 || code === "DEADLINE_EXCEEDED" || code === "ETIMEDOUT" ? "timeout"
  : httpStatus && httpStatus >= 500 || code === 14 || ["UNAVAILABLE", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND"].includes(String(code)) ? "unavailable"
  : code === "BUDGET_EXHAUSTED" || code === "LEDGER_INVALID" ? "budget"
  : stage === "request_validation" || stage === "identity.validation" ? "guard" : "unknown";
 return new NmtOperationError({stage, category, ...(code === undefined ? {} : {code}), ...(httpStatus === undefined ? {} : {httpStatus}), reservation: "not_started", provider: "not_started", ...progress});
}
export async function nmtDiagnosticStep<T>(stage: NmtFailureStage, run: () => Promise<T>): Promise<T> {
 try {return await run();} catch (error) {throw nmtFailure(error, stage);}
}
