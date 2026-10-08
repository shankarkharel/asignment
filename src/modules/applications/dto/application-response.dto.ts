import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/pagination.dto';
import { maskValue } from '../../../common/logging/redact';
import {
  ApplicationStatus,
  BusinessType,
  RiskLevel,
  RiskStatus,
} from '../domain/application.enums';
import { MerchantApplicationEntity } from '../domain/merchant-application.entity';

/**
 * Explicit API contract. Mapping by hand (instead of serialising the entity) means a
 * new sensitive column can never leak by accident; the tax id is only ever returned masked.
 */
export class ApplicationResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() businessName: string;
  @ApiProperty() legalBusinessName: string;
  @ApiProperty({ enum: BusinessType }) businessType: BusinessType;
  @ApiProperty({ example: '*******0123' }) taxIdMasked: string;
  @ApiProperty() countryCode: string;
  @ApiPropertyOptional({ type: String, nullable: true }) websiteUrl: string | null;
  @ApiProperty() ownerFullName: string;
  @ApiProperty() ownerEmail: string;
  @ApiProperty() ownerPhone: string;
  @ApiProperty() merchantCategoryCode: string;
  @ApiProperty() expectedMonthlyVolume: number;
  @ApiProperty() averageTransactionAmount: number;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: ApplicationStatus }) status: ApplicationStatus;
  @ApiProperty({ enum: RiskStatus }) riskStatus: RiskStatus;
  @ApiPropertyOptional({ enum: RiskLevel, nullable: true }) riskLevel: RiskLevel | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) riskScore: number | null;
  @ApiProperty() riskCheckVersion: number;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  assignedReviewerId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) decisionReason: string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) submittedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) decidedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static fromEntity(entity: MerchantApplicationEntity): ApplicationResponseDto {
    return {
      id: entity.id,
      businessName: entity.businessName,
      legalBusinessName: entity.legalBusinessName,
      businessType: entity.businessType,
      taxIdMasked: maskValue(entity.taxId),
      countryCode: entity.countryCode,
      websiteUrl: entity.websiteUrl,
      ownerFullName: entity.ownerFullName,
      ownerEmail: entity.ownerEmail,
      ownerPhone: entity.ownerPhone,
      merchantCategoryCode: entity.merchantCategoryCode,
      expectedMonthlyVolume: entity.expectedMonthlyVolume,
      averageTransactionAmount: entity.averageTransactionAmount,
      currency: entity.currency,
      status: entity.status,
      riskStatus: entity.riskStatus,
      riskLevel: entity.riskLevel,
      riskScore: entity.riskScore,
      riskCheckVersion: entity.riskCheckVersion,
      createdById: entity.createdById,
      assignedReviewerId: entity.assignedReviewerId,
      decisionReason: entity.decisionReason,
      submittedAt: entity.submittedAt,
      decidedAt: entity.decidedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

export class PaginatedApplicationsDto {
  @ApiProperty({ type: [ApplicationResponseDto] }) data: ApplicationResponseDto[];
  @ApiProperty({ type: PaginationMetaDto }) meta: PaginationMetaDto;
}

export class RiskAssessmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() checkVersion: number;
  @ApiProperty() provider: string;
  @ApiProperty() providerReference: string;
  @ApiProperty() score: number;
  @ApiProperty({ enum: RiskLevel }) level: RiskLevel;
  @ApiProperty({ type: [String] }) reasons: string[];
  @ApiProperty() attempt: number;
  @ApiProperty() createdAt: Date;
}
