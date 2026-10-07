import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { setTimeout as delay } from 'node:timers/promises';
import { type DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Guess } from '../types/guess.ts';

function conditionalConflict(error: unknown) {
  return error instanceof TransactionCanceledException &&
    error.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed');
}

export function guessRepository(client: DynamoDBDocumentClient, tableName: string) {
  async function writeTransaction(command: TransactWriteCommand) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await client.send(command);

        return true;
      } catch (error) {
        if (conditionalConflict(error)) return false;

        const reasons = error instanceof TransactionCanceledException
          ? error.CancellationReasons
          : undefined;
        const retryable = reasons?.some(reason => reason.Code === 'TransactionConflict') &&
          reasons.every(reason => reason.Code === 'None' || reason.Code === 'TransactionConflict');

        if (!retryable || attempt >= 3) throw error;

        const backoffMilliseconds = 25 * 2 ** attempt;
        await delay(backoffMilliseconds + Math.floor(Math.random() * backoffMilliseconds));
      }
    }
  }

  return {
    async get(id: string): Promise<Guess | undefined> {
      const { Item } = await client.send(new GetCommand({
        TableName: tableName,
        Key: { pk: `GUESS#${id}`, sk: 'DETAILS' },
        ConsistentRead: true,
      }));

      if (!Item) return undefined;

      const { pk: _pk, sk: _sk, ...guess } = Item;

      return guess as Guess;
    },

    async create(guess: Guess) {
      return writeTransaction(new TransactWriteCommand({ TransactItems: [
        { Put: {
          TableName: tableName,
          Item: { pk: `GUESS#${guess.id}`, sk: 'DETAILS', ...guess },
          ConditionExpression: 'attribute_not_exists(pk)',
        } },
        { Update: {
          TableName: tableName,
          Key: { pk: `PLAYER#${guess.playerId}`, sk: 'PROFILE' },
          UpdateExpression: 'SET pendingGuessId = :id',
          ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(pendingGuessId)',
          ExpressionAttributeValues: { ':id': guess.id },
        } },
      ] }));
    },

    async resolve(guess: Guess) {
      return writeTransaction(new TransactWriteCommand({ TransactItems: [
        { Put: {
          TableName: tableName,
          Item: { pk: `GUESS#${guess.id}`, sk: 'DETAILS', ...guess },
          ConditionExpression: '#status = :pending AND playerId = :player',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':pending': 'pending', ':player': guess.playerId },
        } },
        { Update: {
          TableName: tableName,
          Key: { pk: `PLAYER#${guess.playerId}`, sk: 'PROFILE' },
          UpdateExpression: 'REMOVE pendingGuessId ADD score :delta',
          ConditionExpression: 'attribute_exists(pk) AND pendingGuessId = :id',
          ExpressionAttributeValues: { ':id': guess.id, ':delta': guess.scoreDelta },
        } },
      ] }));
    },
  };
}
