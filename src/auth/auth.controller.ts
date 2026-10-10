import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { SchemaPipe } from '../todo/schemas.js';
import { AuthService } from './auth.service.js';

const loginSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_.-]+$/),
    password: z.string().min(1).max(128),
  })
  .strict();
type Login = z.infer<typeof loginSchema>;

@ApiTags('账号')
@ApiSecurity('apiKey')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '用户名密码登录，返回七天有效的会话' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['username', 'password'],
      properties: {
        username: { type: 'string' },
        password: { type: 'string', format: 'password' },
      },
    },
  })
  login(@Body(new SchemaPipe(loginSchema)) body: Login) {
    return this.auth.login(body.username, body.password);
  }

  @Get('me')
  @ApiOperation({ summary: '读取当前登录账号' })
  @ApiHeader({
    name: 'Authorization',
    required: true,
    description: 'Bearer <登录返回的 token>',
  })
  me(@Headers('authorization') authorization?: string) {
    return this.auth.me(authorization);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: '撤销当前登录会话' })
  @ApiHeader({
    name: 'Authorization',
    required: true,
    description: 'Bearer <登录返回的 token>',
  })
  logout(@Headers('authorization') authorization?: string) {
    return this.auth.logout(authorization);
  }
}
