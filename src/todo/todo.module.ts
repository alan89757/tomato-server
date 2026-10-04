import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { TodoController } from './todo.controller.js';
import { TodoService } from './todo.service.js';

@Module({
  controllers: [TodoController],
  providers: [DatabaseService, TodoService],
  exports: [DatabaseService],
})
export class TodoModule {}
