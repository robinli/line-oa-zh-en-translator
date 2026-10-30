import {createHash} from "node:crypto";
import {Readable, Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {getStorage} from "firebase-admin/storage";
import type {FirestoreConversationArchiveStore} from "./conversation-archive-store.js";
import type {ArchiveJob} from "./conversation-archive.js";

export interface ArchivedObject {objectPath: string; bytes: number; sha256: string; contentType: string}
export interface ArchiveObjectStore {
  save(job: ArchiveJob, stream: Readable, contentType: string, signal: AbortSignal): Promise<ArchivedObject>;
  remove(job: ArchiveJob): Promise<void>;
}
export interface ArchiveContentSource {load(messageId: string, signal: AbortSignal): Promise<{stream: Readable; contentType: string}>}
export class ArchiveContentUnavailable extends Error {constructor(readonly permanent: boolean, readonly reason: string) {super(reason);}}
export class LineArchiveContentSource implements ArchiveContentSource {
  constructor(private readonly accessToken: string, private readonly request: typeof fetch = fetch) {}
  async load(messageId: string, signal: AbortSignal): Promise<{stream: Readable; contentType: string}> {
    const response = await this.request(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
      headers: {Authorization: `Bearer ${this.accessToken}`}, redirect: "error", signal,
    });
    if (response.status === 202) {await response.body?.cancel(); throw new ArchiveContentUnavailable(false, "content_preparing");}
    if (!response.ok || !response.body) {await response.body?.cancel(); throw new ArchiveContentUnavailable([400, 404, 410].includes(response.status), [404, 410].includes(response.status) ? "content_expired_or_unsent" : "content_unavailable");}
    return {stream: Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>), contentType: response.headers.get("content-type") ?? "application/octet-stream"};
  }
}
export class GoogleArchiveObjectStore implements ArchiveObjectStore {
  private readonly bucket;
  constructor(projectId: string) {this.bucket = getStorage().bucket(`${projectId}-conversation-archive`);}
  async save(job: ArchiveJob, stream: Readable, contentType: string, signal: AbortSignal): Promise<ArchivedObject> {
    const objectPath = `messages/${job.messageKey}/original`, file = this.bucket.file(objectPath);
    // A previous upload can have succeeded even if its acknowledgement was lost.
    const [exists] = await file.exists();
    if (exists) {
      stream.destroy();
      const [metadata] = await file.getMetadata();
      if (metadata.metadata?.messageKey !== job.messageKey) throw new Error("archive_object_metadata_missing");
      let sha256 = metadata.metadata.sha256;
      if (typeof sha256 !== "string") {
        const digest = createHash("sha256"), existing = file.createReadStream();
        const abort = () => existing.destroy(new Error("Archive read aborted.")); signal.addEventListener("abort", abort, {once: true});
        try {for await (const chunk of existing) {if (signal.aborted) throw new Error("Archive read aborted."); digest.update(chunk);}} finally {signal.removeEventListener("abort", abort);}
        sha256 = digest.digest("hex"); await file.setMetadata({metadata: {messageKey: job.messageKey, sha256}});
      }
      return {objectPath, bytes: Number(metadata.size), sha256, contentType: metadata.contentType ?? contentType};
    }
    const digest = createHash("sha256"); let bytes = 0;
    const counter = new Transform({transform(chunk: Buffer, _encoding, callback) {bytes += chunk.length; digest.update(chunk); callback(null, chunk);}});
    const output = file.createWriteStream({resumable: false, validation: "crc32c", preconditionOpts: {ifGenerationMatch: 0}, metadata: {contentType, metadata: {messageKey: job.messageKey}}});
    await pipeline(stream, counter, output, {signal});
    const sha256 = digest.digest("hex");
    await file.setMetadata({metadata: {messageKey: job.messageKey, sha256}});
    return {objectPath, bytes, sha256, contentType};
  }
  async remove(job: ArchiveJob): Promise<void> {await this.bucket.file(`messages/${job.messageKey}/original`).delete({ignoreNotFound: true});}
}
export async function processArchiveJob(id: string, store: FirestoreConversationArchiveStore, source: ArchiveContentSource, objects: ArchiveObjectStore): Promise<void> {
  const job = await store.claimJob(id); if (!job) return;
  const signal = AbortSignal.timeout(500000);
  try {
    if (job.kind === "purge") {
      await store.purgeContent(job); await objects.remove(job); await store.completeJob(job, "complete"); return;
    }
    const state = await store.jobState(job);
    if (state.redacted) {await objects.remove(job); await store.completeJob(job, "complete", {cleanupComplete: true}); return;}
    if ((state.metadata as {contentProvider?: {type?: string}} | undefined)?.contentProvider?.type === "external") {
      await store.completeJob(job, "missing", {reason: "external_provider_not_retrievable"}); return;
    }
    const content = await source.load(job.messageId, signal);
    const result = await objects.save(job, content.stream, content.contentType, signal);
    // Purge may race a streaming upload; this final tombstone check removes a late object.
    const retained = await store.completeJob(job, "complete", {...result});
    if (!retained) {await objects.remove(job); await store.completeJob(job, "complete", {cleanupComplete: true});}
  } catch (error) {
    const reason = error instanceof ArchiveContentUnavailable ? error.reason : "attachment_store_error";
    const redacted = (await store.jobState(job)).redacted === true;
    const final = job.kind === "download" && !redacted && (error instanceof ArchiveContentUnavailable && error.permanent || job.attempts >= 8);
    await store.completeJob(job, final ? "missing" : "pending", {reason});
    if (!final) throw new Error("Conversation archive job requires retry.");
  }
}
