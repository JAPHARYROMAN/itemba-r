import { PrismaService } from '../src/prisma/prisma.service';

export interface CrudWestsidesReportReadSeedInput {
  companyAId: string;
  companyBId: string;
  divisionAId: string;
  divisionBId: string;
  creatorUserId: string;
  suffix: string;
}

export interface CrudWestsidesReportReadSeed {
  branchAId: string;
  branchBId: string;
  salesDateA: string;
  salesDateB: string;
  bindings: ReadonlyMap<string, unknown>;
}

interface CompanySeedValues {
  company: 'A' | 'B';
  companyId: string;
  divisionId: string;
  branchId: string;
  unitId: string;
  soldProductId: string;
  slowProductId: string;
  customerId: string;
  supplierId: string;
  salespersonId: string;
  salesOrderId: string;
  purchaseOrderId: string;
  values: Readonly<Record<string, string | number>>;
}

/**
 * Seeds two conflicting, independently queryable business histories. The
 * records use real Itemba relations and calculations; no test-only response
 * hook or scope echo participates in the evidence.
 */
export async function seedCrudWestsidesReportReadControls(
  prisma: PrismaService,
  input: CrudWestsidesReportReadSeedInput,
): Promise<CrudWestsidesReportReadSeed> {
  const marker = input.suffix.toUpperCase();
  const salesDateA = '2077-04-17';
  const salesDateB = '2077-07-23';

  const [branchA, branchB] = await Promise.all([
    prisma.branch.create({
      data: {
        divisionId: input.divisionAId,
        code: `WRBA${marker}`,
        name: `Westsides Report Branch A ${marker}`,
        type: 'BRANCH',
      },
    }),
    prisma.branch.create({
      data: {
        divisionId: input.divisionBId,
        code: `WRBB${marker}`,
        name: `Westsides Report Branch B ${marker}`,
        type: 'BRANCH',
      },
    }),
  ]);

  const [companyA, companyB] = await Promise.all([
    seedCompanyHistory(prisma, {
      company: 'A',
      companyId: input.companyAId,
      divisionId: input.divisionAId,
      branchId: branchA.id,
      creatorUserId: input.creatorUserId,
      marker,
      salesDate: salesDateA,
      salesType: 'WHOLESALE',
      salesOrderTotal: 123.45,
      salesOrderPaid: 100,
      salesOrderOutstanding: 23.45,
      salesLineQuantity: 3,
      salesLineAmount: 120,
      purchaseOrderTotal: 222.22,
      purchaseOrderPaid: 200,
      purchaseOrderOutstanding: 22.22,
      purchaseLineQuantity: 5,
      purchaseLineAmount: 210,
      batchInitialQuantity: 20,
      batchRemainingQuantity: 12,
      batchUnitCost: 25,
      damageType: 'BREAKAGE',
      damageStatus: 'APPROVED',
      damageQuantity: 2.5,
      damageEstimatedValue: 50,
      packageOwedByCustomer: 4,
      packageOwedToCustomer: 1,
      packageDepositBalance: 60,
      quotationStatus: 'SENT',
      deliveryStatus: 'PARTIALLY_DELIVERED',
      priceListStatus: 'ACTIVE',
      slowQuantityOnHand: 11,
      slowTotalValue: 110,
      receivableAmount: 300,
      receivableOutstanding: 125,
    }),
    seedCompanyHistory(prisma, {
      company: 'B',
      companyId: input.companyBId,
      divisionId: input.divisionBId,
      branchId: branchB.id,
      creatorUserId: input.creatorUserId,
      marker,
      salesDate: salesDateB,
      salesType: 'SERVICE',
      salesOrderTotal: 987.65,
      salesOrderPaid: 900,
      salesOrderOutstanding: 87.65,
      salesLineQuantity: 7,
      salesLineAmount: 980,
      purchaseOrderTotal: 888.88,
      purchaseOrderPaid: 800,
      purchaseOrderOutstanding: 88.88,
      purchaseLineQuantity: 8,
      purchaseLineAmount: 840,
      batchInitialQuantity: 30,
      batchRemainingQuantity: 9,
      batchUnitCost: 100,
      damageType: 'THEFT',
      damageStatus: 'POSTED',
      damageQuantity: 9,
      damageEstimatedValue: 900,
      packageOwedByCustomer: 9,
      packageOwedToCustomer: 2,
      packageDepositBalance: 500,
      quotationStatus: 'EXPIRED',
      deliveryStatus: 'DELIVERED',
      priceListStatus: 'INACTIVE',
      slowQuantityOnHand: 22,
      slowTotalValue: 440,
      receivableAmount: 900,
      receivableOutstanding: 777,
    }),
  ]);

  const bindings = new Map<string, unknown>();
  for (const seeded of [companyA, companyB]) {
    for (const [name, value] of Object.entries(seeded.values)) {
      const key = `${name}${seeded.company}`;
      if (bindings.has(key)) throw new Error(`Duplicate Westsides report binding ${key}.`);
      bindings.set(key, value);
    }
  }

  return Object.freeze({
    branchAId: branchA.id,
    branchBId: branchB.id,
    salesDateA,
    salesDateB,
    bindings,
  });
}

