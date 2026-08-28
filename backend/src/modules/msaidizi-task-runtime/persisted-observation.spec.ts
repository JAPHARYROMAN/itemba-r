import { PERSISTED_SECRET_PLACEHOLDER } from '../../common/utils/persistent-secret-redaction';
import {
  MAX_PERSISTED_OBSERVATION_BYTES,
  preparePersistedUntrustedObservation,
  persistedUntrustedObservation,
} from './persisted-observation';

describe('persisted untrusted observations', () => {
  it('retains a bounded ERP result for adaptive reasoning with explicit provenance', () => {
    const observation = persistedUntrustedObservation(
      { data: [{ id: 'invoice-1', amount: 1250 }], total: 1 },
      'ERP_RESULT',
    );

    expect(observation).toMatchObject({
      available: true,
      trustLevel: 'UNTRUSTED',
      sourceType: 'ERP_RESULT',
      redactionsApplied: false,
      value: { data: [{ id: 'invoice-1', amount: 1250 }], total: 1 },
    });
    expect(observation.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('redacts credentials before the observation crosses the durable boundary', () => {
    const observation = persistedUntrustedObservation(
      { account: 'customer-1', accessToken: 'sk-proj-this-must-never-persist-1234567890' },
      'ERP_RESULT',
    );

    expect(observation).toMatchObject({
      available: true,
      redactionsApplied: true,
      value: { account: 'customer-1', accessToken: PERSISTED_SECRET_PLACEHOLDER },
    });
    expect(JSON.stringify(observation)).not.toContain('this-must-never-persist');
  });

  it('requires the artifact path instead of truncating oversized JSON', () => {
    const observation = persistedUntrustedObservation(
      { text: 'x'.repeat(MAX_PERSISTED_OBSERVATION_BYTES) },
      'HOST_RESULT',
    );

    expect(observation).toMatchObject({
      available: false,
      trustLevel: 'UNTRUSTED',
      sourceType: 'HOST_RESULT',
      reason: 'ARTIFACT_REQUIRED',
    });
    expect(observation).not.toHaveProperty('value');
  });

  it('prepares only redacted JSON bytes for encrypted artifact promotion', () => {
    const prepared = preparePersistedUntrustedObservation(
      {
        text: 'x'.repeat(MAX_PERSISTED_OBSERVATION_BYTES),
        accessToken: 'sk-proj-this-must-not-enter-the-artifact-1234567890',
      },
      'ERP_RESULT',
    );

    expect(prepared.observation).toMatchObject({
      available: false,
      reason: 'ARTIFACT_REQUIRED',
    });
    expect(prepared.artifact).toBeDefined();
    const artifactText = prepared.artifact!.content.toString('utf8');
    expect(artifactText).toContain(PERSISTED_SECRET_PLACEHOLDER);
    expect(artifactText).not.toContain('this-must-not-enter-the-artifact');
    expect(prepared.artifact!.persistedSha256).toMatch(/^[a-f0-9]{64}$/);
    prepared.artifact!.content.fill(0);
  });
});
