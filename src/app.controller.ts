import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from './database/database.service.js';

@Controller()
@ApiTags('健康检查')
@ApiSecurity('apiKey')
export class AppController {
  constructor(private readonly database: DatabaseService) {}

  @Get('health')
  @ApiOperation({ summary: '检查 API 和数据库连接' })
  health() {
    return this.database.health();
  }
}
