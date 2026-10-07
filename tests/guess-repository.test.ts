import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { guessRepository } from '../server/repositories/guesses.ts';
import type { Guess } from '../server/types/guess.ts';

const guess: Guess = {
  id: 'guess', playerId: 'player', direction: 'up', status: 'pending',
  startingPrice: 100, startingObservedAt: 1, startedAt: 2, deadline: 62,
};

function cancellation(...codes: string[]) {
  return new TransactionCanceledException({
    message: 'Canceled', $metadata: {},
    CancellationReasons: codes.map(Code => ({ Code })),
  });
}

for (const operation of ['create', 'resolve'] as const) {
  test(`${operation} retries transaction conflicts and preserves the original command`, async () => {
    const commands: unknown[] = [];
    const client = { send: async (command: unknown) => {
      commands.push(command);

      if (commands.length < 3) throw cancellation('None', 'TransactionConflict');

      return {};
    } } as unknown as DynamoDBDocumentClient;

    assert.equal(await guessRepository(client, 'table')[operation](guess), true);
    assert.equal(commands.length, 3);
    assert.ok(commands.every(command => command === commands[0]));
  });

  test(`${operation} stops after three retries`, async () => {
    let attempts = 0;
    const error = cancellation('TransactionConflict', 'None');
    const client = { send: async () => { attempts++; throw error; } } as unknown as DynamoDBDocumentClient;

    await assert.rejects(guessRepository(client, 'table')[operation](guess), candidate => candidate === error);
    assert.equal(attempts, 4);
  });

  test(`${operation} preserves conditional failure handling after retry`, async () => {
    let attempts = 0;
    const client = { send: async () => {
      attempts++;
      throw attempts === 1
        ? cancellation('TransactionConflict', 'None')
        : cancellation('None', 'ConditionalCheckFailed');
    } } as unknown as DynamoDBDocumentClient;

    assert.equal(await guessRepository(client, 'table')[operation](guess), false);
    assert.equal(attempts, 2);
  });

  test(`${operation} does not retry unrelated or mixed failures`, async () => {
    for (const error of [
      new Error('Storage unavailable'), cancellation(),
      cancellation('None', 'ConditionalCheckFailed'),
      cancellation('TransactionConflict', 'ValidationError'),
      cancellation('ProvisionedThroughputExceeded', 'None'),
    ]) {
      let attempts = 0;
      const client = { send: async () => { attempts++; throw error; } } as unknown as DynamoDBDocumentClient;
      const result = guessRepository(client, 'table')[operation](guess);

      if (error instanceof TransactionCanceledException &&
        error.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed')) {
        assert.equal(await result, false);
      } else {
        await assert.rejects(result, candidate => candidate === error);
      }

      assert.equal(attempts, 1);
    }
  });
}
