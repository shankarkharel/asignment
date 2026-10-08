import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BusinessType } from '../domain/application.enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateApplicationDto {
  @ApiProperty({ example: 'Himalayan Coffee House' })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  businessName: string;

  @ApiProperty({ example: 'Himalayan Coffee House Pvt. Ltd.' })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  legalBusinessName: string;

  @ApiProperty({ enum: BusinessType })
  @IsEnum(BusinessType)
  businessType: BusinessType;

  @ApiProperty({
    example: 'TEST-000123',
    description: 'Tax / company registration number. Encrypted at rest and masked in responses.',
    writeOnly: true,
  })
  @Transform(upper)
  @Matches(/^[A-Z0-9-]{5,30}$/, { message: 'taxId must be 5-30 characters: A-Z, 0-9 or "-"' })
  taxId: string;

  @ApiProperty({ example: 'NP', description: 'ISO 3166-1 alpha-2' })
  @Transform(upper)
  @IsISO31661Alpha2()
  countryCode: string;

  @ApiPropertyOptional({ example: 'https://example.test' })
  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(2048)
  websiteUrl?: string;

  @ApiProperty({ example: 'Test Owner' })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  ownerFullName: string;

  @ApiProperty({ example: 'owner@example.test' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  ownerEmail: string;

  @ApiProperty({ example: '+9779800000000', description: 'E.164 format' })
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'ownerPhone must be in E.164 format' })
  ownerPhone: string;

  @ApiProperty({ example: '5814', description: 'ISO 18245 merchant category code' })
  @Matches(/^\d{4}$/, { message: 'merchantCategoryCode must be 4 digits' })
  merchantCategoryCode: string;

  @ApiProperty({ example: 50000, description: 'Expected monthly processing volume' })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(999_999_999_999.99)
  expectedMonthlyVolume: number;

  @ApiProperty({ example: 25.5 })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(9_999_999_999.99)
  averageTransactionAmount: number;

  @ApiProperty({ example: 'NPR', description: 'ISO 4217' })
  @Transform(upper)
  @IsISO4217CurrencyCode()
  currency: string;
}
