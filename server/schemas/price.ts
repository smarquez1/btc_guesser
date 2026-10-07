export const priceResponse = {
  type: 'object',
  required: ['symbol', 'price', 'observedAt', 'stale'],
  additionalProperties: false,
  properties: {
    symbol: { type: 'string', const: 'BTC-USD' },
    price: { type: 'number', exclusiveMinimum: 0 },
    observedAt: { type: 'integer' },
    stale: { type: 'boolean' },
  },
} as const;
