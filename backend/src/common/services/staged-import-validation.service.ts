import { BadRequestException, Injectable } from '@nestjs/common';

export type ImportEntityType =
  | 'customers'
  | 'suppliers'
  | 'products'
  | 'employees'
  | 'assets'
  | 'opening_balances'
  | 'stock';

type ImportRow = Record<string, unknown>;

type ImportRule = {
  requiredFields: string[];
  uniqueFieldSets: string[][];
};

export type ImportValidationIssue = {
  rowNumber: number;
  field?: string;
  code: 'REQUIRED_FIELD_MISSING' | 'DUPLICATE_VALUE' | 'UNKNOWN_ENTITY_TYPE';
  message: string;
};

export type ImportValidationReport = {
  entityType: ImportEntityType;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  canCommit: boolean;
  issues: ImportValidationIssue[];
};

const IMPORT_RULES: Record<ImportEntityType, ImportRule> = {
  customers: {
    requiredFields: ['companyId', 'customerCode', 'name'],
    uniqueFieldSets: [['customerCode']],
  },
  suppliers: {
    requiredFields: ['companyId', 'supplierCode', 'name'],
    uniqueFieldSets: [['supplierCode']],
  },
  products: {
    requiredFields: ['companyId', 'productCode', 'name', 'unitId'],
    uniqueFieldSets: [['productCode']],
  },
  employees: {
    requiredFields: ['companyId', 'employeeNumber', 'firstName', 'lastName'],
    uniqueFieldSets: [['employeeNumber']],
  },
  assets: {
    requiredFields: ['companyId', 'assetCode', 'name', 'acquisitionDate'],
    uniqueFieldSets: [['assetCode']],
  },
  opening_balances: {
    requiredFields: ['companyId', 'accountCode', 'balanceDate', 'amount'],
    uniqueFieldSets: [['accountCode']],
  },
  stock: {
    requiredFields: ['companyId', 'productCode', 'branchCode', 'quantityOnHand'],
    uniqueFieldSets: [['productCode', 'branchCode']],
  },
};

@Injectable()
export class StagedImportValidationService {
  validate(entityType: ImportEntityType, rows: ImportRow[]): ImportValidationReport {
    const rules = IMPORT_RULES[entityType];
    if (!rules) {
      throw new BadRequestException(`Unsupported import entity type: ${entityType}`);
    }

    const issues: ImportValidationIssue[] = [];
    const invalidRowNumbers = new Set<number>();

    rows.forEach((row, index) => {
      const rowNumber = index + 1;
      for (const field of rules.requiredFields) {
        if (this.isBlank(row[field])) {
          invalidRowNumbers.add(rowNumber);
          issues.push({
            rowNumber,
            field,
            code: 'REQUIRED_FIELD_MISSING',
            message: `Row ${rowNumber} is missing required field "${field}"`,
          });
        }
      }
    });

    for (const fields of rules.uniqueFieldSets) {
      const seen = new Map<string, number>();
      rows.forEach((row, index) => {
        const rowNumber = index + 1;
        if (fields.some((field) => this.isBlank(row[field]))) return;

        const value = fields.map((field) => String(row[field]).trim().toLowerCase()).join('::');
        const firstRow = seen.get(value);
        if (firstRow) {
          invalidRowNumbers.add(rowNumber);
          invalidRowNumbers.add(firstRow);
          issues.push({
            rowNumber,
            field: fields.join('+'),
            code: 'DUPLICATE_VALUE',
            message: `Row ${rowNumber} duplicates "${fields.join(', ')}" from row ${firstRow}`,
          });
        } else {
          seen.set(value, rowNumber);
        }
      });
    }

    const invalidRows = invalidRowNumbers.size;
    return {
      entityType,
      totalRows: rows.length,
      validRows: rows.length - invalidRows,
      invalidRows,
      canCommit: issues.length === 0,
      issues,
    };
  }

  assertCanCommit(report: ImportValidationReport): void {
    if (!report.canCommit) {
      throw new BadRequestException(
        `Import cannot be committed while ${report.invalidRows} row(s) have validation issues`,
      );
    }
  }

  private isBlank(value: unknown): boolean {
    return value === null || value === undefined || String(value).trim() === '';
  }
}
