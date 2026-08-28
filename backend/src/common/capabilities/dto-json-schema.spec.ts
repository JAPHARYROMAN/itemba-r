import { IsArray, IsObject, IsOptional, IsUUID } from 'class-validator';
import { deriveDtoSchema } from './dto-json-schema';

class RequiredFreeFormObjectDto {
  @IsObject()
  payload!: Record<string, unknown>;
}

class OptionalFreeFormObjectDto {
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}

class BareObjectDto {
  // The reflected Object type alone is not an exact nested-key contract.
  payload!: Record<string, unknown>;
}

class UuidArrayDto {
  @IsArray()
  @IsUUID('all', { each: true })
  ids!: string[];
}

describe('deriveDtoSchema free-form objects', () => {
  it('treats an explicit @IsObject contract as strict while preserving arbitrary nested keys', () => {
    expect(deriveDtoSchema(RequiredFreeFormObjectDto)).toEqual(
      expect.objectContaining({
        quality: 'strict',
        schema: {
          type: 'object',
          properties: {
            payload: { type: 'object', additionalProperties: true },
          },
          required: ['payload'],
          additionalProperties: false,
        },
      }),
    );
  });

  it('preserves @IsOptional semantics for an explicit free-form object', () => {
    expect(deriveDtoSchema(OptionalFreeFormObjectDto)?.schema).toEqual({
      type: 'object',
      properties: {
        filters: { type: 'object', additionalProperties: true },
      },
      additionalProperties: false,
    });
    expect(deriveDtoSchema(OptionalFreeFormObjectDto)?.quality).toBe('strict');
  });

  it('does not promote an undecorated reflected Object to a strict schema', () => {
    expect(deriveDtoSchema(BareObjectDto)).toBeUndefined();
  });

  it('projects the runtime class-validator isUuid metadata name for array items', () => {
    expect(deriveDtoSchema(UuidArrayDto)).toEqual(
      expect.objectContaining({
        quality: 'strict',
        schema: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
          },
          required: ['ids'],
          additionalProperties: false,
        },
      }),
    );
  });
});
