import { IsString, IsOptional, IsEnum, IsBoolean, IsUUID, IsObject, IsNumber } from 'class-validator';
import { AlertType, AlertFrequency, AlertRecipientType, NotificationPriority } from '@prisma/client';

export class CreateAlertRuleDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(AlertType) alertType!: AlertType;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsEnum(AlertFrequency) frequency?: AlertFrequency;
  @IsOptional() @IsEnum(AlertRecipientType) recipientType?: AlertRecipientType;
  @IsOptional() @IsUUID() recipientUserId?: string;
  @IsOptional() @IsUUID() recipientRoleId?: string;
  @IsOptional() @IsString() recipientPermission?: string;
  @IsOptional() @IsEnum(NotificationPriority) priority?: NotificationPriority;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsNumber() daysBefore?: number;
  @IsOptional() @IsObject() condition?: Record<string, any>;
}
