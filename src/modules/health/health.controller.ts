import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Queue } from 'bullmq';
import { Public } from '../../common/decorators/public.decorator';
import { RISK_REVIEW_QUEUE } from '../risk-review/risk-review.constants';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly indicators: HealthIndicatorService,
    @InjectQueue(RISK_REVIEW_QUEUE) private readonly queue: Queue,
  ) {}

  /** Liveness: the process is up. No dependency checks (avoids restart storms). */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable; safe to route traffic. */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.db.pingCheck('database'), () => this.redisCheck()]);
  }

  private async redisCheck() {
    const indicator = this.indicators.check('redis');
    try {
      // Cheap round-trip through the same connection the producers use.
      await this.queue.getJobCounts('waiting');
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'unreachable' });
    }
  }
}
