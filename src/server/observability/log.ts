// Structural logging contract shared by the pricing and resolver services.
// Fastify's pino logger satisfies this shape.
export interface StructuredLog {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}
export type PricingLog = Pick<StructuredLog, "info" | "warn">;
export type ResolverLog = StructuredLog;
