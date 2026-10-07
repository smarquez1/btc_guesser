import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../server/config.ts';

const environment = {
  AWS_REGION: 'us-east-1',
  DYNAMODB_TABLE: 'btc-guess',
  APP_ORIGIN: 'http://127.0.0.1:5173',
};

test('minimal AWS configuration uses documented defaults without a custom endpoint', () => {
  assert.deepEqual(loadConfig(environment), {
    port: 3000,
    host: '127.0.0.1',
    region: 'us-east-1',
    tableName: 'btc-guess',
    dynamodbEndpoint: undefined,
    appOrigin: 'http://127.0.0.1:5173',
    cookieSecure: false,
  });
});

test('local settings and secure production overrides are parsed explicitly', () => {
  const config = loadConfig({
    ...environment,
    PORT: '65535',
    HOST: '0.0.0.0',
    DYNAMODB_ENDPOINT: 'http://localhost:8001',
    APP_ORIGIN: 'https://example.com/',
    COOKIE_SECURE: 'true',
  });

  assert.equal(config.port, 65535);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.dynamodbEndpoint, 'http://localhost:8001/');
  assert.equal(config.appOrigin, 'https://example.com');
  assert.equal(config.cookieSecure, true);
  assert.equal(loadConfig({ ...environment, PORT: '1' }).port, 1);
});

for (const name of ['AWS_REGION', 'DYNAMODB_TABLE', 'APP_ORIGIN']) {
  test(`${name} is required and cannot be blank`, () => {
    for (const value of [undefined, '', '   ']) {
      assert.throws(
        () => loadConfig({ ...environment, [name]: value }),
        new RegExp(name),
      );
    }
  });
}

for (const value of ['', '0', '-1', '65536', '3.5', 'NaN', '1e3', ' 3000 ']) {
  test(`rejects invalid port ${JSON.stringify(value)}`, () => {
    assert.throws(() => loadConfig({ ...environment, PORT: value }), /PORT/);
  });
}

test('rejects invalid table names and accepts DynamoDB length boundaries', () => {
  for (const value of ['ab', 'a'.repeat(256), 'bad/name', 'bad name']) {
    assert.throws(
      () => loadConfig({ ...environment, DYNAMODB_TABLE: value }),
      /DYNAMODB_TABLE/,
    );
  }

  for (const value of ['abc', 'a'.repeat(255), 'btc_guess.v1-players']) {
    assert.equal(
      loadConfig({ ...environment, DYNAMODB_TABLE: value }).tableName,
      value,
    );
  }
});

test('rejects malformed URLs, unsafe protocols, and embedded credentials', () => {
  for (const name of ['APP_ORIGIN', 'DYNAMODB_ENDPOINT']) {
    for (const value of [
      'not-a-url',
      'ftp://example.com',
      'http://secret:password@example.com',
    ]) {
      assert.throws(
        () => loadConfig({ ...environment, [name]: value }),
        new RegExp(name),
      );

      try {
        loadConfig({ ...environment, [name]: value });
      } catch (error) {
        assert.doesNotMatch(String(error), /secret|password/);
      }
    }
  }
});

test('browser origin cannot contain a path, query, or fragment', () => {
  for (const value of [
    'https://example.com/path',
    'https://example.com/?a=1',
    'https://example.com/#fragment',
  ]) {
    assert.throws(
      () => loadConfig({ ...environment, APP_ORIGIN: value }),
      /APP_ORIGIN/,
    );
  }
});

test('explicit empty optional settings fail instead of silently defaulting', () => {
  for (const name of ['HOST', 'DYNAMODB_ENDPOINT', 'COOKIE_SECURE']) {
    assert.throws(
      () => loadConfig({ ...environment, [name]: '' }),
      new RegExp(name),
    );
  }

  assert.throws(
    () => loadConfig({ ...environment, COOKIE_SECURE: 'yes' }),
    /COOKIE_SECURE/,
  );
  assert.equal(
    loadConfig({ ...environment, COOKIE_SECURE: 'false' }).cookieSecure,
    false,
  );
});
