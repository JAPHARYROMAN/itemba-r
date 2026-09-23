import { Prisma } from '@prisma/client';

/** Caller holds the task row lock and has verified CANCELLING in this transaction. */
export async function cancelTaskReasoning(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<number> {
  const jobs = await tx.$queryRaw<
    Array<{
      id: string;
      status: string;
      payload: Prisma.JsonValue;
      idempotencyKey: string | null;
    }>
  >(Prisma.sql`SELECT "id", "status", "payload", "idempotencyKey"
    FROM "background_jobs" WHERE "jobType" = 'MSAIDIZI_REASONING_CHECKPOINT'
      AND "correlationId" = ${taskId} ORDER BY "id" FOR UPDATE`);
  for (const job of jobs) {
    if (!['QUEUED', 'RETRYING', 'RUNNING', 'CANCELLED', 'DEAD_LETTER'].includes(job.status))
      continue;
    const payload = job.payload;
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      payload.kind !== 'msaidizi-runtime-checkpoint/v1' ||
      payload.taskId !== taskId ||
      typeof payload.turnId !== 'string'
    )
      continue;
    const turn = await tx.msaidiziReasoningTurn.findFirst({
      where: {
        id: payload.turnId,
        taskId,
        planVersion: { taskId },
        checkpointStep: { taskId },
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      select: {
        id: true,
        status: true,
        planVersionId: true,
        checkpointStepId: true,
        checkpointStep: { select: { planVersionId: true } },
      },
    });
    if (
      !turn ||
      turn.planVersionId !== turn.checkpointStep.planVersionId ||
      job.idempotencyKey !== `msaidizi-reasoning:${turn.planVersionId}:${turn.checkpointStepId}`
    )
      continue;
    // Ending the exact owned queue lease makes its heartbeat abort the provider.
    // Unknown usage keeps its original reservation; no response is fabricated.
    if (['QUEUED', 'RETRYING', 'RUNNING'].includes(job.status)) {
      await tx.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: 'CANCELLED',
          leaseOwner: null,
          leaseHeartbeatAt: null,
          completedAt: new Date(),
        },
      });
    }
    const settled = await tx.msaidiziReasoningTurn.updateMany({
      where: {
        id: turn.id,
        taskId,
        planVersionId: turn.planVersionId,
        checkpointStepId: turn.checkpointStepId,
        status: turn.status,
      },
      data: { status: 'CANCELLED', errorCode: 'REASONING_TASK_CANCELLED', endedAt: new Date() },
    });
    if (settled.count !== 1) throw new Error('Reasoning cancellation CAS lost');
    await tx.msaidiziTaskEvent.create({
      data: {
        taskId,
        type: 'reasoning.checkpoint_cancelled',
        actorType: 'SYSTEM',
        payload: {
          turnId: turn.id,
          jobId: job.id,
          errorCode: 'REASONING_TASK_CANCELLED',
          retainedReservation: true,
        },
      },
    });
  }
  return tx.msaidiziReasoningTurn.count({
    where: { taskId, status: { in: ['QUEUED', 'RUNNING'] } },
  });
}
