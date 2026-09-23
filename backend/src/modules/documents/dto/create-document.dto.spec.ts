import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDocumentDto } from './create-document.dto';

describe('Multipart document metadata', () => {
  it.each([
    ['false', false],
    ['true', true],
    [false, false],
    [true, true],
  ])('parses %s without implicit truthiness', async (raw, expected) => {
    const dto = plainToInstance(
      CreateDocumentDto,
      { title: 'File', ownerType: 'COMPANY', ownerId: 'owner', isConfidential: raw },
      { enableImplicitConversion: true },
    );
    expect(dto.isConfidential).toBe(expected);
    expect(await validate(dto)).toHaveLength(0);
  });
  it('rejects ambiguous booleans', async () => {
    const dto = plainToInstance(
      CreateDocumentDto,
      { title: 'File', ownerType: 'COMPANY', ownerId: 'owner', isConfidential: 'maybe' },
      { enableImplicitConversion: true },
    );
    expect((await validate(dto)).some((error) => error.property === 'isConfidential')).toBe(true);
  });
});
