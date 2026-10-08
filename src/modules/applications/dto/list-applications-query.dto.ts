import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ApplicationStatus, RiskStatus } from '../domain/application.enums';

/** Accepts `?status=A,B` and `?status=A&status=B`. */
const toArray = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : value;

export class ListApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ApplicationStatus,
    isArray: true,
    description: 'Filter by one or more statuses (comma-separated or repeated)',
  })
  @IsOptional()
  @Transform(toArray)
  @IsEnum(ApplicationStatus, { each: true })
  status?: ApplicationStatus[];

  @ApiPropertyOptional({ enum: RiskStatus })
  @IsOptional()
  @IsEnum(RiskStatus)
  riskStatus?: RiskStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assignedReviewerId?: string;
}
