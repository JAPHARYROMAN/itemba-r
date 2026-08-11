import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessLevel,
  AuditSeverity,
  CashAccountType,
  CurrencyCode,
  MobilePosTerminalStatus,
  Prisma,
  SalesPaymentMethod,
  SalesType,
} from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateMobilePosTerminalDto,
  MOBILE_POS_LITE_RECEIPT_METHODS,
  MobilePosTerminalPaymentDto,
  QueryMobilePosTerminalDto,
  UpdateMobilePosTerminalDto,
} from './dto/mobile-pos-terminal.dto';
import { ActivateMobilePosTerminalDto } from './dto/mobile-pos-lite-session.dto';
import { CreateMobilePosLiteSaleDto } from './dto/mobile-pos-lite-sale.dto';

const ACTIVATION_TTL_MS = 20 * 60 * 1000;

const TERMINAL_INCLUDE = {
  company: { select: { id: true, name: true, code: true } },
  division: { select: { id: true, name: true, code: true } },
  branch: { select: { id: true, name: true, code: true } },
  assignedUser: { select: { id: true, fullName: true, status: true } },
  salesperson: { select: { id: true, fullName: true, employeeCode: true } },
  generalCustomer: { select: { id: true, name: true, customerCode: true } },
  paymentMethods: {
    orderBy: { paymentMethod: 'asc' as const },
    include: {
      cashAccount: {
        select: { id: true, accountName: true, accountType: true, currency: true, isActive: true },
      },
    },
  },
} satisfies Prisma.MobilePosTerminalInclude;

type Terminal = Prisma.MobilePosTerminalGetPayload<{ include: typeof TERMINAL_INCLUDE }>;
type PaymentInput = Pick<MobilePosTerminalPaymentDto, 'paymentMethod' | 'cashAccountId' | 'label'>;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function secureHashMatch(storedHash: string | null | undefined, suppliedValue: string | undefined) {
  if (!storedHash || !suppliedValue) return false;
  const stored = Buffer.from(storedHash, 'hex');
  const supplied = Buffer.from(sha256(suppliedValue), 'hex');
  return stored.length === supplied.length && timingSafeEqual(stored, supplied);
}

function newActivationCode() {
  return randomBytes(24).toString('base64url');
}

