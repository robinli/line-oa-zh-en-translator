import {createHmac} from "node:crypto";
import {describe, expect, it} from "vitest";
import {verifyLineSignature} from "./signature.js";

describe("verifyLineSignature", () => {
  it("accepts an HMAC-SHA256 signature for the exact raw body", () => {
    const secret = "test-channel-secret";
    const rawBody = Buffer.from('{"events":[]}');
    const signature = createHmac("sha256", secret).update(rawBody).digest("base64");

    expect(verifyLineSignature(rawBody, secret, signature)).toBe(true);
  });

  it("rejects a modified body", () => {
    const secret = "test-channel-secret";
    const originalBody = Buffer.from('{"events":[]}');
    const signature = createHmac("sha256", secret).update(originalBody).digest("base64");

    expect(verifyLineSignature(Buffer.from('{"events":[1]}'), secret, signature)).toBe(false);
  });
});

