const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { releaseExpiredPosReservations } = require('../dist/common/services/pos-draft-reservations');
const { AuditLogsService } = require('../dist/modules/audit-logs/audit-logs.service');
const {
  PosDraftReservationExpiryService,
} = require('../dist/modules/pos-drafts/pos-draft-reservation-expiry.service');

/** Called only by the isolated API/database proof with its synthetic fixture. */
module.exports.verifyPosReservationHardening = async ({ db, check, fixture: f }) => {
  const sweep = new PosDraftReservationExpiryService(db, new AuditLogsService(db));
  const past = () => new Date(Date.now() - 60_000);
  const future = () => new Date(Date.now() + 86_400_000);
  async function branchFixture(reserved, revision = 17) {
    const branch = await db.branch.create({
      data: {
        divisionId: f.division.id,
        code: randomUUID(),
        name: 'Synthetic reservation concurrency proof',
        type: 'OTHER',
      },
    });
    const balance = await db.inventoryBalance.create({
      data: {
        companyId: f.company.id,
        divisionId: f.division.id,
        branchId: branch.id,
        productId: f.product.id,
        quantityOnHand: 100,
        quantityReserved: reserved,
        averageCost: 40,
        totalValue: 4000,
        physicalRevision: revision,
      },
    });
    return { branch, balance };
  }
  async function hold(branch, quantity, expiresAt, releasedAt = null) {
    return db.posDraft.create({
      data: {
        companyId: f.company.id,
        divisionId: f.division.id,
        branchId: branch.id,
        originUserId: f.admin.user.id,
        originRole: 'CASHIER',
        requestId: randomUUID(),
        kind: 'SALE',
        status: 'AWAITING_STOCKIST',
        businessDate: new Date(),
        capturedAt: new Date(),
        payload: { lines: [{ productId: f.product.id, quantity }] },
        amount: 90,
        pendingMoney: 90,
        reservedUntil: expiresAt,
        reservations: {
          create: {
            companyId: f.company.id,
            branchId: branch.id,
            productId: f.product.id,
            quantity,
            expiresAt,
            releasedAt,
          },
        },
      },
      include: { reservations: true },
    });
  }
  const readBalance = (id) => db.inventoryBalance.findUniqueOrThrow({ where: { id } });

  await check(
    'Idle expiry releases only owned expired holds, preserves pending money and audits once',
    async () => {
      const { branch, balance } = await branchFixture(10);
      const expired = await hold(branch, 3, past());
      const active = await hold(branch, 5, future());
      await sweep.sweep();
      await sweep.sweep();
      const after = await readBalance(balance.id);
      assert.equal(
        after.quantityReserved.toNumber(),
        7,
        'Live five plus two unrelated held units survive',
      );
      assert.equal(after.quantityOnHand.toNumber(), 100);
      assert.equal(after.physicalRevision, 17, 'Expiry is not a physical stock movement');
      const draft = await db.posDraft.findUniqueOrThrow({
        where: { id: expired.id },
        include: { decisions: true, reservations: true },
      });
      assert.equal(draft.status, 'NEEDS_ATTENTION');
      assert.equal(draft.revision, 2);
      assert.equal(draft.pendingMoney.toNumber(), 90);
      assert.equal(draft.decisions.length, 1);
      assert.equal(draft.decisions[0].action, 'EXPIRE');
      assert.equal(draft.decisions[0].metadata.system, true);
      assert.ok(draft.reservations[0].releasedAt);
      assert.equal(
        (
          await db.posDraftReservation.findUniqueOrThrow({
            where: { id: active.reservations[0].id },
          })
        ).releasedAt,
        null,
      );
      const audit = await db.auditLog.findMany({
        where: { entityId: expired.id, action: 'POS_DRAFT_EXPIRE' },
      });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].channel, 'SYSTEM');
      assert.equal(audit[0].userId, null, 'Expiry must not impersonate the cashier or reviewer');
      assert.equal(await db.inventoryMovement.count({ where: { branchId: branch.id } }), 0);
      assert.equal(await db.salesOrder.count({ where: { branchId: branch.id } }), 0);
      assert.equal(await db.journalEntry.count({ where: { branchId: branch.id } }), 0);
    },
  );

  await check(
    'Idle expiry completes draft state after an interruption between stock release and decision',
    async () => {
      const { branch, balance } = await branchFixture(0);
      const draft = await hold(branch, 3, past(), past());
      await sweep.sweep();
      await sweep.sweep();
      const after = await db.posDraft.findUniqueOrThrow({
        where: { id: draft.id },
        include: { decisions: true },
      });
      assert.equal(after.status, 'NEEDS_ATTENTION');
      assert.equal(after.revision, 2);
      assert.equal(after.decisions.length, 1);
      assert.equal((await readBalance(balance.id)).quantityReserved.toNumber(), 0);
    },
  );

  await check(
    'Expiry waits for stock lock then preserves a concurrently renewed reservation and current quantity',
    async () => {
      const { branch, balance } = await branchFixture(3);
      const draft = await hold(branch, 3, future());
      let releaseRenewal;
      const continueRenewal = new Promise((resolve) => {
        releaseRenewal = resolve;
      });
      let notifyLocked;
      const locked = new Promise((resolve) => {
        notifyLocked = resolve;
      });
      const name = 'pos-expiry-' + randomUUID();
      const renewal = db.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM inventory_balances WHERE id=${balance.id} FOR UPDATE`,
          );
          notifyLocked();
          await continueRenewal;
          const expiresAt = future();
          await tx.posDraftReservation.update({
            where: { id: draft.reservations[0].id },
            data: { quantity: 5, expiresAt },
          });
          await tx.inventoryBalance.update({
            where: { id: balance.id },
            data: { quantityReserved: 5 },
          });
          await tx.posDraft.update({ where: { id: draft.id }, data: { reservedUntil: expiresAt } });
        },
        { timeout: 15_000 },
      );
      await locked;
      // Make the old timestamp due only after renewal owns the stock lock, so
      // the API's scheduled sweep cannot steal the synthetic fixture first.
      await db.posDraftReservation.update({
        where: { id: draft.reservations[0].id },
        data: { expiresAt: past() },
      });
      await db.posDraft.update({ where: { id: draft.id }, data: { reservedUntil: past() } });
      const expiry = db.$transaction(
        async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT set_config('application_name', ${name}, true)`);
          const rows = await tx.$queryRaw(
            Prisma.sql`SELECT id, "companyId", "branchId", "productId", "quantityReserved" FROM inventory_balances WHERE id=${balance.id} FOR UPDATE`,
          );
          await releaseExpiredPosReservations(tx, rows[0]);
        },
        { timeout: 15_000 },
      );
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await db.$queryRaw(
            Prisma.sql`SELECT 1 FROM pg_stat_activity WHERE application_name=${name} AND wait_event_type='Lock'`,
          );
          if (rows.length) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.ok(
          waiting,
          'The proof must observe expiry blocked behind renewal, not a sequential simulation',
        );
      } finally {
        releaseRenewal();
        await Promise.all([renewal, expiry]);
      }
      const current = await readBalance(balance.id);
      assert.equal(current.quantityReserved.toNumber(), 5);
      assert.equal(
        (
          await db.posDraftReservation.findUniqueOrThrow({
            where: { id: draft.reservations[0].id },
          })
        ).releasedAt,
        null,
      );
      await sweep.sweep();
      assert.equal((await readBalance(balance.id)).quantityReserved.toNumber(), 5);
      assert.equal(
        (await db.posDraft.findUniqueOrThrow({ where: { id: draft.id } })).status,
        'AWAITING_STOCKIST',
      );
    },
  );

  await check(
    'An inconsistent held balance rolls back expiry claims and leaves unrelated expiry available',
    async () => {
      const { branch, balance } = await branchFixture(2);
      const draft = await hold(branch, 3, past());
      await assert.rejects(
        db.$transaction(async (tx) => {
          const rows = await tx.$queryRaw(
            Prisma.sql`SELECT id, "companyId", "branchId", "productId", "quantityReserved" FROM inventory_balances WHERE id=${balance.id} FOR UPDATE`,
          );
          await releaseExpiredPosReservations(tx, rows[0]);
        }),
        /reconciliation/,
      );
      const other = await branchFixture(4);
      const valid = await hold(other.branch, 4, past());
      await sweep.sweep();
      assert.equal(
        (
          await db.posDraftReservation.findUniqueOrThrow({
            where: { id: draft.reservations[0].id },
          })
        ).releasedAt,
        null,
      );
      assert.equal((await readBalance(balance.id)).quantityReserved.toNumber(), 2);
      assert.equal(
        (await db.posDraft.findUniqueOrThrow({ where: { id: draft.id } })).status,
        'AWAITING_STOCKIST',
      );
      assert.equal((await readBalance(other.balance.id)).quantityReserved.toNumber(), 0);
      assert.equal(
        (await db.posDraft.findUniqueOrThrow({ where: { id: valid.id } })).status,
        'NEEDS_ATTENTION',
      );
      // Reconcile the deliberately inconsistent synthetic fixture for later runs.
      await db.inventoryBalance.update({
        where: { id: balance.id },
        data: { quantityReserved: 3 },
      });
      await sweep.sweep();
    },
  );
};
