// Local unsigned diagnostics only. This is not the release/signing runner.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import {
  executionBundleDigest,
  prismaSchemaMigrationDigest,
  sanitizedEvidenceChildEnvironment,
  validateUnsignedCrudPayload,
} from './crud-evidence-runner-lib.mjs';

export function diagnosticTarget(environment) {
  const url = new URL(environment.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    !/^\/msaidizi_crud_diagnostic_[a-z0-9]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Diagnostics require an explicit loopback msaidizi_crud_diagnostic_<suffix> database, without URL query or fragment.',
    );
  }
  if (environment.CRUD_COVERAGE_DISPOSABLE_DATABASE_ACK !== `${url.host}${url.pathname}`) {
    throw new Error('Exact disposable database acknowledgement required.');
  }
  return url;
}

export function diagnosticSchema() {
  const schema = `msaidizi_crud_evidence_diag_${randomUUID().replaceAll('-', '')}`;
  if (
    !/^msaidizi_crud_evidence_diag_[a-f0-9]{32}$/.test(schema) ||
    Buffer.byteLength(schema) > 63
  ) {
    throw new Error('Invalid generated schema');
  }
  return schema;
}

export async function main(environment = process.env) {
  const base = diagnosticTarget(environment);
  const backendDir = resolve(import.meta.dirname, '..');
  const prismaRoot = resolve(backendDir, '../database/prisma');
  const schema = diagnosticSchema();
  const outputDir = mkdtempSync(join(tmpdir(), 'msaidizi-crud-diagnostic-'));
  const output = join(outputDir, 'unsigned-payload.json');
  const logPath = join(outputDir, 'run.log');
  const log = openSync(logPath, 'wx', 0o600);
  console.log(`Unsigned diagnostic directory: ${outputDir}`);
  const maintenance = new PrismaClient({ datasources: { db: { url: base.toString() } } });
  let created = false;
  let cleanupComplete = false;
  const summary = {
    contract: 'msaidizi-crud-diagnostic/v1',
    releaseEligible: false,
    unsigned: true,
    schema,
    stages: {},
    output,
    logPath,
  };
  const safeParent = Object.fromEntries(
    Object.entries(environment).filter(([name]) =>
      ['PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'COMSPEC', 'WINDIR'].includes(name.toUpperCase()),
    ),
  );
  const run = (args, childEnvironment) => {
    const result = spawnSync(process.execPath, args, {
      cwd: backendDir,
      env: childEnvironment,
      stdio: ['ignore', log, log],
      windowsHide: true,
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  };
  try {
    console.log('Hashing current execution inputs. Do not edit this checkout during the run.');
    const started = Date.now();
    const applicationBuildDigest = executionBundleDigest(backendDir, import.meta.filename);
    const prismaDigest = prismaSchemaMigrationDigest(prismaRoot);
    const isolated = new URL(base);
    isolated.searchParams.set('schema', schema);
    const childEnvironment = sanitizedEvidenceChildEnvironment(safeParent, {
      NODE_ENV: 'test',
      DATABASE_URL: isolated.toString(),
      CRUD_COVERAGE_DISPOSABLE_DB: '1',
      CRUD_COVERAGE_SCHEMA: schema,
      CRUD_COVERAGE_UNSIGNED_OUTPUT_PATH: output,
      CRUD_COVERAGE_APPLICATION_BUILD_DIGEST: applicationBuildDigest,
      ANTHROPIC_API_KEY: '',
      MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ENABLED: 'false',
    });
    await maintenance.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    console.log('Deploying migrations into the new isolated schema.');
    summary.stages.migrationExit = run(
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--schema=../database/prisma/schema.prisma',
      ],
      childEnvironment,
    );
    if (summary.stages.migrationExit !== 0)
      throw new Error('Diagnostic migration failed; see retained log.');
    console.log(
      'Executing the complete CRUD matrix without cache; progress is retained in run.log.',
    );
    summary.stages.testExit = run(
      [
        '--max-old-space-size=8192',
        'node_modules/jest/bin/jest.js',
        '--config',
        'test/jest-e2e.json',
        '--no-cache',
        '--runInBand',
        '--ci',
        '--runTestsByPath',
        'test/crud-coverage-loopback.e2e-spec.ts',
      ],
      childEnvironment,
    );
    const finished = Date.now();
    summary.stages.inputsUnchanged =
      executionBundleDigest(backendDir, import.meta.filename) === applicationBuildDigest &&
      prismaSchemaMigrationDigest(prismaRoot) === prismaDigest;
    if (existsSync(output)) {
      const payload = JSON.parse(readFileSync(output, 'utf8'));
      const cases = Array.isArray(payload.cases) ? payload.cases : [];
      summary.cases = {
        total: cases.length,
        passed: cases.filter((item) => item.outcome === 'passed').length,
        failures: cases
          .filter((item) => item.outcome !== 'passed')
          .map((item) => ({
            fixtureId: item.fixtureId,
            capabilityId: item.capabilityId,
            outcome: item.outcome,
          })),
      };
      try {
        validateUnsignedCrudPayload(payload, {
          applicationBuildDigest,
          prismaSchemaMigrationDigest: prismaDigest,
          isolatedSchemaNameDigest: createHash('sha256').update(schema).digest('hex'),
          runStartedAtMs: started,
          runFinishedAtMs: finished,
        });
        summary.stages.payloadValid = true;
      } catch (error) {
        summary.stages.payloadValid = false;
        summary.validationError = error.message;
      }
    }
    if (
      summary.stages.testExit !== 0 ||
      !summary.stages.inputsUnchanged ||
      !summary.stages.payloadValid
    )
      process.exitCode = 1;
  } catch (error) {
    summary.error = error.message;
    process.exitCode = 1;
  } finally {
    try {
      // Only this successfully-created, exact allowlisted schema is removed.
      if (created) await maintenance.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      cleanupComplete = true;
    } catch (error) {
      summary.cleanupError = error.message;
      process.exitCode = 1;
    }
    await maintenance.$disconnect();
    closeSync(log);
    summary.cleanupComplete = cleanupComplete;
    writeFileSync(
      join(outputDir, 'diagnostic-summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    console.log(JSON.stringify(summary, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
