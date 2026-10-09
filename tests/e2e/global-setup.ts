import { build } from 'vite';

export default async function buildFrontend() {
  // Build once before workers start, independently of private environment files.
  await build({ envDir: false });
}
