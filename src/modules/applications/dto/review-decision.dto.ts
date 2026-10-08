import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length, ValidateIf } from 'class-validator';
import { ReviewDecision } from '../domain/application.enums';

export class ReviewDecisionDto {
  @ApiProperty({ enum: ReviewDecision })
  @IsEnum(ReviewDecision)
  decision: ReviewDecision;

  @ApiPropertyOptional({ description: 'Required when rejecting or requesting more information' })
  // Mandatory for REJECT / REQUEST_INFO; validated if supplied for APPROVE.
  @ValidateIf(
    (dto: ReviewDecisionDto) => dto.decision !== ReviewDecision.APPROVE || dto.reason !== undefined,
  )
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 2000)
  reason?: string;
}
