import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'web', 'dist', 'index.html');
const to = join(root, 'nodes', 'JsonForm', 'form.html');

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log(`Placed web bundle at ${to}`);
