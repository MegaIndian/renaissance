import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { formatTokensCss } from '../src/format';

const out = fileURLToPath(new URL('../src/tokens.css', import.meta.url));
writeFileSync(out, await formatTokensCss());
console.log(`wrote ${out}`);
