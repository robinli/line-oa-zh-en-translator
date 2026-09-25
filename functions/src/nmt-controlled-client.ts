import {nmtFailure, nmtDiagnosticStep, type NmtFailureStage, type NmtFailureDiagnostic} from "./nmt-diagnostics.js";
import {GoogleAuth} from "google-auth-library";
import {countNmtCharacters, type BudgetStore, type NmtBudgetCategory} from "./nmt-budget.js";
import {assertNmtIdentity, assertNmtRequest, NMT_TEST_PROJECT, NMT_RUNTIME_ACCOUNT, type ControlledNmtRequest, type NmtIdentity} from "./nmt-isolation.js";
export interface NmtResponse {translations?: Array<{translatedText?: string | null}> | null; glossaryTranslations?: Array<{translatedText?: string | null}> | null}
export interface NmtCallOptions {timeout: number; retry: {retryCodes: number[]}}
export interface NmtTransport {translateText(request: ControlledNmtRequest, options: NmtCallOptions): Promise<[NmtResponse, ...unknown[]]>}
export class ControlledNmtClient implements NmtTransport {
  public constructor(private readonly transport: NmtTransport, private readonly budget: BudgetStore,
    private readonly category: NmtBudgetCategory, private readonly identity: () => Promise<NmtIdentity>, private readonly runtime = false) {}
  public async translateText(request: ControlledNmtRequest, options: NmtCallOptions): Promise<[NmtResponse, ...unknown[]]> {
    let stage: NmtFailureStage = "request_validation";
    let reservation: NmtFailureDiagnostic["reservation"] = "not_started";
    let provider: NmtFailureDiagnostic["provider"] = "not_started";
    try {
      // Snapshot caller input before asynchronous identity/reservation to prevent mutation after counting.
      const frozen = structuredClone(request);
      assertNmtRequest(frozen);
      if (options.timeout !== 15000 || options.retry.retryCodes.length) throw new Error("NMT retry/timeout mismatch");
      const characters = countNmtCharacters(frozen.contents);
      if (characters <= 0 || characters > 30000) throw new Error("Invalid NMT input size");
      stage = "identity";
      const identity = await this.identity();
      stage = "identity.validation";
      assertNmtIdentity(identity, this.runtime);
      stage = "reservation";
      reservation = "not_confirmed";
      await this.budget.reserve(this.category, characters);
      reservation = "committed";
      stage = "provider";
      provider = "transport_started";
      // Reservation commits first. Every provider failure consumes budget, without retry or refund.
      return await this.transport.translateText(frozen, {timeout: 15000, retry: {retryCodes: []}});
    } catch (error) {throw nmtFailure(error, stage, {reservation, provider});}
  }
}
export class AuthenticatedNmtTransport implements NmtTransport {
  public constructor(private readonly auth: Pick<GoogleAuth, "getAccessToken" | "getCredentials" | "getProjectId"> = new GoogleAuth({projectId: NMT_TEST_PROJECT, scopes: ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/userinfo.email"]})) {}
  private async json(url: string, token: string, stage: NmtFailureStage) {
    return nmtDiagnosticStep(stage, async () => {
      // getAccessToken() does not attach ADC quota metadata to native fetch.
      // Project-aware identity APIs must use the same fixed isolated consumer
      // as translation; never infer it from environment overrides or a response.
      const headers: Record<string, string> = {Authorization: "Bearer " + token};
      if (stage === "identity.billing" || stage === "identity.runtime_account") headers["x-goog-user-project"] = NMT_TEST_PROJECT;
      const response = await fetch(url, {headers, signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw nmtFailure({status: response.status}, stage);
      return await response.json() as Record<string, unknown>;
    });
  }
  public async identity(): Promise<NmtIdentity> {
    const {token, credentials} = await nmtDiagnosticStep("identity.credentials", async () => {
      const token = await this.auth.getAccessToken();
      if (!token) throw new Error("NMT credentials unavailable");
      return {token, credentials: await this.auth.getCredentials()};
    });
    const info = await this.json("https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=" + encodeURIComponent(token), token, "identity.token_info");
    const billing = await this.json("https://cloudbilling.googleapis.com/v1/projects/" + NMT_TEST_PROJECT + "/billingInfo", token, "identity.billing");
    const account = await this.json("https://iam.googleapis.com/v1/projects/" + NMT_TEST_PROJECT + "/serviceAccounts/" + NMT_RUNTIME_ACCOUNT, token, "identity.runtime_account");
    return {projectId: await nmtDiagnosticStep("identity.project", () => this.auth.getProjectId()), principal: String(info.email ?? credentials.client_email ?? ""),
      billingAccount: String(billing.billingAccountName ?? ""), billingEnabled: billing.billingEnabled === true,
      runtimeAccount: account.disabled === true ? "" : String(account.email ?? "")};
  }
  public async translateText(request: ControlledNmtRequest, options: NmtCallOptions): Promise<[NmtResponse]> {
    return nmtDiagnosticStep("provider", async () => {
      const token = await nmtDiagnosticStep("provider.credentials", () => this.auth.getAccessToken());
      if (!token) throw nmtFailure(undefined, "provider.credentials");
      const {parent, ...body} = request;
      const response = await fetch("https://translation.googleapis.com/v3/" + parent + ":translateText", {method: "POST",
        headers: {Authorization: "Bearer " + token, "content-type": "application/json", "x-goog-user-project": NMT_TEST_PROJECT},
        body: JSON.stringify(body), signal: AbortSignal.timeout(options.timeout)});
      if (!response.ok) throw nmtFailure({status: response.status}, "provider");
      return [await response.json() as NmtResponse];
    });
  }
}
