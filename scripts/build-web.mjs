// Production build for hosting the app apart from its API (Vercel, for example).
// SAYC_API_URL is the API's public address, such as https://sayc-api.onrender.com; the app sends
// /api/v1 requests there. Without it, the build expects the API on its own address, as `npm run build` does.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const apiUrl = (process.env.SAYC_API_URL ?? '').trim();
if (apiUrl && !/^https:\/\/[^\s/]+(\/\S*)?$/i.test(apiUrl)) {
  console.error(`SAYC_API_URL must be an https address, got "${apiUrl}".`);
  process.exit(1);
}
console.log(apiUrl ? `API address: ${apiUrl}` : 'SAYC_API_URL is not set: the app will call /api/v1 on its own address.');

const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');
const args = [ng, 'build', '--configuration', 'production'];
if (apiUrl) args.push('--define', `SAYC_API_URL=${JSON.stringify(apiUrl)}`);

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
