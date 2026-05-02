import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const VALID_THEMES = ['system', 'light', 'dark'] as const;
const VALID_DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
const VALID_DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;

const DEFAULTS = {
  theme: 'system',
  density: 'comfortable',
  locale: 'en',
  timezone: 'Africa/Dar_es_Salaam',
  dateFormat: 'DD/MM/YYYY',
  numberFormat: 'en-GB',
  defaultCompanyId: null as string | null,
  defaultDivisionId: null as string | null,
  defaultBranchId: null as string | null,
};

export interface UpsertUserPreferenceDto {
  theme?: string;
  density?: string;
  locale?: string;
  timezone?: string;
  dateFormat?: string;
  numberFormat?: string;
  defaultCompanyId?: string | null;
  defaultDivisionId?: string | null;
  defaultBranchId?: string | null;
}

@Injectable()
export class UserPreferencesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Read the calling user's preferences. Returns the row if it exists, or
   * the in-memory defaults shape (so the frontend always renders something
   * meaningful even before first save).
   */
  async getMine(userId: string) {
    const row = await this.prisma.userPreference.findUnique({ where: { userId } });
    if (row) {
      return {
        ...row,
        // Resolve display names lazily — keeps the response tight.
      };
    }
    return { userId, ...DEFAULTS, persisted: false };
  }

  /**
   * Upsert the calling user's preferences. Lazy-creates the row on first
   * call so existing users don't need a backfill migration.
   */
  async upsertMine(userId: string, dto: UpsertUserPreferenceDto) {
    if (dto.theme && !(VALID_THEMES as readonly string[]).includes(dto.theme)) {
      throw new BadRequestException(`theme must be one of: ${VALID_THEMES.join(', ')}`);
    }
    if (dto.density && !(VALID_DENSITIES as readonly string[]).includes(dto.density)) {
      throw new BadRequestException(`density must be one of: ${VALID_DENSITIES.join(', ')}`);
    }
    if (dto.dateFormat && !(VALID_DATE_FORMATS as readonly string[]).includes(dto.dateFormat)) {
      throw new BadRequestException(`dateFormat must be one of: ${VALID_DATE_FORMATS.join(', ')}`);
    }

    // Cross-validate hierarchy: if defaultDivisionId set, it must belong to
    // defaultCompanyId; same for branch under division. Saves the user from
    // creating a stale default that points at the wrong company.
    if (dto.defaultDivisionId && dto.defaultCompanyId) {
      const div = await this.prisma.division.findFirst({
        where: { id: dto.defaultDivisionId, companyId: dto.defaultCompanyId, deletedAt: null },
        select: { id: true },
      });
      if (!div) throw new BadRequestException('defaultDivisionId does not belong to defaultCompanyId.');
    }
    if (dto.defaultBranchId && dto.defaultDivisionId) {
      const br = await this.prisma.branch.findFirst({
        where: { id: dto.defaultBranchId, divisionId: dto.defaultDivisionId, deletedAt: null },
        select: { id: true },
      });
      if (!br) throw new BadRequestException('defaultBranchId does not belong to defaultDivisionId.');
    }

    const data = {
      ...(dto.theme !== undefined && { theme: dto.theme }),
      ...(dto.density !== undefined && { density: dto.density }),
      ...(dto.locale !== undefined && { locale: dto.locale }),
      ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      ...(dto.dateFormat !== undefined && { dateFormat: dto.dateFormat }),
      ...(dto.numberFormat !== undefined && { numberFormat: dto.numberFormat }),
      ...(dto.defaultCompanyId !== undefined && { defaultCompanyId: dto.defaultCompanyId || null }),
      ...(dto.defaultDivisionId !== undefined && { defaultDivisionId: dto.defaultDivisionId || null }),
      ...(dto.defaultBranchId !== undefined && { defaultBranchId: dto.defaultBranchId || null }),
    };

    const row = await this.prisma.userPreference.upsert({
      where: { userId },
      update: data,
      create: { userId, ...DEFAULTS, ...data },
    });
    return { ...row, persisted: true };
  }

  /** Reset the calling user's preferences back to defaults. Removes the row. */
  async resetMine(userId: string) {
    await this.prisma.userPreference.deleteMany({ where: { userId } });
    return { userId, ...DEFAULTS, persisted: false };
  }
}
