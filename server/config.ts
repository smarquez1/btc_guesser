function required(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback?: string,
): string {
  const value = (env[name] ?? fallback)?.trim();

  if (!value) throw new Error(`Configuration: ${name} is required`);

  return value;
}

function httpUrl(env: NodeJS.ProcessEnv, name: string, fallback?: string): URL {
  const value = required(env, name, fallback);

  try {
    const url = new URL(value);

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error();
    }

    return url;
  } catch {
    throw new Error(
      `Configuration: ${name} must be an HTTP(S) URL without credentials`,
    );
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const portText = env.PORT ?? '3000';
  const port = Number(portText);

  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
    throw new Error('Configuration: PORT must be an integer from 1 to 65535');
  }

  const tableName = required(env, 'DYNAMODB_TABLE');

  if (!/^[a-zA-Z0-9_.-]{3,255}$/.test(tableName)) {
    throw new Error(
      'Configuration: DYNAMODB_TABLE must contain 3–255 letters, digits, underscores, dots, or hyphens',
    );
  }

  const origin = httpUrl(
    env,
    'APP_ORIGIN',
    production ? env.RENDER_EXTERNAL_URL : undefined,
  );

  if (origin.href !== `${origin.origin}/`) {
    throw new Error(
      'Configuration: APP_ORIGIN must be an origin without a path, query, or fragment',
    );
  }

  const cookieSecure = env.COOKIE_SECURE ?? (production ? 'true' : 'false');

  if (!['true', 'false'].includes(cookieSecure)) {
    throw new Error('Configuration: COOKIE_SECURE must be true or false');
  }

  return {
    port,
    host: required(env, 'HOST', production ? '0.0.0.0' : '127.0.0.1'),
    region: required(env, 'AWS_REGION'),
    tableName,
    dynamodbEndpoint:
      env.DYNAMODB_ENDPOINT === undefined
        ? undefined
        : httpUrl(env, 'DYNAMODB_ENDPOINT').href,
    appOrigin: origin.origin,
    cookieSecure: cookieSecure === 'true',
  };
}

export type Config = ReturnType<typeof loadConfig>;
