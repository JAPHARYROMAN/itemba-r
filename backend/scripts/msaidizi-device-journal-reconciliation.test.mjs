import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(resolve(repositoryRoot, path), 'utf8');

test('local journal range is bounded and exposes only digest records', () => {
  const contract = read(
    'windows-companion/src/Msaidizi.Companion.Contracts/Journal/IActionJournal.cs',
  );
  const implementation = read(
    'windows-companion/src/Msaidizi.Companion.Service/Journal/FileHashChainActionJournal.cs',
  );
  assert.match(contract, /MaximumEntriesPerRange = 128/);
  assert.match(contract, /int HashVersion = 2/);
  assert.match(contract, /JournalRecordRange/);
  assert.match(implementation, /ReadRangeAsync/);
  const publicRecord = contract
    .slice(
      contract.indexOf('public sealed record JournalRecord('),
      contract.indexOf('public sealed record JournalTerminalReceipt('),
    )
    .replace(/^\s*\/\/\/.*$/gm, '');
  assert.doesNotMatch(publicRecord, /PayloadJson|ArgumentsJson|OutputJson|Credential/i);
  assert.match(implementation, /journal_hash_version_downgrade/);
  assert.match(implementation, /journal_chain_upgrade_missing/);
  assert.match(implementation, /_records\.AddRange\(loaded\.Records\)/);
  const readRange = implementation.slice(
    implementation.indexOf('public async ValueTask<JournalRecordRange> ReadRangeAsync'),
    implementation.indexOf('public async ValueTask<JournalVerificationResult> VerifyAsync'),
  );
  assert.doesNotMatch(readRange, /LoadAndVerify/);
});

test('startup reconciles exactly before broker command intake', () => {
  const worker = read('windows-companion/src/Msaidizi.Companion.Service/CompanionWorker.cs');
  const startupGate = worker.indexOf(
    'await reconciliationGate.ReconcileExactHeadAsync(stoppingToken)',
  );
  const commandIntake = worker.indexOf('channel.ReadCommandsAsync(stoppingToken)');
  assert.ok(startupGate >= 0 && commandIntake > startupGate);
  assert.ok(
    worker.match(/reconciliationGate\.ReconcileExactHeadAsync/g)?.length >= 4,
    'execute, replay, and fence must re-enter the gate after startup',
  );
  assert.match(worker, /reconciliationGate\.IsExactHeadReconciled\(head\)/);
  const ping = worker.indexOf('case PingCommand _');
  const pingReconcile = worker.indexOf('reconciliationGate.ReconcileExactHeadAsync', ping);
  const pingHeartbeat = worker.indexOf('SendHeartbeatSafelyAsync', ping);
  assert.ok(ping >= 0 && pingReconcile > ping && pingHeartbeat > pingReconcile);
  const actionSettled = worker.indexOf('await actionTask.ConfigureAwait(false)');
  const actionReconcile = worker.indexOf(
    'reconciliationGate.ReconcileExactHeadAsync',
    actionSettled,
  );
  assert.ok(actionSettled >= 0 && actionReconcile > actionSettled);
  const fenceSettled = worker.indexOf('await fenceTask.ConfigureAwait(false)');
  const fenceReconcile = worker.indexOf(
    'reconciliationGate.ReconcileExactHeadAsync',
    fenceSettled,
  );
  assert.ok(fenceSettled >= 0 && fenceReconcile > fenceSettled);
});

test('outbound protocol requires an exact request-bound acknowledgement', () => {
  const channel = read(
    'windows-companion/src/Msaidizi.Companion.Service/Channel/HttpPollingCompanionChannel.cs',
  );
  assert.match(channel, /"journal-reconcile"/);
  assert.match(channel, /"journal-head"/);
  assert.match(channel, /GetJournalHeadAsync/);
  for (const binding of [
    'StartingPreviousSequence',
    'StartingPreviousHash',
    'AcceptedThroughSequence',
    'AcceptedThroughHash',
    'LocalHeadSequence',
    'LocalHeadHash',
    'ExactHead',
  ]) {
    assert.match(channel, new RegExp(`acknowledgement\\.${binding}`));
  }

  const gate = read(
    'windows-companion/src/Msaidizi.Companion.Service/Journal/JournalReconciliationGate.cs',
  );
  assert.match(gate, /GetJournalHeadAsync/);
  assert.match(gate, /central journal head does not exist in the verified local chain/i);
  assert.match(gate, /did not make monotonic progress/);
  assert.doesNotMatch(gate, /4_096/);
});

test('central ledger uses row locking, CAS, and rejects divergent history', () => {
  const service = read(
    'backend/src/modules/msaidizi-devices/msaidizi-device-journal-ledger.service.ts',
  );
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /AND "sequence" = \$\{current\.sequence\}/);
  assert.match(service, /"exactAcknowledgedAt" = NULL/);
  assert.match(service, /"exactAcknowledgedAt" = CURRENT_TIMESTAMP/);
  assert.match(service, /cannot be rewritten or forked/);
  assert.match(service, /digestOnlyEntryHash\(entry\)/);
  assert.match(service, /canonical lowercase/);
  assert.match(service, /\.digest\('hex'\);/);
  assert.match(service, /head\.hashVersion === 2/);
  assert.match(service, /cannot downgrade from v2 to v1/);
  assert.match(service, /explicit v2 upgrade bridge/);
  assert.match(service, /one-way v1 to v2 transition/);
  assert.match(service, /async head\(dto: DeviceJournalHeadDto/);
  assert.match(service, /sequence gap/);
  assert.match(service, /directMtlsPeer\(request\)/);
  assert.doesNotMatch(service, /payloadJson|argumentsJson|outputJson|credential/i);
});

test('database journal records are append-only and payload-free', () => {
  const migration = read(
    'database/prisma/migrations/20260827060000_msaidizi_device_journal_ledger/migration.sql',
  );
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /msaidizi_device_journal_entries_append_only/);
  assert.doesNotMatch(migration, /payloadJson|argumentsJson|outputJson|credential/i);
});

test('broker dispatch requires a heartbeat whose head matches the central ledger', () => {
  const broker = read('backend/src/modules/msaidizi-devices/msaidizi-devices.service.ts');
  assert.match(broker, /runtime\.centralLedgerConnected !== true/);
  assert.match(broker, /journalHeadIsExact/);
  assert.match(broker, /this\.journalLedger\.isExactHead/);
  assert.match(broker, /if \(!journalHeadIsExact\) return \{ commands: \[pingCommand\(\)\] \}/);
  assert.match(broker, /SET "exactAcknowledgedAt" = NULL/);
  assert.match(broker, /if \(dto\.journalSequence != null\)/);
});
