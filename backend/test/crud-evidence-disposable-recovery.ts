import { Prisma } from '@prisma/client';

const DISPOSABLE_SCHEMA = /^msaidizi_crud_evidence_[a-z0-9_]{8,80}$/;
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

type RawDelete = (query: string, ...values: unknown[]) => Promise<number>;

function prismaModel(modelName: string) {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === modelName);
  if (!model) throw new Error(`Prisma model ${modelName} is absent from disposable recovery.`);
  return model;
}

function quoteIdentifier(identifier: string, label: string): string {
  if (!SQL_IDENTIFIER.test(identifier)) {
    throw new Error(`Unsafe ${label} identifier ${JSON.stringify(identifier)}.`);
  }
  return `"${identifier}"`;
}

export function includingSoftDeletedWhere(
  modelName: string,
  where: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const model = prismaModel(modelName);
  if (!model.fields.some((field) => field.name === 'deletedAt')) return { ...where };

  // PrismaService injects deletedAt:null unless a deletedAt predicate is
  // already present. This tautology deliberately opts the disposable evidence
  // harness into seeing both live records and tombstones.
  return {
    AND: [
      { ...where },
      {
        OR: [{ deletedAt: null }, { deletedAt: { not: null } }],
      },
    ],
  };
}

export async function physicallyDeleteDisposableRecord(
  executeRaw: RawDelete,
  schemaName: string,
  modelName: string,
  identity: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (!DISPOSABLE_SCHEMA.test(schemaName)) {
    throw new Error(`Refusing physical recovery outside a disposable evidence schema.`);
  }

  const model = prismaModel(modelName);
  const identityFields = model.primaryKey?.fields.length
    ? [...model.primaryKey.fields]
    : model.fields.filter((field) => field.isId).map((field) => field.name);
  const suppliedFields = Object.keys(identity).sort();
  const expectedFields = [...identityFields].sort();
  if (
    expectedFields.length === 0 ||
    suppliedFields.length !== expectedFields.length ||
    suppliedFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new Error(
      `Physical recovery identity for ${modelName} must be exactly ${expectedFields.join(',') || '<missing>'}.`,
    );
  }

  const columns = new Map(
    model.fields
      .filter((field) => field.kind !== 'object')
      .map((field) => [field.name, field.dbName ?? field.name]),
  );
  const orderedFields = [...identityFields];
  const values = orderedFields.map((field) => {
    const value = identity[field];
    if (value === undefined) {
      throw new Error(`Physical recovery identity ${modelName}.${field} is undefined.`);
    }
    return value;
  });
  const predicates = orderedFields
    .map((field, index) => {
      const column = columns.get(field);
      if (!column) throw new Error(`Physical recovery field ${modelName}.${field} is absent.`);
      return `${quoteIdentifier(column, 'column')} = $${index + 1}`;
    })
    .join(' AND ');
  const tableName = model.dbName ?? model.name;
  const statement = `DELETE FROM ${quoteIdentifier(schemaName, 'schema')}.${quoteIdentifier(
    tableName,
    'table',
  )} WHERE ${predicates}`;
  const affected = await executeRaw(statement, ...values);
  if (affected !== 1) {
    throw new Error(
      `Physical recovery expected one ${modelName} row but deleted ${String(affected)}.`,
    );
  }
}
