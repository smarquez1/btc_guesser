/**
 * Display-only formatting. Prices stay exact decimal strings — these helpers
 * never round and are never used for game logic or comparisons.
 */

/** "$64,250.38" — groups the integer part, keeps the fraction exactly as provided. */
export function formatUsdPrice(price: string): string {
  const negative = price.startsWith("-");
  const unsigned = negative ? price.slice(1) : price;
  const dotIndex = unsigned.indexOf(".");
  const integerPart = dotIndex === -1 ? unsigned : unsigned.slice(0, dotIndex);
  const fractionPart = dotIndex === -1 ? "" : unsigned.slice(dotIndex);
  const digits = integerPart.replace(/^0+(?=\d)/, "");
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${negative ? "-" : ""}${grouped}${fractionPart}`;
}

/** Short age label for freshness hints: "just now", "12s ago", "3m ago", … */
export function formatRelativeAge(then: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 5) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

/** Localized date-time for result details, e.g. "Oct 6, 2026, 3:04 PM". */
export function formatDateTime(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}
