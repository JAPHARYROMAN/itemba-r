#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(rootDir, 'database/prisma/schema.prisma');
const schema = readFileSync(schemaPath, 'utf8');

const cuidMatches = [...schema.matchAll(/@default\(cuid\(\)\)/g)];

if (cuidMatches.length > 0) {
  console.error(
    `validate-id-strategy: ${cuidMatches.length} CUID default(s) found. New and existing Prisma ID defaults must use uuid().`,
  );
  process.exit(1);
}

console.log('validate-id-strategy: OK');
