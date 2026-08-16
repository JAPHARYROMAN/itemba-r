/**
 * Ambient attribution: an existing service that knows nothing about Msaidizi
 * must still record that an agent drove the action.
 *
 * This is what makes the audit trail true without editing ~100 call sites, so
 * the fallback behaviour is worth pinning down precisely.
 */

import { AuditChannel } from '@prisma/client';
import {
  ambientAgentSessionId,
  ambientChannel,
  currentRequestContext,
  runWithRequestContext,
} from './request-context';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';

describe('request context', () => {
  it('defaults to WEB outside any request', () => {
    expect(currentRequestContext()).toBeUndefined();
    expect(ambientChannel()).toBe(AuditChannel.WEB);
    expect(ambientAgentSessionId()).toBeUndefined();
  });

  it('exposes the channel and session inside a request', () => {
    runWithRequestContext({ channel: AuditChannel.AGENT, agentSessionId: 'ms_1' }, () => {
      expect(ambientChannel()).toBe(AuditChannel.AGENT);
      expect(ambientAgentSessionId()).toBe('ms_1');
    });
  });

  it('does not leak out of the request that established it', () => {
    runWithRequestContext({ channel: AuditChannel.AGENT, agentSessionId: 'ms_1' }, () => undefined);
    expect(ambientChannel()).toBe(AuditChannel.WEB);
  });

  it('survives an await boundary, as a real request does', async () => {
    await runWithRequestContext(
      { channel: AuditChannel.AGENT, agentSessionId: 'ms_2' },
      async () => {
        await new Promise((resolve) => setImmediate(resolve));
        expect(ambientAgentSessionId()).toBe('ms_2');
      },
    );
  });
});

describe('audit writes pick up ambient attribution', () => {
  function makeService() {
    const create = jest.fn().mockResolvedValue({});
    const service = new AuditLogsService({ auditLog: { create } } as never);
    return { service, create, dataOf: () => create.mock.calls[0][0].data };
  }

  it('attributes an unaware caller to the agent when the request was agent-driven', async () => {
    const { service, dataOf } = makeService();

    // Exactly what an existing service does today — no channel argument.
    await runWithRequestContext({ channel: AuditChannel.AGENT, agentSessionId: 'ms_run' }, () =>
      service.log({ action: 'CUSTOMER_UPDATE', entityType: 'Customer', userId: 'u1' }),
    );

    const data = dataOf();
    expect(data.channel).toBe(AuditChannel.AGENT);
    expect(data.agentSessionId).toBe('ms_run');
    expect(data.userId).toBe('u1'); // still the user's authority
  });

  it('lets an explicit channel win over the ambient one', async () => {
    const { service, dataOf } = makeService();

    await runWithRequestContext({ channel: AuditChannel.AGENT, agentSessionId: 'ms_run' }, () =>
      service.log({
        action: 'JOB_RAN',
        entityType: 'Job',
        channel: AuditChannel.SYSTEM,
      }),
    );

    expect(dataOf().channel).toBe(AuditChannel.SYSTEM);
    // The session id belongs to the agent path only, so it is dropped.
    expect(dataOf().agentSessionId).toBeUndefined();
  });

  it('still records WEB for an ordinary request', async () => {
    const { service, dataOf } = makeService();
    await runWithRequestContext({ channel: AuditChannel.WEB }, () =>
      service.log({ action: 'CUSTOMER_UPDATE', entityType: 'Customer' }),
    );
    expect(dataOf().channel).toBe(AuditChannel.WEB);
  });
});
