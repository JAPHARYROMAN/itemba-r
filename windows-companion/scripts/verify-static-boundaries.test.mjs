import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const companion = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const session = 'src/Msaidizi.PrivilegedCommandSupervisor/Enforcement/NetworkIsolationDriverSessionV3.cs';
const registration = 'src/Msaidizi.EgressSupervisor/EgressSupervisorServiceRegistration.cs';
const engine = 'src/Msaidizi.EgressSupervisor/Core/EgressSupervisorEngine.cs';
const healthError = 'Privileged-command v3 ready-health refusal';
const mutations = [
  [session, '(health.HealthFlags & requiredFlags) != requiredFlags',
    '(health.HealthFlags & requiredFlags) == requiredFlags', healthError],
  [session, '| NetworkIsolationProtocolV3.HealthUnloading)) != 0',
    '| NetworkIsolationProtocolV3.HealthUnloading)) == 0', healthError],
  [session, '|| !CryptographicOperations.FixedTimeEquals(\n        health.DriverImageSha256,',
    '|| CryptographicOperations.FixedTimeEquals(\n        health.DriverImageSha256,', healthError],
  [registration, 'RejectingBrowserBoundaryEvidenceProvider>();',
    'UnreviewedBrowserBoundaryEvidenceProvider>();', 'Egress rejecting browser registration'],
  [engine, '?? new RejectingBrowserBoundaryEvidenceProvider();',
    '?? null!;', 'Egress rejecting browser constructor default'],
  [registration, 'return services;\n  }',
    'services.AddSingleton<IBrowserBoundaryEvidenceProvider, RejectingBrowserBoundaryEvidenceProvider>();\n    return services;\n  }',
    'Egress browser provider must retain one production registration'],
  [engine, '_destinationPolicy = destinationPolicy;',
    '_browserBoundaryProvider = null!;\n    _destinationPolicy = destinationPolicy;',
    'Egress browser provider must retain one production registration'],
];

test('static verifier accepts current sources and rejects each weakened boundary', {
  skip: process.platform !== 'win32',
  timeout: 180_000,
}, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'msaidizi-static-mutations-'));
  const fixture = join(temporary, 'windows-companion');
  try {
    // Never mutate the checkout: each negative control runs in this owned copy.
    cpSync(companion, fixture, {
      recursive: true,
      filter: (source) => !relative(companion, source).split(/[\\/]/)
        .some((part) => ['bin', 'obj', 'TestResults', '.git'].includes(part)),
    });
    const run = () => {
      const result = spawnSync('pwsh', [
        '-NoProfile', '-NonInteractive', '-File', join(fixture, 'scripts/verify-static.ps1'),
      ], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      return { status: result.status, output: result.stdout + result.stderr };
    };
    const baseline = run();
    assert.equal(baseline.status, 0, baseline.output);
    for (const [file, before, after, diagnostic] of mutations) {
      const path = join(fixture, file);
      const original = readFileSync(path, 'utf8');
      const normalized = original.replaceAll('\r\n', '\n');
      assert.equal(normalized.split(before).length - 1, 1, `unique mutation target: ${before}`);
      try {
        writeFileSync(path, normalized.replace(before, after));
        const result = run();
        assert.notEqual(result.status, 0, `accepted weakened boundary: ${before}`);
        assert.ok(result.output.includes(diagnostic), result.output);
      } finally {
        writeFileSync(path, original);
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
