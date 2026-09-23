/** Full AppModule, real JWT/permissions/ERP. Only release admission and cloud model are test ports. */
import '../setup-env';
import { ConfigService } from '@nestjs/config';
import { createE2eApp } from '../e2e-app';
import { ModelClient, ModelRequest } from '../../src/modules/msaidizi/model-client';
import { MsaidiziTaskDispatcherService } from '../../src/modules/msaidizi-task-runtime/msaidizi-task-dispatcher.service';
import { JobWorkerService } from '../../src/modules/job-worker/job-worker.service';
import { JobHandlerRegistry } from '../../src/modules/job-worker/job-handler.registry';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CapabilityInvoker } from '../../src/modules/msaidizi/capability-invoker';

async function send(message: Record<string, unknown>) {
  await new Promise<void>((resolve, reject) => {
    if (!process.send || !process.connected) return reject(new Error('Fixture IPC is unavailable'));
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
}

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.MSAIDIZI_CHAT_DISPOSABLE_DB !== '1' ||
    database.hostname !== '127.0.0.1' ||
    !/^\/msaidizi_chat_proof_api(?:_[a-z0-9]+)?$/.test(database.pathname)
  )
    throw new Error('API fixture requires a dedicated loopback proof API database');
  const reasoning = process.env.MSAIDIZI_API_PROOF_REASONING;
  if (reasoning && !['continue', 'unplanned', 'replan', 'binding-fill'].includes(reasoning))
    throw new Error('Unknown reasoning fixture');
  const replanning = reasoning === 'replan' || reasoning === 'binding-fill';
  let modelHold: string | undefined;
  let releaseModel: (() => void) | undefined;
  let lateModelResult = false;
  const app = await createE2eApp({
    useProductionPipeline: true,
    logLevels: ['error'],
    modelClient: {
      createMessage: async (request: ModelRequest) => {
        if (!reasoning) throw new Error('No cloud model permitted in API restart proof');
        const text = request.messages[0]?.content;
        if (request.tools.length || typeof text !== 'string')
          throw new Error('Unexpected scripted model request');
        const payload = JSON.parse(text);
        if (
          payload.protocol !== 'msaidizi-runtime-checkpoint/v1' ||
          payload.taskMode !== 'AUTOPILOT' ||
          payload.observation?.trustLevel !== 'UNTRUSTED' ||
          payload.reviewedPlan?.length !== (replanning ? (payload.planVersion === 1 ? 3 : 1) : 2) ||
          !['ExpensesController.findAll', 'ExpensesController.findOne'].includes(
            payload.checkpoint?.capability,
          )
        ) {
          throw new Error('Scripted model received an out-of-scope checkpoint');
        }
        if (reasoning === 'binding-fill') {
          const detail = payload.reviewedPlan.find(
            (step: { stepKey: string }) => step.stepKey === 'detail',
          );
          const context = detail?.bindingContext;
          if (
            context?.status !== 'VALID' ||
            context.resolutionOwner !== 'EXECUTOR' ||
            context.lockedTargets?.length !== 1 ||
            context.lockedTargets[0].targetPath !== '/query/page' ||
            context.lockedTargets[0].modelFillAllowed !== false ||
            context.lockedTargets[0].sourceKind !== 'PLAN_INPUT'
          )
            throw new Error('Executor-managed binding context is missing');
        }
        if (modelHold) {
          await send({ type: 'after-model-reservation', id: modelHold });
          // ModelClient has been entered after the real durable reservation.
          // The parent either kills this child or cancels its real worker lease.
          // A late-response fixture returns only after observing that abort.
          await new Promise<void>((resolve, reject) => {
            if (!request.signal) return reject(new Error('Model cancellation signal missing'));
            releaseModel = () => {
              request.signal?.removeEventListener('abort', abort);
              resolve();
            };
            const abort = () =>
              lateModelResult
                ? resolve()
                : reject(
                    Object.assign(new Error('Scripted provider aborted'), { name: 'AbortError' }),
                  );
            if (request.signal.aborted) abort();
            else request.signal.addEventListener('abort', abort, { once: true });
          });
        }
        // Deterministic adversarial/positive responses, never a provider call.
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                decision:
                  reasoning === 'unplanned' || (replanning && payload.planVersion === 1)
                    ? 'REPLAN'
                    : 'CONTINUE',
                outcome: 'ON_TRACK',
                reasonCode: 'SCRIPTED_CHECKPOINT',
                summary: 'Scripted integration checkpoint.',
                confidence: 0.95,
                replan:
                  reasoning === 'unplanned'
                    ? {
                        orderedPendingStepKeys: ['unreviewed-delete'],
                        skippedPendingStepKeys: [],
                        readArgumentFills: [],
                      }
                    : replanning && payload.planVersion === 1
                      ? {
                          orderedPendingStepKeys: ['detail'],
                          skippedPendingStepKeys: ['fallback'],
                          readArgumentFills:
                            reasoning === 'binding-fill'
                              ? [{ stepKey: 'detail', values: { query: { limit: 10 } } }]
                              : [],
                        }
                      : null,
              }),
            },
          ],
          stopReason: 'end_turn',
          usage: {
            inputTokens: 100,
            outputTokens: 30,
            cacheReadInputTokens: 20,
            cacheCreationInputTokens: 0,
          },
        };
      },
    } as ModelClient,
    crudCoverage: { report: () => ({ releaseGate: { status: 'passed', blockers: [] } }) } as never,
  });
  await app.listen(0, '127.0.0.1');
  const config = app.get(ConfigService);
  config.set('MSAIDIZI_AUTONOMY_ENABLED', 'true');
  config.set('MSAIDIZI_AUTONOMY_PRINCIPAL_KEY', process.env.MSAIDIZI_API_PROOF_PRINCIPAL!);
  // Explicit, process-local admission for the read-only routine proof. No
  // timers are started: both workers were disabled when AppModule booted.
  const routines = process.env.MSAIDIZI_API_PROOF_ROUTINES === '1';
  const writes = process.env.MSAIDIZI_API_PROOF_WRITES === '1';
  if (routines && writes) throw new Error('Routine API proof must remain read-only');
  if (reasoning && (!routines || writes))
    throw new Error('Reasoning proof requires read-only routines');
  config.set('MSAIDIZI_AUTOPILOT_ENABLED', routines ? 'true' : 'false');
  config.set('MSAIDIZI_ADAPTIVE_REASONING_ENABLED', reasoning ? 'true' : 'false');
  config.set(
    'MSAIDIZI_AUTONOMY_GRANTS',
    writes ? 'expenses.view,expenses.create' : 'expenses.view',
  );
  config.set('MSAIDIZI_WRITE_MODE', writes ? 'amber' : 'read-only');
  config.set('JOB_WORKER_STALE_AFTER_SECONDS', '2');
  config.set('MSAIDIZI_LOOPBACK_URL', `${await app.getUrl()}/api/v1`);
  // Fault injection occurs only AFTER the actual authenticated ERP HTTP call.
  // Never replace its result or its permission/controller/audit path.
  let hold: { id: string; taskId: string } | undefined;
  const invoker = app.get(CapabilityInvoker);
  const invoke = invoker.invoke.bind(invoker);
  invoker.invoke = async (request) => {
    const result = await invoke(request);
    if (
      hold &&
      request.capability.id === 'ExpensesController.create' &&
      request.agentSessionId === `task_${hold.taskId.replace(/-/g, '')}` &&
      result.ok &&
      result.status === 201
    ) {
      await send({ type: 'after-response', id: hold.id });
      // Parent kills this exact child after verifying the committed record.
      await new Promise<void>(() => undefined);
    }
    return result;
  };
  let processing = false;
  let decisionHold: { id: string; taskId: string } | undefined;
  const registry = app.get(JobHandlerRegistry);
  const reasoningHandler = registry.get('MSAIDIZI_REASONING_CHECKPOINT')!;
  registry.register('MSAIDIZI_REASONING_CHECKPOINT', async (context) => {
    const result = await reasoningHandler(context);
    if (
      decisionHold &&
      context.payload.taskId === decisionHold.taskId &&
      result.data?.ok === true
    ) {
      // The real handler and its transaction have completed. Only the worker's
      // BackgroundJob completion CAS remains; parent kills this exact child.
      await send({ type: 'after-decision', id: decisionHold.id });
      await new Promise<void>(() => undefined);
    }
    return result;
  });
  process.on(
    'message',
    (message: {
      command?: string;
      id?: string;
      taskId?: string;
      holdAfterResponse?: boolean;
      holdAfterModelReservation?: boolean;
      lateModelResult?: boolean;
      holdAfterDecision?: boolean;
    }) => {
      void (async () => {
        if (message.command === 'release-model' && message.id === modelHold && processing) {
          releaseModel?.();
          releaseModel = undefined;
          return;
        }
        if (message.command === 'dispatch-only' && message.id && message.taskId && processing) {
          try {
            await app.get(MsaidiziTaskDispatcherService).dispatchOnce();
            await send({ type: 'tick', id: message.id });
          } catch (error) {
            await send({ type: 'error', id: message.id, message: String(error) });
          }
          return;
        }
        if (processing || message.command !== 'tick' || !message.id || !message.taskId) return;
        processing = true;
        hold = message.holdAfterResponse ? { id: message.id, taskId: message.taskId } : undefined;
        modelHold = message.holdAfterModelReservation ? message.id : undefined;
        lateModelResult = message.lateModelResult === true;
        decisionHold = message.holdAfterDecision
          ? { id: message.id, taskId: message.taskId }
          : undefined;
        try {
          config.set('JOB_WORKER_ENABLED', 'true');
          config.set('MSAIDIZI_TASK_WORKER_ENABLED', 'true');
          const dispatcher = app.get(MsaidiziTaskDispatcherService);
          await dispatcher.dispatchOnce();
          const jobs = await app.get(PrismaService).backgroundJob.findMany({
            where: {
              jobType: {
                in: reasoning
                  ? ['MSAIDIZI_TASK_STEP', 'MSAIDIZI_REASONING_CHECKPOINT']
                  : ['MSAIDIZI_TASK_STEP'],
              },
              correlationId: message.taskId,
              status: { in: ['QUEUED', 'RETRYING', 'RUNNING'] },
            },
            select: { id: true },
          });
          for (const job of jobs) await app.get(JobWorkerService).drainOnce(1, { jobId: job.id });
          await dispatcher.dispatchOnce();
          await send({ type: 'tick', id: message.id });
        } catch (error) {
          await send({ type: 'error', id: message.id, message: String(error) });
        } finally {
          config.set('JOB_WORKER_ENABLED', 'false');
          config.set('MSAIDIZI_TASK_WORKER_ENABLED', 'false');
          processing = false;
          hold = undefined;
          modelHold = undefined;
          releaseModel = undefined;
          lateModelResult = false;
          decisionHold = undefined;
        }
      })();
    },
  );
  process.on('disconnect', () => {
    void app.close();
  });
  await send({ type: 'ready', url: `${await app.getUrl()}/api/v1` });
}
main().catch(async (error) => {
  process.exitCode = 1;
  await send({ type: 'error', message: String(error) }).catch(() => undefined);
  if (process.connected) process.disconnect();
});
