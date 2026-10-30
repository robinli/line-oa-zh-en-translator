import type {Translator, TranslationContext} from "./services.js";
import {NmtOutputRejected} from "./nmt-direct-translator.js";
import {createLiteralManifest} from "./nmt-literal-policy.js";
import {createNmtTransport} from "./nmt-transport-codec.js";
import type {SolClient} from "./sol-responses-client.js";
import {newSolReviewRecord, SolServiceError, type SolStageControl, type SolStage, type SolReviewRecord} from "./sol-review-types.js";
import {requestTimeout, remainingTimeout, withinTime, assertDeadlineActive} from "./translation-deadline.js";
import {TranslationQualityError} from "./trade-policy.js";
import type {RestoredTextRange} from "./message-text.js";
export interface ReviewedNmtTranslator extends Translator {
  translateCandidate(text: string, source: string, target: string, context?: TranslationContext): Promise<{origin: "local" | "nmt"; text: string; ranges: RestoredTextRange[]}>;
}
export interface SolRewritePolicy {
  createTransport(text: string, context?: TranslationContext): ReturnType<typeof createNmtTransport>;
  rejectionReason(error: unknown): string | undefined;
}
export class SolReviewedTranslator implements Translator {
  constructor(private readonly nmt: ReviewedNmtTranslator, private readonly sol: SolClient,
    private readonly stages: SolStageControl, private readonly names: readonly string[],
    private readonly observe?: (record: SolReviewRecord) => void, private readonly policy?: SolRewritePolicy) {}
  async translate(text: string, source: string, target: string, context?: TranslationContext): Promise<string> {
    return (await this.translateWithRanges(text, source, target, context)).text;
  }
  async translateWithRanges(text: string, source: string, target: string, context?: TranslationContext) {
    const record = newSolReviewRecord(), quote = context?.quoteContext ?? {status: "not_quoted" as const};
    record.sourceLanguageCode = source; record.targetLanguageCode = target;
    record.quoteStatus = quote.status;
    // A private copy of identity-free context is the sole input to either model.
    const publish = () => {try {assertDeadlineActive(); this.observe?.(record);} catch { /* advisory */ }};
    const call = async <T>(stage: SolStage, run: (timeout: number) => Promise<T>): Promise<T> => {
      requestTimeout(context?.deadlineAtMs);
      record[stage] = {status: "started"}; publish();
      try {await withinTime(() => this.stages.begin(stage, record), requestTimeout(context?.deadlineAtMs, 2000));}
      catch {throw new SolServiceError(stage, "sol_stage_store_error");}
      const started = Date.now();
      try {
        const result = await withinTime(() => run(requestTimeout(context?.deadlineAtMs)), requestTimeout(context?.deadlineAtMs));
        record[stage] = {status: "succeeded", elapsedMs: Date.now() - started, usage: (result as {usage?: never}).usage};
        publish();
        try {await withinTime(() => this.stages.finish(stage, record), requestTimeout(context?.deadlineAtMs, 2000));}
        catch {throw new SolServiceError(stage, "sol_stage_store_error");}
        return result;
      } catch (error) {
        record[stage] = {...record[stage], status: "unknown", elapsedMs: Date.now() - started};
        publish(); try {await withinTime(() => this.stages.finish(stage, record), remainingTimeout(context?.deadlineAtMs, 1000));} catch { /* started remains durable */ }
        throw error;
      }
    };
    try {
      let candidate: Awaited<ReturnType<ReviewedNmtTranslator["translateCandidate"]>> | undefined;
      try {
        candidate = await withinTime(() => this.nmt.translateCandidate(text, source, target, context), requestTimeout(context?.deadlineAtMs));
        record.nmtCheck = candidate.origin === "local" ? "local" : "passed";
      }
      catch (error) {
        const reason = this.policy ? this.policy.rejectionReason(error) : error instanceof NmtOutputRejected ? error.reason : undefined;
        if (reason === undefined) throw error;
        record.nmtCheck = "rejected"; record.nmtReason = reason;
      }
      publish();
      if (candidate?.origin === "local") {record.finalSource = "local"; return {text: candidate.text, ranges: candidate.ranges};}
      if (candidate) {
        const review = await call("review", timeout => this.sol.review(text, candidate!.text, source, target, quote, timeout));
        record.verdict = review.verdict; record.reason = review.reason;
        record.semanticEvaluation = review.verdict === "OK" ? "nmt_accepted" : review.verdict === "NOT_GOOD" ? "nmt_rejected" : "uncertain";
        if (review.verdict === "OK") {record.finalSource = "nmt"; return {text: candidate.text, ranges: candidate.ranges};}
      }
      const wire = this.policy?.createTransport(text, context) ?? createNmtTransport(createLiteralManifest(text, this.names, context));
      const rewritten = await call("rewrite", timeout => this.sol.rewrite(text, wire.contents[0]!, wire.mimeType, source, target, quote, timeout));
      // Decode before exposing any GPT output to capture, logs or LINE. No semantic re-review.
      let present: ((value: string) => string) | undefined;
      if (target === "zh-TW") present = (await import("opencc-js/cn2t")).Converter({from: "cn", to: "tw"});
      assertDeadlineActive();
      try {
        const result = wire.decode(rewritten.translation, present);
        record.finalSource = "gpt"; record.semanticEvaluation = "not_evaluated";
        return result;
      } catch (error) {
        record.rewrite.status = "rejected";
        if (error instanceof TranslationQualityError) throw error;
        throw new TranslationQualityError("invalid_response_format");
      }
    } finally {publish();}
  }
}
