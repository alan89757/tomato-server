import { AuthService } from '../auth/auth.service.js';
import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { TodoController } from './todo.controller.js';
import { TodoService } from './todo.service.js';

@Module({
  controllers: [TodoController],
  providers: [DatabaseService, AuthService, TodoService],
  exports: [DatabaseService, AuthService],
})
export class TodoModule {}
