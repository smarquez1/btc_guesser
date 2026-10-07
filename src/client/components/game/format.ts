/**
 * Display-only formatting. Prices stay exact decimal strings — this helper
 * never rounds and is never used for game logic or comparisons.
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
