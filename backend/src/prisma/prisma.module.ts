import { Global, Module } from '@nestjs/common';
import { EphemeralSecretsModule } from '../common/ephemeral-secrets.module';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  imports: [EphemeralSecretsModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
