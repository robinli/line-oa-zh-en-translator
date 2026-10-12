import {TranslationDeadlineError, assertDeadlineActive, remainingTimeout, deadlineSignal, withinNmtRequest} from "./translation-deadline.js";
import {GoogleAuth} from "google-auth-library";
import {PRODUCTION_PROJECT, PRODUCTION_RUNTIME_ACCOUNT} from "./production-target.js";
import {assertNmtProfileRequest, type NmtRequestProfile} from "./nmt-request-profile.js";
import {countNmtCharacters} from "./nmt-budget.js";
import {projectNmtOutputContents, type NmtContentObserver} from "./nmt-content-capture.js";
import {nmtFailure, type NmtFailureStage, type NmtFailureDiagnostic} from "./nmt-diagnostics.js";
import type {DevEventSession} from "./dev-event-operation.js";
import type {ControlledNmtRequest} from "./nmt-isolation.js";
import type {NmtTransport, NmtResponse, NmtCallOptions} from "./nmt-controlled-client.js";
export class ProductionNmtClient implements NmtTransport {
  constructor(private readonly session: DevEventSession, private readonly profile: NmtRequestProfile,
    private readonly observer?: NmtContentObserver,
    private readonly auth: Pick<GoogleAuth, "getAccessToken" | "getCredentials" | "getProjectId"> = new GoogleAuth({projectId: PRODUCTION_PROJECT, scopes: ["https://www.googleapis.com/auth/cloud-platform"]})) {}
  async translateText(request: ControlledNmtRequest, options: NmtCallOptions): Promise<[NmtResponse]> {
    return withinNmtRequest(options.requestDeadlineAtMs, end =>
      this.translateCore(request, end === undefined ? options : {...options, requestDeadlineAtMs: end}));
  }
  private async translateCore(request: ControlledNmtRequest, options: NmtCallOptions): Promise<[NmtResponse]> {
    let stage: NmtFailureStage = "request_validation";
    let reservation: NmtFailureDiagnostic["reservation"] = "not_started";
    let provider: NmtFailureDiagnostic["provider"] = "not_started";
    try {
      const frozen = structuredClone(request);
      assertNmtProfileRequest(frozen, this.profile, PRODUCTION_PROJECT);
      if (options.timeout !== 15000 || options.retry.retryCodes.length) throw new Error("NMT retry/timeout mismatch");
      const characters = countNmtCharacters(frozen.contents);
      if (characters <= 0 || characters > 30000) throw new Error("Invalid NMT input size");
      this.session.prepare(frozen, this.profile);
      stage = "identity.validation";
      const token = await this.session.timed("identity", async () => {
        const project = await this.auth.getProjectId(); remainingTimeout(options.requestDeadlineAtMs);
        const credentials = await this.auth.getCredentials(); remainingTimeout(options.requestDeadlineAtMs);
        if (project !== PRODUCTION_PROJECT || credentials.client_email !== PRODUCTION_RUNTIME_ACCOUNT) throw new Error("Production runtime identity mismatch");
        remainingTimeout(options.requestDeadlineAtMs);
        const value = await this.auth.getAccessToken();
        if (!value) throw new Error("Production credentials unavailable");
        return value;
      });
      stage = "reservation"; reservation = "not_confirmed";
      await this.session.reserveProvider("manual", characters); reservation = "committed";
      stage = "provider"; provider = "transport_started";
      const timeout = options.requestDeadlineAtMs === undefined ? 15000 : Math.min(15000, options.requestDeadlineAtMs - Date.now());
      if (timeout <= 0) throw new TranslationDeadlineError();
      const {parent, ...body} = frozen;
      try {this.observer?.onInput([...frozen.contents]);} catch { /* Advisory capture only. */ }
      const result = await this.session.timed("provider", async () => {
        const response = await fetch("https://translation.googleapis.com/v3/" + parent + ":translateText", {
          method: "POST", headers: {Authorization: "Bearer " + token, "content-type": "application/json", "x-goog-user-project": PRODUCTION_PROJECT},
          body: JSON.stringify(body), signal: deadlineSignal(options.requestDeadlineAtMs, timeout),
        });
        if (!response.ok) throw nmtFailure({status: response.status}, "provider");
        return await response.json() as NmtResponse;
      });
      assertDeadlineActive();
      try {this.observer?.onOutput(projectNmtOutputContents(result));} catch { /* Preserve provider result. */ }
      stage = "provider_completion";
      await this.session.providerFinished((result.translations ?? []).reduce((sum, item) => sum + (typeof item.translatedText === "string" ? [...item.translatedText].length : 0), 0));
      return [result];
    } catch (error) {
      const failure = nmtFailure(error, stage, {reservation, provider});
      try {assertDeadlineActive();} catch {throw failure;}
      this.session.telemetry.failureStage = failure.diagnostic.stage;
      this.session.telemetry.reason = String(failure.diagnostic.code ?? failure.diagnostic.category);
      if (stage === "provider_completion") {this.session.telemetry.apiCalled = true; this.session.telemetry.reason = "operation_store_error";}
      else if (provider === "transport_started") try {
        if (failure.diagnostic.httpStatus) await this.session.providerServiceError(); else await this.session.providerUnknown();
      } catch { /* Durable provider_started prevents retry. */ }
      throw failure;
    }
  }
}
