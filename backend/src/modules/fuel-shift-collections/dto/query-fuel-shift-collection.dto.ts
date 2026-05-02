import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FuelShiftCollectionType } from '@prisma/client';

/**
 * List + filter contract for the petroleum collections page.
 *
 * Powers `/api/v1/petroleum/fuel-shift-collections` with:
 *   - Pagination (page / limit), capped at 200/page so a runaway list query
 *     can't be used to dump every collection in one request.
 *   - Company / branch / shift / type / cash-account scoping.
 *   - Date-range filter on `createdAt` (the moment the collection was
 *     recorded against the shift). The frontend sends ISO date strings;
 *     the service converts them to Date instances.
 *   - Free-text search over `reference` and `notes` (case-insensitive).
 *
 * The service intersects companyId from this DTO with
 * `CompanyScopeService.companyWhereFor(user, companyId)` so a stray
 * filter cannot widen scope past the user's accessible companies.
 */
export class QueryFuelShiftCollectionDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;

  @IsOptional() @IsString() shiftId?: string;

  @IsOptional() @IsString() companyId?: string;

  @IsOptional() @IsString() branchId?: string;

  @IsOptional() @IsEnum(FuelShiftCollectionType) collectionType?: FuelShiftCollectionType;

  @IsOptional() @IsString() cashAccountId?: string;

  @IsOptional() @IsString() collectedById?: string;

  @IsOptional() @IsDateString() dateFrom?: string;

  @IsOptional() @IsDateString() dateTo?: string;

  /** Free-text search applied to reference + notes, case-insensitive. */
  @IsOptional() @IsString() search?: string;
}
