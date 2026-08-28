import type { MsaidiziInputBindingDto } from './dto/msaidizi-task.dto';
import {
  validateBoundCapabilityArguments,
  validateCapabilityJsonSchema,
} from './msaidizi-bound-capability-schema';

describe('bound capability schema validation', () => {
  it('does not accept a non-canonical array index as a schema pointer segment', () => {
    const binding: MsaidiziInputBindingDto = {
      targetPath: '/items/0evil/value',
      source: { kind: 'PLAN_INPUT', path: '/value' },
      dataClass: 'Internal',
      expectedType: 'string',
      expectedSchema: { type: 'string', minLength: 1, maxLength: 20 },
      transform: { name: 'IDENTITY', version: '1' },
    };

    expect(
      validateBoundCapabilityArguments(
        { items: [{ value: null }] },
        [binding],
        {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: { value: { type: 'string', minLength: 1, maxLength: 20 } },
                required: ['value'],
                additionalProperties: false,
              },
            },
          },
          required: ['items'],
          additionalProperties: false,
        },
        { value: 'reviewed' },
      ),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'BINDING_TARGET_SCHEMA_MISSING' })]),
    );
  });

  it('accepts an integer value where a capability schema declares number', () => {
    expect(validateCapabilityJsonSchema(1, { type: 'number', minimum: 0 }, 'value')).toEqual([]);
  });
});
