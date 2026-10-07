export const guessResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'direction', 'status', 'startingPrice', 'startingObservedAt', 'startedAt', 'deadline'],
  properties: {
    id: { type: 'string' },
    direction: { type: 'string', enum: ['up', 'down'] },
    status: { type: 'string', enum: ['pending', 'resolved'] },
    startingPrice: { type: 'number' },
    startingObservedAt: { type: 'integer' },
    startedAt: { type: 'integer' },
    deadline: { type: 'integer' },
    resolvedAt: { type: 'integer' },
    finalPrice: { type: 'number' },
    finalObservedAt: { type: 'integer' },
    correct: { type: 'boolean' },
    scoreDelta: { type: 'integer' },
  },
} as const;
