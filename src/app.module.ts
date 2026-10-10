import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AppController } from './app.controller.js';
import { APP_GUARD } from '@nestjs/core';
import { TodoModule } from './todo/todo.module.js';
import { ApiKeyGuard } from './common/http.js';

@Module({
  imports: [TodoModule],
  controllers: [AppController, AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
