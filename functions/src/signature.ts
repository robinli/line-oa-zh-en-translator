import {createHmac, timingSafeEqual} from "node:crypto";

export function verifyLineSignature(
  rawBody: Buffer,
  channelSecret: string,
  signature: string,
): boolean {
  if (!channelSecret || !signature) {
    return false;
  }

  const expectedSignature = createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest();
  const receivedSignature = Buffer.from(signature, "base64");

  return (
    receivedSignature.length === expectedSignature.length &&
    timingSafeEqual(receivedSignature, expectedSignature)
  );
}

