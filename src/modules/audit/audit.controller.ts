import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Paginated } from '../../common/dto/pagination.dto';
import { Role } from '../users/domain/role.enum';
import { AuditService } from './audit.service';
import { AuditLogEntity } from './domain/audit-log.entity';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Query the audit trail (ADMIN only)' })
  list(@Query() query: ListAuditLogsQueryDto): Promise<Paginated<AuditLogEntity>> {
    return this.auditService.list(query);
  }
}
