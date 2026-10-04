import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createPool, type Pool } from 'mysql2/promise';
import { config } from '../config.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool = createPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 100,
    connectTimeout: 10000,
  });
  async onModuleInit() {
    try {
      await this.pool.query('SELECT id FROM app_state WHERE id = 1');
    } catch {
      throw new Error(
        '无法连接数据库或缺少表结构，请检查 .env 并运行 pnpm db:migrate。',
      );
    }
  }
  async health() {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException('数据库不可用');
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
