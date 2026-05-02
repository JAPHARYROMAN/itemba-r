import { IsString, IsOptional, IsEnum, IsUUID, IsObject } from 'class-validator';
import { AlertType, NotificationPriority } from '@prisma/client';

export class CreateAlertEventDto {
  @IsOptional() @IsUUID() alertRuleId?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsEnum(AlertType) alertType!: AlertType;
  @IsString() title!: string;
  @IsString() message!: string;
  @IsOptional() @IsString() linkedEntityType?: string;
  @IsOptional() @IsString() linkedEntityId?: string;
  @IsOptional() @IsEnum(NotificationPriority) priority?: NotificationPriority;
  @IsOptional() @IsObject() metadata?: Record<string, any>;
}
