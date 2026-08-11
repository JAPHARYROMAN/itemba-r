import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MobilePosLitePurchaseLineDto {
  @IsUUID()
  productId!: string;

  @IsNumber()
  @Min(0.0001)
  @Max(1000000)
  quantity!: number;

  /**
   * Optional landed cost per base unit. When omitted the product's default
   * purchase price (then the product family's) is used, mirroring how the GRN
   * receive flow prefills cost from the PO line / product default.
   */
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Max(1000000000)
  unitCost?: number;
}

export class CreateMobilePosLitePurchaseDto {
  @IsUUID()
  supplierId!: string;

  /**
   * Client-generated replay-protection token, mirroring the sales path. The
   * charset is restricted so the key can be embedded verbatim in the purchase
   * order's notes marker without ambiguity.
   */
  @IsString()
  @MinLength(16)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message: 'idempotencyKey may only contain letters, numbers, ".", "_", ":" and "-"',
  })
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MobilePosLitePurchaseLineDto)
  lines!: MobilePosLitePurchaseLineDto[];
}
