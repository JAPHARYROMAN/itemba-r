import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { MedicalExamType, MedicalFitnessStatus } from '@prisma/client';

export class CreateMedicalExamRecordDto {
  @IsNotEmpty()
  @IsString()
  companyId!: string;

  @IsNotEmpty()
  @IsString()
  employeeId!: string;

  @IsOptional()
  @IsEnum(MedicalExamType)
  examType?: MedicalExamType;

  @IsNotEmpty()
  @IsDateString()
  examDate!: string;

  @IsNotEmpty()
  @IsDateString()
  expiresAt!: string;

  @IsOptional()
  @IsEnum(MedicalFitnessStatus)
  fitnessStatus?: MedicalFitnessStatus;

  @IsOptional()
  @IsString()
  doctorName?: string;

  @IsOptional()
  @IsString()
  facilityName?: string;

  @IsOptional()
  @IsBoolean()
  hazardSector?: boolean;

  @IsOptional()
  @IsString()
  restrictions?: string;

  @IsOptional()
  @IsString()
  documentId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
