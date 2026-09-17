import { mkdir, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'dist');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'model.js', 'plotly.min.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses']) {
  await cp(resolve(root, file), resolve(destination, file), { recursive: true });
}
console.log('Built static site in dist/');
