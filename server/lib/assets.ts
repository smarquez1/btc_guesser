import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config } from '../config.ts';

const gameEntry = 'src/main.ts';

interface ManifestEntry {
  file: string;
  css?: string[];
}

export type PageAssets =
  | { mode: 'development'; viteOrigin: string; entry: string }
  | { mode: 'production'; script: string; stylesheets: string[] };

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null || !('file' in value) ||
    typeof value.file !== 'string') {
    return false;
  }

  return !('css' in value) || (Array.isArray(value.css) && value.css.every(
    (stylesheet) => typeof stylesheet === 'string',
  ));
}

function assetUrl(path: string) {
  if (!path.startsWith('assets/') || path.includes('..')) {
    throw new Error('Build manifest contains an invalid asset path');
  }

  return `/${path}`;
}

export async function pageAssets(config: Config): Promise<PageAssets> {
  if (process.env.NODE_ENV !== 'production' && config.viteDevServerOrigin) {
    return {
      mode: 'development',
      viteOrigin: config.viteDevServerOrigin,
      entry: `${config.viteDevServerOrigin}/src/main.ts`,
    };
  }

  const manifestPath = resolve(import.meta.dirname, '../../dist/.vite/manifest.json');
  const contents = await readFile(manifestPath, 'utf8');
  const manifest: unknown = JSON.parse(contents);

  if (typeof manifest !== 'object' || manifest === null || !(gameEntry in manifest)) {
    throw new Error(`Build manifest is missing ${gameEntry}`);
  }

  const entry = manifest[gameEntry];

  if (!isManifestEntry(entry)) {
    throw new Error(`Build manifest has an invalid ${gameEntry} entry`);
  }

  const script = assetUrl(entry.file);
  const stylesheets = (entry.css ?? []).map(assetUrl);

  if (stylesheets.length === 0) {
    throw new Error(`Build manifest has no stylesheet for ${gameEntry}`);
  }

  for (const asset of [script, ...stylesheets]) {
    await access(resolve(import.meta.dirname, `../../dist${asset}`));
  }

  return {
    mode: 'production',
    script,
    stylesheets,
  };
}
