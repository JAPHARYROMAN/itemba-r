import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMobilePosTerminalDto } from './mobile-pos-terminal.dto';

// uiVersion is the per-terminal POS shell pilot flag: 1 classic, 2 Kaunta,
// 3 the new POS on ITEMBA OS (POS_REMAKE_PLAN_2026-09-23.md).
describe('UpdateMobilePosTerminalDto.uiVersion', () => {
  async function errorsFor(uiVersion: unknown) {
    const dto = plainToInstance(UpdateMobilePosTerminalDto, { uiVersion });
    return (await validate(dto)).filter((error) => error.property === 'uiVersion');
  }

  it.each([1, 2, 3])('accepts shell %i', async (uiVersion) => {
    expect(await errorsFor(uiVersion)).toHaveLength(0);
  });

  it.each([0, 4, 2.5, '3'])('refuses %p', async (uiVersion) => {
    expect(await errorsFor(uiVersion)).toHaveLength(1);
  });
});