interface CompanyHistoryInput {
  company: 'A' | 'B';
  companyId: string;
  divisionId: string;
  branchId: string;
  creatorUserId: string;
  marker: string;
  salesDate: string;
  salesType: 'WHOLESALE' | 'SERVICE';
  salesOrderTotal: number;
  salesOrderPaid: number;
  salesOrderOutstanding: number;
  salesLineQuantity: number;
  salesLineAmount: number;
  purchaseOrderTotal: number;
  purchaseOrderPaid: number;
  purchaseOrderOutstanding: number;
  purchaseLineQuantity: number;
  purchaseLineAmount: number;
  batchInitialQuantity: number;
  batchRemainingQuantity: number;
  batchUnitCost: number;
  damageType: 'BREAKAGE' | 'THEFT';
  damageStatus: 'APPROVED' | 'POSTED';
  damageQuantity: number;
  damageEstimatedValue: number;
  packageOwedByCustomer: number;
  packageOwedToCustomer: number;
  packageDepositBalance: number;
  quotationStatus: 'SENT' | 'EXPIRED';
  deliveryStatus: 'PARTIALLY_DELIVERED' | 'DELIVERED';
  priceListStatus: 'ACTIVE' | 'INACTIVE';
  slowQuantityOnHand: number;
  slowTotalValue: number;
  receivableAmount: number;
  receivableOutstanding: number;
}

