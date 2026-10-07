export interface PriceObservation {
  price: string;
  providerTradeAt: string;
  receivedAt: number;
}
export interface DisplayPricing {
  status: "fresh" | "stale" | "unavailable";
  observation: PriceObservation | null;
}
export const pricingPolicy = {
  cacheMs: 5_000,
  pollMs: 5_000,
  timeoutMs: 3_000,
  retryMs: 5_000,
  receiptAgeMs: 15_000,
  tradeAgeMs: 120_000,
  futureMs: 5_000,
  decimalLength: 128,
};
export function validPrice(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= pricingPolicy.decimalLength &&
    /^\d+(?:\.\d+)?$/.test(value) &&
    /[1-9]/.test(value)
  );
}
export function comparePrices(a: string, b: string): -1 | 0 | 1 {
  if (!validPrice(a) || !validPrice(b))
    throw new Error("Invalid decimal price");
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const scale = Math.max(af.length, bf.length);
  const left = BigInt(ai + af.padEnd(scale, "0"));
  const right = BigInt(bi + bf.padEnd(scale, "0"));
  return left === right ? 0 : left < right ? -1 : 1;
}
// Date.parse alone normalizes impossible dates (e.g. February 30).
export function tradeTimestamp(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  )
    return null;
  const parsed = Date.parse(value);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    return null;
  return parsed;
}
export function isFresh(observation: PriceObservation, now: number): boolean {
  const tradeAt = tradeTimestamp(observation.providerTradeAt);
  const age = now - observation.receivedAt;
  return (
    tradeAt !== null &&
    age >= 0 &&
    age <= pricingPolicy.receiptAgeMs &&
    now - tradeAt <= pricingPolicy.tradeAgeMs &&
    tradeAt - now <= pricingPolicy.futureMs
  );
}
