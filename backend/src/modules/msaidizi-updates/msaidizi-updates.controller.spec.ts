import { AGENT_EXCLUDED_KEY } from '../../common/decorators/agent-excluded.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { readFileSync } from 'node:fs';
import {
  MsaidiziUpdatesController,
  MsaidiziUpdateVerifierController,
} from './msaidizi-updates.controller';

describe('Msaidizi update route isolation', () => {
  it('is never agent-discoverable and requires explicit oversight', () => {
    expect(Reflect.getMetadata(AGENT_EXCLUDED_KEY, MsaidiziUpdatesController)).toBe(true);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, MsaidiziUpdatesController)).toEqual([
      'msaidizi.use',
      'msaidizi.oversight',
    ]);
  });

  it('keeps signed evidence on a distinct, non-discoverable verifier channel', () => {
    expect(Reflect.getMetadata(AGENT_EXCLUDED_KEY, MsaidiziUpdateVerifierController)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, MsaidiziUpdateVerifierController)).toBe(true);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, MsaidiziUpdateVerifierController)).toBeUndefined();
  });

  it('carries evaluator replay authority only in the scrubbed header, never the URL query', () => {
    const source = readFileSync(__filename.replace(/\.spec\.ts$/, '.ts'), 'utf8');
    const method = source.match(
      /@Get\('runs\/:runId\/generation-artifact'\)[\s\S]*?async generationArtifact[\s\S]*?\n  }/,
    )?.[0];
    expect(method).toContain("@Headers('x-msaidizi-evaluation-lease') leaseId: string");
    expect(method).not.toContain("@Query('leaseId')");
    expect(method).not.toContain('?leaseId=');
  });
});
