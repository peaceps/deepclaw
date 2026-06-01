#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const deepclawHome = path.join(os.homedir(), '.deepclaw');
if (!fs.existsSync(deepclawHome)) {
    fs.mkdirSync(deepclawHome, { recursive: true });
}
process.chdir(deepclawHome);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, '..', 'dist', 'deepclaw.js');
if (!fs.existsSync(entry)) {
    console.error(
        `deepclaw-deepclaw: missing ${entry}. Build the package first (e.g. pnpm --filter @deepclaw/deepclaw build).`
    );
    process.exit(1);
}

await import(pathToFileURL(entry).href);
