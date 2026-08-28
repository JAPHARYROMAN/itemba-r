import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

export class DisableMsaidiziAutopilotDto {
  @ApiProperty({ example: 'DISABLE AUTOPILOT' })
  @Equals('DISABLE AUTOPILOT')
  confirmation!: 'DISABLE AUTOPILOT';
}

export class EnableMsaidiziAutopilotDto {
  @ApiProperty({ example: 'ENABLE AUTOPILOT' })
  @Equals('ENABLE AUTOPILOT')
  confirmation!: 'ENABLE AUTOPILOT';
}
