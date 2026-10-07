export const playerErrorResponse = {
  type: 'object',
  required: ['error'],
  additionalProperties: false,
  properties: {
    error: { type: 'string' },
  },
} as const;

export const playerResponse = {
  type: 'object',
  required: ['name', 'score', 'createdAt'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    score: { type: 'integer' },
    createdAt: { type: 'integer' },
    pendingGuessId: { type: 'string' },
  },
} as const;