function newTerminalCode() {
  return `MPL-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function positivePrice(value: unknown) {
  const price = Number(value ?? 0);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function effectiveSellingPrice(product: {
  defaultSellingPrice?: unknown;
  retailPrice?: unknown;
  wholesalePrice?: unknown;
  productFamily?: {
    defaultSellingPrice?: unknown;
    retailPrice?: unknown;
    wholesalePrice?: unknown;
  } | null;
}) {
  return (
    positivePrice(product.defaultSellingPrice) ??
    positivePrice(product.retailPrice) ??
    positivePrice(product.wholesalePrice) ??
    positivePrice(product.productFamily?.defaultSellingPrice) ??
    positivePrice(product.productFamily?.retailPrice) ??
    positivePrice(product.productFamily?.wholesalePrice)
  );
}

function paymentLabel(paymentMethod: SalesPaymentMethod, configuredLabel?: string | null) {
  if (configuredLabel?.trim()) return configuredLabel.trim();
  switch (paymentMethod) {
    case SalesPaymentMethod.CASH:
      return 'Cash';
    case SalesPaymentMethod.MOBILE_MONEY:
      return 'Mobile Money';
    case SalesPaymentMethod.BANK_TRANSFER:
      return 'Bank';
    case SalesPaymentMethod.CREDIT:
      return 'Credit';
    default:
      return paymentMethod;
  }
}

@Injectable()
export class MobilePosLiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly auditLogs: AuditLogsService,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  async findTerminals(query: QueryMobilePosTerminalDto, user: AuthUser) {
    this.assertCanManage(user);
    const where: Prisma.MobilePosTerminalWhereInput = query.companyId
      ? { companyId: query.companyId }
      : {};
    if (query.companyId) {
      await this.companyScope.assertCanAccessCompany(user, query.companyId, AccessLevel.READ);
    }

    const data = await this.prisma.mobilePosTerminal.findMany({
      where,
      include: TERMINAL_INCLUDE,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return data.map((terminal) => this.serializeTerminal(terminal));
  }

  async createTerminal(dto: CreateMobilePosTerminalDto, user: AuthUser) {
    this.assertCanManage(user);
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.READ);

    const configuration = await this.validateConfiguration(dto);
    const activationCode = newActivationCode();
    const activationExpiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);

    let terminalCode = newTerminalCode();
    while (await this.prisma.mobilePosTerminal.findFirst({ where: { terminalCode } })) {
      terminalCode = newTerminalCode();
    }

    const terminal = await this.prisma.mobilePosTerminal.create({
      data: {
        terminalCode,
        name: dto.name.trim(),
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        assignedUserId: configuration.assignedUserId,
        salespersonId: dto.salespersonId,
        generalCustomerId: dto.generalCustomerId,
        creditEnabled: Boolean(dto.creditEnabled),
        offlineCashEnabled: Boolean(dto.offlineCashEnabled),
        activationTokenHash: sha256(activationCode),
        activationExpiresAt,
        paymentMethods: {
          create: configuration.paymentMethods.map((payment) => ({
            paymentMethod: payment.paymentMethod,
            cashAccountId: payment.cashAccountId,
            label: payment.label,
          })),
        },
      },
      include: TERMINAL_INCLUDE,
    });

    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_TERMINAL_CREATED',
      entityType: 'MobilePosTerminal',
      entityId: terminal.id,
      userId: user.id,
      companyId: terminal.companyId,
      severity: AuditSeverity.HIGH,
      newValue: {
        terminalCode: terminal.terminalCode,
        divisionId: terminal.divisionId,
        branchId: terminal.branchId,
        assignedUserId: terminal.assignedUserId,
      },
    });

    return {
      terminal: this.serializeTerminal(terminal),
      activation: this.activationPayload(
        terminal.terminalCode,
        activationCode,
        activationExpiresAt,
      ),
    };
  }

  async updateTerminal(id: string, dto: UpdateMobilePosTerminalDto, user: AuthUser) {
    this.assertCanManage(user);
    const existing = await this.findTerminalForManagement(id, user);
    const paymentInputs: PaymentInput[] =
      dto.paymentMethods ??
      existing.paymentMethods.map((payment) => ({
        paymentMethod: payment.paymentMethod as (typeof MOBILE_POS_LITE_RECEIPT_METHODS)[number],
        cashAccountId: payment.cashAccountId,
        label: payment.label ?? undefined,
      }));
    const configuration = await this.validateConfiguration({
      companyId: existing.companyId,
      divisionId: existing.divisionId,
      branchId: existing.branchId,
      salespersonId: dto.salespersonId ?? existing.salespersonId,
      generalCustomerId: dto.generalCustomerId ?? existing.generalCustomerId,
      paymentMethods: paymentInputs,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.paymentMethods) {
        await tx.mobilePosTerminalPayment.deleteMany({ where: { terminalId: existing.id } });
      }
      return tx.mobilePosTerminal.update({
        where: { id: existing.id },
        data: {
          name: (dto.name ?? existing.name).trim(),
          assignedUserId: configuration.assignedUserId,
          salespersonId: dto.salespersonId ?? existing.salespersonId,
          generalCustomerId: dto.generalCustomerId ?? existing.generalCustomerId,
          creditEnabled: dto.creditEnabled ?? existing.creditEnabled,
          offlineCashEnabled: dto.offlineCashEnabled ?? existing.offlineCashEnabled,
          configVersion: { increment: 1 },
          ...(dto.paymentMethods
            ? {
                paymentMethods: {
                  create: configuration.paymentMethods.map((payment) => ({
                    paymentMethod: payment.paymentMethod,
                    cashAccountId: payment.cashAccountId,
                    label: payment.label,
                  })),
                },
              }
            : {}),
        },
        include: TERMINAL_INCLUDE,
      });
    });

    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_TERMINAL_UPDATED',
      entityType: 'MobilePosTerminal',
      entityId: updated.id,
      userId: user.id,
      companyId: updated.companyId,
      severity: AuditSeverity.HIGH,
    });
    return this.serializeTerminal(updated);
  }

  async updateTerminalStatus(id: string, status: MobilePosTerminalStatus, user: AuthUser) {
    this.assertCanManage(user);
    const existing = await this.findTerminalForManagement(id, user);
    if (
      existing.status === MobilePosTerminalStatus.REVOKED &&
      status !== MobilePosTerminalStatus.REVOKED
    ) {
      throw new BadRequestException(
        'A revoked terminal must be replaced with a newly activated device',
      );
    }
    const updated = await this.prisma.mobilePosTerminal.update({
      where: { id: existing.id },
      data: {
        status,
        ...(status !== MobilePosTerminalStatus.ACTIVE
          ? { activationTokenHash: null, activationExpiresAt: null }
          : {}),
        ...(status === MobilePosTerminalStatus.REVOKED
          ? { deviceSecretHash: null, deviceName: null }
          : {}),
      },
      include: TERMINAL_INCLUDE,
    });
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_TERMINAL_STATUS_CHANGED',
      entityType: 'MobilePosTerminal',
      entityId: updated.id,
      userId: user.id,
      companyId: updated.companyId,
      severity: AuditSeverity.HIGH,
      newValue: { status },
    });
    return this.serializeTerminal(updated);
  }

  async issueActivation(id: string, user: AuthUser) {
    this.assertCanManage(user);
    const existing = await this.findTerminalForManagement(id, user);
    if (existing.status !== MobilePosTerminalStatus.ACTIVE) {
      throw new BadRequestException('Only active terminals can be activated');
    }

    const activationCode = newActivationCode();
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);
    const terminal = await this.prisma.mobilePosTerminal.update({
      where: { id: existing.id },
      data: {
        activationTokenHash: sha256(activationCode),
        activationExpiresAt: expiresAt,
      },
      select: { terminalCode: true },
    });
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_ACTIVATION_ISSUED',
      entityType: 'MobilePosTerminal',
      entityId: existing.id,
      userId: user.id,
      companyId: existing.companyId,
      severity: AuditSeverity.HIGH,
    });
    return this.activationPayload(terminal.terminalCode, activationCode, expiresAt);
  }

  async activate(dto: ActivateMobilePosTerminalDto, user: AuthUser) {
    const terminal = await this.prisma.mobilePosTerminal.findFirst({
      where: { terminalCode: dto.terminalCode.trim() },
      include: TERMINAL_INCLUDE,
    });
    if (!terminal || terminal.status !== MobilePosTerminalStatus.ACTIVE) {
      throw new NotFoundException('Mobile POS terminal is not available');
    }
    await this.assertAssignedUserCanSell(terminal, user);
    if (!terminal.activationExpiresAt || terminal.activationExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'This activation code has expired. Ask the group admin for a new code.',
      );
    }
    if (!secureHashMatch(terminal.activationTokenHash, dto.activationCode)) {
      throw new ForbiddenException('Invalid Mobile POS activation code');
    }

    // Atomic one-time claim prevents the same QR code from binding a second device.
    const claimed = await this.prisma.mobilePosTerminal.updateMany({
      where: {
        id: terminal.id,
        activationTokenHash: terminal.activationTokenHash,
        activationExpiresAt: { gte: new Date() },
      },
      data: {
        deviceSecretHash: sha256(dto.deviceSecret),
        deviceName: dto.deviceName?.trim() || null,
        activationTokenHash: null,
        activationExpiresAt: null,
        activatedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException(
        'This activation code has already been used. Ask the group admin for a new code.',
      );
    }

    const active = await this.requireTerminal(dto.terminalCode, dto.deviceSecret, user);
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_TERMINAL_ACTIVATED',
      entityType: 'MobilePosTerminal',
      entityId: active.id,
      userId: user.id,
      companyId: active.companyId,
      severity: AuditSeverity.HIGH,
    });
    return this.sessionPayload(active);
  }

  async session(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    return this.sessionPayload(terminal);
  }

  async products(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    search: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const term = search?.trim() ?? '';

    const searchTerms: Prisma.ProductWhereInput[] = [
      { barcode: { equals: term, mode: 'insensitive' } },
      { productCode: { contains: term, mode: 'insensitive' } },
      { sku: { contains: term, mode: 'insensitive' } },
      { name: { contains: term, mode: 'insensitive' } },
    ];
    const products = await this.prisma.product.findMany({
      where: {
        companyId: terminal.companyId,
        status: 'ACTIVE',
        AND: [
          { OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] },
          ...(term ? [{ OR: searchTerms }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        productCode: true,
        sku: true,
        barcode: true,
        baseUnitId: true,
        productType: true,
        trackInventory: true,
        defaultSellingPrice: true,
        retailPrice: true,
        wholesalePrice: true,
        baseUnit: { select: { id: true, name: true, symbol: true } },
        productFamily: {
          select: { defaultSellingPrice: true, retailPrice: true, wholesalePrice: true },
        },
      },
      orderBy: { name: 'asc' },
      // A bounded catalogue snapshot gives the installed PWA a useful offline
      // starting point. Searches stay deliberately small for fast counter use.
      take: term ? 12 : 1500,
    });
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        branchId: terminal.branchId,
        productId: { in: products.map((product) => product.id) },
      },
      select: { productId: true, quantityOnHand: true, quantityReserved: true },
    });
    const availability = new Map(
      balances.map((balance) => [
        balance.productId,
        Math.max(0, Number(balance.quantityOnHand) - Number(balance.quantityReserved)),
      ]),
    );

    return products
      .map((product) => {
        const sellingPrice = effectiveSellingPrice(product);
        if (sellingPrice == null) return null;
        return {
          id: product.id,
          name: product.name,
          code: product.productCode ?? product.sku ?? product.barcode ?? '',
          barcode: product.barcode,
          unitId: product.baseUnitId,
          unitSymbol: product.baseUnit?.symbol ?? '',
          sellingPrice,
          availableStock: product.trackInventory ? (availability.get(product.id) ?? 0) : null,
          trackInventory: product.trackInventory,
        };
      })
      .filter((product): product is NonNullable<typeof product> => product !== null);
  }

  async customers(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    search: string | undefined,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    if (!terminal.creditEnabled) return [];
    const term = search?.trim() ?? '';
    if (term.length < 2) return [];

    return this.prisma.customer.findMany({
      where: {
        companyId: terminal.companyId,
        status: 'ACTIVE',
        AND: [
          { OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] },
          { OR: [{ branchId: terminal.branchId }, { branchId: null }] },
          {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { customerCode: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        customerCode: true,
        phone: true,
        creditLimit: true,
        currentBalance: true,
      },
      orderBy: { name: 'asc' },
      take: 12,
    });
  }

  async createSale(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    dto: CreateMobilePosLiteSaleDto,
    user: AuthUser,
  ) {
    const terminal = await this.requireTerminal(terminalCode, deviceSecret, user);
    const paymentMethod = dto.paymentMethod;
    const isCredit = paymentMethod === SalesPaymentMethod.CREDIT;
    if (isCredit && !terminal.creditEnabled) {
      throw new ForbiddenException('Credit is not enabled on this Mobile POS terminal');
    }
    if (isCredit && !dto.customerId) {
      throw new BadRequestException('Select the customer before completing a credit sale');
    }
    if (isCredit) {
      const selectedCustomer = await this.prisma.customer.findFirst({
        where: {
          id: dto.customerId,
          companyId: terminal.companyId,
          status: 'ACTIVE',
          AND: [
            { OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] },
            { OR: [{ branchId: terminal.branchId }, { branchId: null }] },
          ],
        },
        select: { id: true },
      });
      if (!selectedCustomer) {
        throw new BadRequestException(
          'The selected customer is not available for this terminal branch',
        );
      }
    }

    const payment = isCredit
      ? null
      : terminal.paymentMethods.find(
          (configured) => configured.isEnabled && configured.paymentMethod === paymentMethod,
        );
    if (!isCredit && !payment) {
      throw new ForbiddenException(
        'This payment method is not enabled on this Mobile POS terminal',
      );
    }

    const lines = await this.resolveSaleLines(terminal, dto.lines);
    const sale = await this.salesOrders.mobilePosLiteQuickSale(
      {
        companyId: terminal.companyId,
        divisionId: terminal.divisionId,
        branchId: terminal.branchId,
        customerId: isCredit ? dto.customerId : terminal.generalCustomerId,
        salesType: isCredit ? SalesType.CREDIT_SALE : SalesType.CASH_SALE,
        orderDate: new Date().toISOString(),
        currency: CurrencyCode.TZS,
        paymentMethod,
        cashAccountId: payment?.cashAccountId,
        paymentReference: dto.paymentReference?.trim() || undefined,
        salespersonId: terminal.salespersonId,
        idempotencyKey: dto.idempotencyKey,
        lines,
      },
      user,
      terminal.id,
      terminal.terminalCode,
    );

    await this.prisma.mobilePosTerminal.update({
      where: { id: terminal.id },
      data: { lastSeenAt: new Date() },
    });
    await this.auditLogs.log({
      action: 'MOBILE_POS_LITE_SALE_COMPLETED',
      entityType: 'SalesOrder',
      entityId: sale.id,
      userId: user.id,
      companyId: terminal.companyId,
      severity: AuditSeverity.MEDIUM,
      newValue: { terminalCode: terminal.terminalCode, paymentMethod },
    });
    return sale;
  }

  private async resolveSaleLines(terminal: Terminal, lines: CreateMobilePosLiteSaleDto['lines']) {
    const quantities = new Map<string, number>();
    for (const line of lines) {
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + Number(line.quantity));
    }
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: Array.from(quantities.keys()) },
        companyId: terminal.companyId,
        status: 'ACTIVE',
        AND: [{ OR: [{ divisionId: terminal.divisionId }, { divisionId: null }] }],
      },
      select: {
        id: true,
        name: true,
        baseUnitId: true,
        defaultSellingPrice: true,
        retailPrice: true,
        wholesalePrice: true,
        productFamily: {
          select: { defaultSellingPrice: true, retailPrice: true, wholesalePrice: true },
        },
      },
    });
    if (products.length !== quantities.size) {
      throw new BadRequestException('One or more products are unavailable for this terminal');
    }

    return products.map((product) => {
      const unitPrice = effectiveSellingPrice(product);
      if (unitPrice == null) {
        throw new BadRequestException(`${product.name} does not have a selling price`);
      }
      return {
        productId: product.id,
        description: product.name,
        quantity: quantities.get(product.id) ?? 0,
        unitId: product.baseUnitId,
        unitPrice,
        discountAmount: 0,
        taxAmount: 0,
      };
    });
  }

  private async requireTerminal(
    terminalCode: string | undefined,
    deviceSecret: string | undefined,
    user: AuthUser,
  ) {
    if (!terminalCode || !deviceSecret) {
      throw new ForbiddenException('Activate this Mobile POS device before selling');
    }
    const terminal = await this.prisma.mobilePosTerminal.findFirst({
      where: { terminalCode: terminalCode.trim() },
      include: TERMINAL_INCLUDE,
    });
    if (!terminal || terminal.status !== MobilePosTerminalStatus.ACTIVE) {
      throw new ForbiddenException('This Mobile POS terminal is not active');
    }
    await this.assertAssignedUserCanSell(terminal, user);
    if (!secureHashMatch(terminal.deviceSecretHash, deviceSecret)) {
      throw new ForbiddenException(
        'This device is not registered for the selected Mobile POS terminal',
      );
    }
    return terminal;
  }

  private async assertAssignedUserCanSell(terminal: Terminal, user: AuthUser) {
    if (terminal.assignedUserId !== user.id) {
      throw new ForbiddenException('This Mobile POS terminal is assigned to a different sales rep');
    }
    if (terminal.assignedUser.status !== 'ACTIVE') {
      throw new ForbiddenException('The assigned Mobile POS user is not active');
    }
    await this.companyScope.assertCanAccessCompany(user, terminal.companyId, AccessLevel.WRITE);
  }

  private async findTerminalForManagement(id: string, user: AuthUser) {
    const terminal = await this.prisma.mobilePosTerminal.findFirst({
      where: { id },
      include: TERMINAL_INCLUDE,
    });
    if (!terminal) throw new NotFoundException('Mobile POS terminal not found');
    await this.companyScope.assertCanAccessCompany(user, terminal.companyId, AccessLevel.READ);
    return terminal;
  }

  private assertCanManage(user: AuthUser) {
    this.companyScope.assertGroupScoped(user, 'provision Mobile POS Lite terminals');
  }

  private async validateConfiguration(dto: {
    companyId: string;
    divisionId: string;
    branchId: string;
    salespersonId: string;
    generalCustomerId: string;
    paymentMethods: PaymentInput[];
  }) {
    const [division, branch, salesperson, generalCustomer] = await Promise.all([
      this.prisma.division.findFirst({
        where: { id: dto.divisionId, companyId: dto.companyId, isActive: true },
        select: { id: true },
      }),
      this.prisma.branch.findFirst({
        where: { id: dto.branchId, divisionId: dto.divisionId, isActive: true },
        select: { id: true },
      }),
      this.prisma.employee.findFirst({
        where: { id: dto.salespersonId, companyId: dto.companyId, employmentStatus: 'ACTIVE' },
        select: { id: true, userId: true, divisionId: true, branchId: true },
      }),
      this.prisma.customer.findFirst({
        where: { id: dto.generalCustomerId, companyId: dto.companyId, status: 'ACTIVE' },
        select: { id: true, divisionId: true, branchId: true },
      }),
    ]);
    if (!division)
      throw new BadRequestException('Division does not belong to the selected company');
    if (!branch) throw new BadRequestException('Branch does not belong to the selected division');
    if (!salesperson?.userId) {
      throw new BadRequestException(
        'The selected sales rep must be an active employee linked to a user account',
      );
    }
    if (
      (salesperson.divisionId && salesperson.divisionId !== dto.divisionId) ||
      (salesperson.branchId && salesperson.branchId !== dto.branchId)
    ) {
      throw new BadRequestException(
        'The selected sales rep is not assigned to this division and branch',
      );
    }
    if (!generalCustomer)
      throw new BadRequestException('General Customer does not belong to the selected company');
    if (
      (generalCustomer.divisionId && generalCustomer.divisionId !== dto.divisionId) ||
      (generalCustomer.branchId && generalCustomer.branchId !== dto.branchId)
    ) {
      throw new BadRequestException(
        'General Customer does not belong to the selected division and branch',
      );
    }

    const paymentMethods = await this.validatePaymentMethods(
      dto.companyId,
      dto.divisionId,
      dto.branchId,
      dto.paymentMethods,
    );
    return { assignedUserId: salesperson.userId, paymentMethods };
  }

  private async validatePaymentMethods(
    companyId: string,
    divisionId: string,
    branchId: string,
    paymentInputs: PaymentInput[],
  ) {
    const methods = new Set(paymentInputs.map((payment) => payment.paymentMethod));
    if (methods.size !== paymentInputs.length) {
      throw new BadRequestException('A payment method can only be configured once per terminal');
    }
    if (!methods.has(SalesPaymentMethod.CASH)) {
      throw new BadRequestException('Cash must be configured for every Mobile POS Lite terminal');
    }
    const accounts = await this.prisma.cashAccount.findMany({
      where: {
        id: { in: paymentInputs.map((payment) => payment.cashAccountId) },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, companyId: true, divisionId: true, branchId: true, accountType: true },
    });
    if (accounts.length !== paymentInputs.length) {
      throw new BadRequestException(
        'One or more configured receipt accounts are inactive or missing',
      );
    }
    const accountsById = new Map(accounts.map((account) => [account.id, account]));

    return paymentInputs.map((payment) => {
      const account = accountsById.get(payment.cashAccountId)!;
      if (account.companyId !== companyId) {
        throw new BadRequestException('Receipt account does not belong to the selected company');
      }
      const expectedTypes = this.accountTypesFor(payment.paymentMethod);
      if (!expectedTypes.includes(account.accountType)) {
        throw new BadRequestException('Receipt account type does not match its payment method');
      }
      if (account.accountType === CashAccountType.BANK) {
        if (
          (account.divisionId && account.divisionId !== divisionId) ||
          (account.branchId && account.branchId !== branchId)
        ) {
          throw new BadRequestException(
            'Bank account does not belong to the selected terminal scope',
          );
        }
      } else if (account.divisionId !== divisionId || account.branchId !== branchId) {
        throw new BadRequestException(
          'Cash or mobile-money account must belong to the selected division and branch',
        );
      }
      return payment;
    });
  }

  private accountTypesFor(
    paymentMethod: (typeof MOBILE_POS_LITE_RECEIPT_METHODS)[number],
  ): CashAccountType[] {
    switch (paymentMethod) {
      case SalesPaymentMethod.CASH:
        return [CashAccountType.CASH_ON_HAND, CashAccountType.PETTY_CASH];
      case SalesPaymentMethod.MOBILE_MONEY:
        return [CashAccountType.MOBILE_MONEY];
      case SalesPaymentMethod.BANK_TRANSFER:
        return [CashAccountType.BANK];
      default:
        return [];
    }
  }

  private activationPayload(terminalCode: string, activationCode: string, expiresAt: Date) {
    return {
      terminalCode,
      activationCode,
      expiresAt: expiresAt.toISOString(),
      activationPath: `/mobile-pos/activate?terminal=${encodeURIComponent(terminalCode)}&code=${encodeURIComponent(activationCode)}`,
    };
  }

  private sessionPayload(terminal: Terminal) {
    return {
      terminal: {
        id: terminal.id,
        code: terminal.terminalCode,
        name: terminal.name,
        configVersion: terminal.configVersion,
        offlineCashEnabled: terminal.offlineCashEnabled,
      },
      company: terminal.company,
      division: terminal.division,
      branch: terminal.branch,
      rep: { id: terminal.assignedUser.id, name: terminal.assignedUser.fullName },
      paymentMethods: [
        ...terminal.paymentMethods
          .filter((payment) => payment.isEnabled && payment.cashAccount.isActive)
          .map((payment) => ({
            code: payment.paymentMethod,
            label: paymentLabel(payment.paymentMethod, payment.label),
            requiresReference: payment.paymentMethod !== SalesPaymentMethod.CASH,
          })),
        ...(terminal.creditEnabled
          ? [{ code: SalesPaymentMethod.CREDIT, label: 'Credit', requiresReference: false }]
          : []),
      ],
      generalCustomer: { name: terminal.generalCustomer.name },
    };
  }

  private serializeTerminal(terminal: Terminal) {
    return {
      id: terminal.id,
      code: terminal.terminalCode,
      name: terminal.name,
      status: terminal.status,
      configVersion: terminal.configVersion,
      creditEnabled: terminal.creditEnabled,
      offlineCashEnabled: terminal.offlineCashEnabled,
      deviceName: terminal.deviceName,
      activatedAt: terminal.activatedAt,
      lastSeenAt: terminal.lastSeenAt,
      company: terminal.company,
      division: terminal.division,
      branch: terminal.branch,
      assignedUser: { id: terminal.assignedUser.id, name: terminal.assignedUser.fullName },
      salesperson: terminal.salesperson,
      generalCustomer: terminal.generalCustomer,
      paymentMethods: terminal.paymentMethods.map((payment) => ({
        paymentMethod: payment.paymentMethod,
        label: paymentLabel(payment.paymentMethod, payment.label),
        isEnabled: payment.isEnabled,
        cashAccount: payment.cashAccount,
      })),
      createdAt: terminal.createdAt,
      updatedAt: terminal.updatedAt,
    };
  }
}
