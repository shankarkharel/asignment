import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { Role } from '../users/domain/role.enum';
import { ApplicationsService } from './applications.service';
import {
  ApplicationResponseDto,
  PaginatedApplicationsDto,
  RiskAssessmentResponseDto,
} from './dto/application-response.dto';
import { AssignReviewerDto } from './dto/assign-reviewer.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto';
import { ReviewDecisionDto } from './dto/review-decision.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';

const idPipe = new ParseUUIDPipe({ version: '4' });

@ApiTags('applications')
@ApiBearerAuth()
@ApiNotFoundResponse({ description: "Application does not exist or is outside the caller's scope" })
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  @Roles(Role.SALES, Role.ADMIN)
  @ApiOperation({ summary: 'Create a merchant application (starts in DRAFT)' })
  @ApiCreatedResponse({ type: ApplicationResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApplicationDto,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.fromEntity(await this.applicationsService.create(user, dto));
  }

  @Get()
  @ApiOperation({
    summary: 'List applications visible to the caller',
    description: 'SALES: own applications. REVIEWER: all non-draft. ADMIN: all.',
  })
  @ApiOkResponse({ type: PaginatedApplicationsDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<PaginatedApplicationsDto> {
    const { data, meta } = await this.applicationsService.list(user, query);
    return { data: data.map((entity) => ApplicationResponseDto.fromEntity(entity)), meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one application' })
  @ApiOkResponse({ type: ApplicationResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idPipe) id: string,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.fromEntity(await this.applicationsService.findOne(user, id));
  }

  @Patch(':id')
  @Roles(Role.SALES, Role.ADMIN)
  @ApiOperation({ summary: 'Update an application while it is editable (DRAFT / INFO_REQUESTED)' })
  @ApiOkResponse({ type: ApplicationResponseDto })
  @ApiConflictResponse({ description: 'Application is not editable in its current status' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idPipe) id: string,
    @Body() dto: UpdateApplicationDto,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.fromEntity(await this.applicationsService.update(user, id, dto));
  }

  @Post(':id/submit')
  @Roles(Role.SALES, Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit (or resubmit) for review; enqueues an asynchronous risk check' })
  @ApiAcceptedResponse({ type: ApplicationResponseDto })
  @ApiConflictResponse({ description: 'Invalid state transition' })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idPipe) id: string,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.fromEntity(await this.applicationsService.submit(user, id));
  }

  @Post(':id/assign')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign (or re-assign) a reviewer (ADMIN only)' })
  @ApiOkResponse({ type: ApplicationResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
  @ApiUnprocessableEntityResponse({ description: 'Assignee is not an active REVIEWER' })
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idPipe) id: string,
    @Body() dto: AssignReviewerDto,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.fromEntity(
      await this.applicationsService.assignReviewer(user, id, dto.reviewerId),
    );
  }

  @Post(':id/decision')
  @Roles(Role.REVIEWER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve, reject or request info (assigned REVIEWER only)' })
  @ApiOkResponse({ type: ApplicationResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not the assigned reviewer' })
  @ApiConflictResponse({ description: 'Invalid state transition' })
  @ApiUnprocessableEntityResponse({ description: 'Risk review has not completed (approval only)' })
  async decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idPipe) id: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.fromEntity(await this.applicationsService.decide(user, id, dto));
  }

  @Post(':id/risk-review/retry')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-run a FAILED risk review (ADMIN only)' })
  @ApiAcceptedResponse({ type: ApplicationResponseDto })
  async retryRiskReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idPipe) id: string,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.fromEntity(
      await this.applicationsService.retryRiskReview(user, id),
    );
  }

  @Get(':id/risk-assessments')
  @ApiOperation({ summary: 'Risk assessment history for an application' })
  @ApiOkResponse({ type: [RiskAssessmentResponseDto] })
  async riskAssessments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', idPipe) id: string,
  ): Promise<RiskAssessmentResponseDto[]> {
    const assessments = await this.applicationsService.listRiskAssessments(user, id);
    return assessments.map(
      ({ application: _application, applicationId: _applicationId, ...rest }) => rest,
    );
  }
}
