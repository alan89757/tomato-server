import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { APP_GUARD } from '@nestjs/core';
import { TodoModule } from './todo/todo.module.js';
import { ApiKeyGuard } from './common/http.js';

@Module({
  imports: [TodoModule],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
