import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { RouteStatus } from '@prisma/client';

export class CreateRouteDto {
  @IsString() routeCode!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() name!: string;
  @IsString() origin!: string;
  @IsString() destination!: string;
  @IsNumber() @IsOptional() distanceKm?: number;
  @IsString() @IsOptional() estimatedDuration?: string;
  @IsNumber() @IsOptional() standardRate?: number;
  @IsString() @IsOptional() currency?: string;
  @IsEnum(RouteStatus) @IsOptional() status?: RouteStatus;
  @IsString() @IsOptional() notes?: string;
}
