import { IsString, IsOptional, IsEnum, IsBoolean, IsUUID, IsDateString } from 'class-validator';
import { NotificationType, NotificationPriority } from '@prisma/client';

export class CreateNotificationDto {
  @IsUUID() recipientUserId!: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsString() title!: string;
  @IsString() message!: string;
  @IsEnum(NotificationType) notificationType!: NotificationType;
  @IsOptional() @IsEnum(NotificationPriority) priority?: NotificationPriority;
  @IsOptional() @IsString() linkedEntityType?: string;
  @IsOptional() @IsString() linkedEntityId?: string;
  @IsOptional() @IsString() actionUrl?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}
