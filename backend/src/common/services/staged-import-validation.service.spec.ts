import { BadRequestException } from '@nestjs/common';
import { StagedImportValidationService } from './staged-import-validation.service';

describe('StagedImportValidationService', () => {
  let service: StagedImportValidationService;

  beforeEach(() => {
    service = new StagedImportValidationService();
  });

  it('allows a valid staged product import to proceed to commit', () => {
    const report = service.validate('products', [
      {
        companyId: 'company-1',
        productCode: 'SKU-001',
        name: 'Cement',
        unitId: 'bag',
      },
      {
        companyId: 'company-1',
        productCode: 'SKU-002',
        name: 'Nails',
        unitId: 'box',
      },
    ]);

    expect(report).toMatchObject({
      totalRows: 2,
      validRows: 2,
      invalidRows: 0,
      canCommit: true,
      issues: [],
    });
    expect(() => service.assertCanCommit(report)).not.toThrow();
  });

  it('reports row-level missing required field issues', () => {
    const report = service.validate('employees', [
      {
        companyId: 'company-1',
        employeeNumber: 'EMP-001',
        firstName: 'Asha',
      },
    ]);

    expect(report.canCommit).toBe(false);
    expect(report.invalidRows).toBe(1);
    expect(report.issues).toEqual([
      expect.objectContaining({
        rowNumber: 1,
        field: 'lastName',
        code: 'REQUIRED_FIELD_MISSING',
      }),
    ]);
  });

  it('detects duplicate natural keys case-insensitively', () => {
    const report = service.validate('customers', [
      { companyId: 'company-1', customerCode: 'CUST-001', name: 'Alpha' },
      { companyId: 'company-1', customerCode: 'cust-001', name: 'Alpha Duplicate' },
    ]);

    expect(report.canCommit).toBe(false);
    expect(report.invalidRows).toBe(2);
    expect(report.issues).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        field: 'customerCode',
        code: 'DUPLICATE_VALUE',
      }),
    ]);
  });

  it('requires composite stock natural keys to be unique in the staged file', () => {
    const report = service.validate('stock', [
      {
        companyId: 'company-1',
        productCode: 'SKU-001',
        branchCode: 'MAIN',
        quantityOnHand: 10,
      },
      {
        companyId: 'company-1',
        productCode: 'SKU-001',
        branchCode: 'MAIN',
        quantityOnHand: 5,
      },
    ]);

    expect(report.canCommit).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        field: 'productCode+branchCode',
        code: 'DUPLICATE_VALUE',
      }),
    ]);
  });

  it('blocks commit when validation issues remain', () => {
    const report = service.validate('suppliers', [{ companyId: 'company-1', supplierCode: '' }]);

    expect(() => service.assertCanCommit(report)).toThrow(BadRequestException);
  });
});
