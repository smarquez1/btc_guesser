import { createHash, timingSafeEqual } from "node:crypto";

export function digestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const COOKIE_PATTERN = /^([a-zA-Z0-9-]{1,64})\.([a-f0-9]{64})$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

// Splits the `btc_player` credential into its player id and secret token, or
// returns undefined when the cookie is absent or malformed.
export function parsePlayerCookie(
  value: string | undefined,
): { playerId: string; credential: string } | undefined {
  if (!value) return undefined;
  const match = COOKIE_PATTERN.exec(value);
  if (!match) return undefined;
  return { playerId: match[1], credential: match[2] };
}

// Constant-time comparison of the stored session digest against the credential.
// The digest format is checked first so timingSafeEqual always receives
// equal-length hex buffers.
export function matchesSessionDigest(
  sessionDigest: string,
  credential: string,
): boolean {
  if (!DIGEST_PATTERN.test(sessionDigest)) return false;
  return timingSafeEqual(
    Buffer.from(sessionDigest, "hex"),
    Buffer.from(digestToken(credential), "hex"),
  );
}