async function seedCompanyHistory(
  prisma: PrismaService,
  input: CompanyHistoryInput,
): Promise<CompanySeedValues> {
  const company = input.company;
  const marker = `${company}${input.marker}`;
  const salesLineAveragePrice = input.salesLineAmount / input.salesLineQuantity;
  const purchaseLineUnitCost = input.purchaseLineAmount / input.purchaseLineQuantity;
  const salesMonth = input.salesDate.slice(0, 7);

  const [unit, category, customer, supplier, salesperson] = await Promise.all([
    prisma.unitOfMeasure.create({
      data: {
        companyId: input.companyId,
        name: `Westsides Report Unit ${marker}`,
        symbol: `WRU${marker.slice(-5)}`,
      },
    }),
    prisma.productCategory.create({
      data: {
        companyId: input.companyId,
        name: `Westsides Report Category ${marker}`,
      },
    }),
    prisma.customer.create({
      data: {
        companyId: input.companyId,
        divisionId: input.divisionId,
        branchId: input.branchId,
        customerCode: `WRC${marker}`,
        name: `Westsides Report Customer ${marker}`,
        creditLimit: 5000,
        currentBalance: input.receivableOutstanding,
      },
    }),
    prisma.supplier.create({
      data: {
        companyId: input.companyId,
        divisionId: input.divisionId,
        branchId: input.branchId,
        supplierCode: `WRS${marker}`,
        name: `Westsides Report Supplier ${marker}`,
        creditLimit: 5000,
        currentBalance: input.purchaseOrderOutstanding,
      },
    }),
    prisma.employee.create({
      data: {
        employeeCode: `WRE${marker}`,
        companyId: input.companyId,
        divisionId: input.divisionId,
        branchId: input.branchId,
        firstName: 'Westsides',
        lastName: `Report ${marker}`,
        fullName: `Westsides Report Salesperson ${marker}`,
      },
    }),
  ]);

  const [soldProduct, slowProduct] = await Promise.all([
    prisma.product.create({
      data: {
        productCode: `WRP${marker}`,
        companyId: input.companyId,
        divisionId: input.divisionId,
        categoryId: category.id,
        name: `Westsides Report Sold Product ${marker}`,
        sku: `WRSKU${marker}`,
        baseUnitId: unit.id,
        defaultPurchasePrice: input.batchUnitCost,
        defaultSellingPrice: salesLineAveragePrice,
      },
    }),
    prisma.product.create({
      data: {
        productCode: `WRSL${marker}`,
        companyId: input.companyId,
        divisionId: input.divisionId,
        categoryId: category.id,
        name: `Westsides Report Slow Product ${marker}`,
        sku: `WRSS${marker}`,
        baseUnitId: unit.id,
        defaultPurchasePrice: input.slowTotalValue / input.slowQuantityOnHand,
      },
    }),
  ]);

  const salesOrderNumber = `WRSO${marker}`;
  const purchaseOrderNumber = `WRPO${marker}`;
  const [salesOrder, purchaseOrder] = await Promise.all([
    prisma.salesOrder.create({
      data: {
        salesOrderNumber,
        companyId: input.companyId,
        divisionId: input.divisionId,
        branchId: input.branchId,
        customerId: customer.id,
        customerName: customer.name,
        salesType: input.salesType,
        orderDate: new Date(`${input.salesDate}T12:00:00.000Z`),
        subtotal: input.salesLineAmount,
        totalAmount: input.salesOrderTotal,
        paidAmount: input.salesOrderPaid,
        outstandingAmount: input.salesOrderOutstanding,
        status: 'CONFIRMED',
        paymentStatus: 'PARTIALLY_PAID',
        paymentMethod: 'CREDIT',
        createdById: input.creatorUserId,
        salespersonId: salesperson.id,
        lines: {
          create: {
            productId: soldProduct.id,
            description: `Westsides report sold line ${marker}`,
            quantity: input.salesLineQuantity,
            unitId: unit.id,
            unitPrice: salesLineAveragePrice,
            lineTotal: input.salesLineAmount,
          },
        },
      },
    }),
    prisma.purchaseOrder.create({
      data: {
        purchaseOrderNumber,
        companyId: input.companyId,
        divisionId: input.divisionId,
        branchId: input.branchId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        orderDate: new Date(`${input.salesDate}T09:00:00.000Z`),
        subtotal: input.purchaseLineAmount,
        totalAmount: input.purchaseOrderTotal,
        paidAmount: input.purchaseOrderPaid,
        outstandingAmount: input.purchaseOrderOutstanding,
        status: 'CONFIRMED',
        paymentStatus: 'PARTIALLY_PAID',
        createdById: input.creatorUserId,
        lines: {
          create: {
            productId: soldProduct.id,
            description: `Westsides report purchase line ${marker}`,
            quantity: input.purchaseLineQuantity,
            unitId: unit.id,
            unitCost: purchaseLineUnitCost,
            lineTotal: input.purchaseLineAmount,
          },
        },
      },
    }),
  ]);

  const batchNumber = `WRBATCH${marker}`;
  const packageCode = `WRPKG${marker}`;
  const priceListName = `Westsides Report Price List ${marker}`;

  const [batch, returnablePackage, priceList] = await Promise.all([
    prisma.productBatch.create({
      data: {
        batchNumber,
        companyId: input.companyId,
        productId: soldProduct.id,
        branchId: input.branchId,
        supplierId: supplier.id,
        purchaseOrderId: purchaseOrder.id,
        receivedDate: new Date(`${input.salesDate}T10:00:00.000Z`),
        expiryDate: new Date('2099-12-31T00:00:00.000Z'),
        initialQuantity: input.batchInitialQuantity,
        remainingQuantity: input.batchRemainingQuantity,
        unitId: unit.id,
        unitCost: input.batchUnitCost,
        status: 'ACTIVE',
      },
    }),
    // CustomerPackageBalance currently shares this FK with its legacy unit
    // relation. Matching the package UUID to the real unit UUID satisfies both
    // declared constraints without bypassing Prisma or the database.
    prisma.returnablePackage.create({
      data: {
        id: unit.id,
        packageCode,
        companyId: input.companyId,
        productId: soldProduct.id,
        packageType: company === 'A' ? 'EMPTY_CRATE' : 'PALLET',
        name: `Westsides Report Package ${marker}`,
        depositValue: input.packageDepositBalance,
        unitId: unit.id,
      },
    }),
    prisma.priceList.create({
      data: {
        companyId: input.companyId,
        name: priceListName,
        priceListType: company === 'A' ? 'WHOLESALE' : 'PROMOTIONAL',
        effectiveFrom: new Date('2077-01-01T00:00:00.000Z'),
        status: input.priceListStatus,
        createdById: input.creatorUserId,
      },
    }),
  ]);

  await Promise.all([
    prisma.inventoryBalance.create({
      data: {
        companyId: input.companyId,
        divisionId: input.divisionId,
        branchId: input.branchId,
        productId: slowProduct.id,
        quantityOnHand: input.slowQuantityOnHand,
        averageCost: input.slowTotalValue / input.slowQuantityOnHand,
        totalValue: input.slowTotalValue,
        lastMovementAt: new Date('2070-01-01T00:00:00.000Z'),
      },
    }),
    prisma.stockDamage.create({
      data: {
        damageNumber: `WRD${marker}`,
        companyId: input.companyId,
        branchId: input.branchId,
        productId: soldProduct.id,
        batchId: batch.id,
        quantity: input.damageQuantity,
        unitId: unit.id,
        damageType: input.damageType,
        estimatedValue: input.damageEstimatedValue,
        reportedById: input.creatorUserId,
        status: input.damageStatus,
      },
    }),
    prisma.customerPackageBalance.create({
      data: {
        companyId: input.companyId,
        customerId: customer.id,
        returnablePackageId: returnablePackage.id,
        quantityOwedByCustomer: input.packageOwedByCustomer,
        quantityOwedToCustomer: input.packageOwedToCustomer,
        depositBalance: input.packageDepositBalance,
      },
    }),
    prisma.quotation.create({
      data: {
        quotationNumber: `WRQ${marker}`,
        companyId: input.companyId,
        divisionId: input.divisionId,
        branchId: input.branchId,
        customerId: customer.id,
        customerName: customer.name,
        quotationDate: new Date(`${input.salesDate}T08:00:00.000Z`),
        totalAmount: input.salesOrderTotal,
        status: input.quotationStatus,
        createdById: input.creatorUserId,
      },
    }),
    prisma.deliveryNote.create({
      data: {
        deliveryNoteNumber: `WRDN${marker}`,
        companyId: input.companyId,
        branchId: input.branchId,
        salesOrderId: salesOrder.id,
        customerId: customer.id,
        customerName: customer.name,
        deliveryDate: new Date(`${input.salesDate}T14:00:00.000Z`),
        status: input.deliveryStatus,
        createdById: input.creatorUserId,
      },
    }),
    prisma.priceListItem.create({
      data: {
        priceListId: priceList.id,
        productId: soldProduct.id,
        unitId: unit.id,
        price: salesLineAveragePrice,
      },
    }),
    prisma.receivable.create({
      data: {
        receivableNumber: `WRR${marker}`,
        companyId: input.companyId,
        divisionId: input.divisionId,
        branchId: input.branchId,
        customerId: customer.id,
        customerName: customer.name,
        amount: input.receivableAmount,
        outstandingAmount: input.receivableOutstanding,
        issueDate: new Date(`${input.salesDate}T00:00:00.000Z`),
        status: 'OPEN',
      },
    }),
  ]);

  const profitTotalCost = input.batchUnitCost * input.salesLineQuantity;
  const profitGrossProfit = input.salesLineAmount - profitTotalCost;
  const profitGrossMargin = (profitGrossProfit / input.salesLineAmount) * 100;

  return {
    company,
    companyId: input.companyId,
    divisionId: input.divisionId,
    branchId: input.branchId,
    unitId: unit.id,
    soldProductId: soldProduct.id,
    slowProductId: slowProduct.id,
    customerId: customer.id,
    supplierId: supplier.id,
    salespersonId: salesperson.id,
    salesOrderId: salesOrder.id,
    purchaseOrderId: purchaseOrder.id,
    values: {
      salesOrderNumber,
      customerCode: customer.customerCode,
      customerName: customer.name,
      soldProductCode: soldProduct.productCode,
      soldProductName: soldProduct.name,
      salespersonId: salesperson.id,
      salespersonName: salesperson.fullName,
      salesType: input.salesType,
      salesOrderCount: 1,
      salesOrderTotal: input.salesOrderTotal,
      salesOrderPaid: input.salesOrderPaid,
      salesOrderOutstanding: input.salesOrderOutstanding,
      salesLineQuantity: input.salesLineQuantity,
      salesLineAmount: input.salesLineAmount,
      salesLineAveragePrice,
      purchaseOrderNumber,
      supplierCode: supplier.supplierCode,
      supplierName: supplier.name,
      purchaseOrderCount: 1,
      purchaseOrderTotal: input.purchaseOrderTotal,
      purchaseOrderPaid: input.purchaseOrderPaid,
      purchaseOrderOutstanding: input.purchaseOrderOutstanding,
      purchaseLineQuantity: input.purchaseLineQuantity,
      purchaseLineAmount: input.purchaseLineAmount,
      purchaseLineUnitCost,
      batchNumber,
      batchInitialQuantity: input.batchInitialQuantity,
      batchRemainingQuantity: input.batchRemainingQuantity,
      batchUnitCost: input.batchUnitCost,
      damageType: input.damageType,
      damageStatus: input.damageStatus,
      damageCount: 1,
      damageQuantity: input.damageQuantity,
      damageEstimatedValue: input.damageEstimatedValue,
      packageCode,
      packageOwedByCustomer: input.packageOwedByCustomer,
      packageOwedToCustomer: input.packageOwedToCustomer,
      packageDepositBalance: input.packageDepositBalance,
      quotationStatus: input.quotationStatus,
      quotationStatusCount: 1,
      convertedQuotationCount: 0,
      deliveryStatus: input.deliveryStatus,
      deliveryStatusCount: 1,
      priceListName,
      priceListStatus: input.priceListStatus,
      priceListItemCount: 1,
      slowProductCode: slowProduct.productCode,
      slowQuantityOnHand: input.slowQuantityOnHand,
      slowTotalValue: input.slowTotalValue,
      profitTotalCost,
      profitGrossProfit,
      profitGrossMargin,
      receivableCount: 1,
      receivableAmount: input.receivableAmount,
      receivableOutstanding: input.receivableOutstanding,
      salesDate: input.salesDate,
      salesMonth,
    },
  };
}
