import {
  Injectable,
  UnauthorizedException,
  HttpException,
  type OnModuleInit,
} from '@nestjs/common';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service.js';

const derive = promisify(scrypt);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, hex] = encoded.split(':');
  if (!salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const key = (await derive(password, salt, 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');
interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  password_hash: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    // INSERT IGNORE preserves an existing admin account and its changed password.
    this.dummyHash = await hashPassword('123456');
    await this.db.pool.execute(
      'INSERT IGNORE INTO users (username, password_hash) VALUES (?, ?)',
      ['admin', this.dummyHash],
    );
  }
  async login(username: string, password: string) {
    const now = Date.now();
    for (const [name, item] of this.attempts)
      if (item.until <= now) this.attempts.delete(name);
    const attempt = this.attempts.get(username) ?? {
      count: 0,
      until: now + 60000,
    };
    if (
      attempt.count >= 10 ||
      (!this.attempts.has(username) && this.attempts.size >= 1000)
    ) {
      throw new HttpException('尝试次数过多，请一分钟后重试。', 429);
    }
    attempt.count++;
    this.attempts.set(username, attempt);
    const [rows] = await this.db.pool.execute<UserRow[]>(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [username],
    );
    const user = rows[0];
    const valid = await verifyPassword(
      password,
      user?.password_hash ?? this.dummyHash,
    );
    if (!user || !valid) throw new UnauthorizedException('用户名或密码错误');
    this.attempts.delete(username);
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000);
    await this.db.pool.execute(
      'DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP(3)',
    );
    await this.db.pool.execute(
      'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      [digest(token), user.id, expiresAt],
    );
    return {
      user: { id: user.id, username: user.username },
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }
  private token(authorization?: string) {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? '');
    if (!match) throw new UnauthorizedException('请先登录');
    return match[1];
  }
  async me(authorization?: string) {
    const [rows] = await this.db.pool.execute<UserRow[]>(
      'SELECT u.id, u.username FROM users u JOIN auth_sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)',
      [digest(this.token(authorization))],
    );
    if (!rows[0]) throw new UnauthorizedException('登录已过期，请重新登录');
    return { id: rows[0].id, username: rows[0].username };
  }
  async logout(authorization?: string) {
    await this.db.pool.execute(
      'DELETE FROM auth_sessions WHERE token_hash = ?',
      [digest(this.token(authorization))],
    );
    return { success: true };
  }
}
