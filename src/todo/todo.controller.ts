import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { TodoService } from './todo.service.js';
import {
  completionSchema,
  createTaskSchema,
  daysSchema,
  idSchema,
  SchemaPipe,
  sessionSchema,
  snapshotSchema,
  timerInputSchema,
  updateTaskSchema,
} from './schemas.js';
import type {
  CreateTask,
  Session,
  Snapshot,
  Timer,
  UpdateTask,
} from './schemas.js';

// Swagger serves OpenAPI 3.1, allowing the JSON Schema produced by Zod.
type BodySchema = Extract<
  Parameters<typeof ApiBody>[0],
  { schema: unknown }
>['schema'];
const body = (schema: z.ZodType) =>
  ApiBody({ schema: z.toJSONSchema(schema) as BodySchema });
const optionalMatch = () =>
  ApiHeader({
    name: 'If-Match',
    required: false,
    description: '可选：ETag 版本检查，如 "0"；冲突返回 409',
  });

@ApiTags('待办与专注')
@ApiSecurity('apiKey')
@Controller()
export class TodoController {
  constructor(private readonly todo: TodoService) {}

  @Get('snapshot')
  @ApiOperation({
    summary: '读取客户端 Snapshot v1，响应 ETag 用于保存版本检查',
  })
  snapshot() {
    return this.todo.load();
  }

  @Put('snapshot')
  @ApiOperation({
    summary: '事务保存整份快照；缺少版本返回 428，版本冲突返回 409',
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'GET /snapshot 返回的 ETag，包含双引号',
  })
  @body(snapshotSchema)
  save(
    @Body(new SchemaPipe(snapshotSchema)) snapshot: Snapshot,
    @Headers('if-match') match?: string,
  ) {
    return this.todo.save(snapshot, match);
  }

  @Get('tasks')
  @ApiOperation({ summary: '获取所有待办，保留客户端顺序' })
  tasks() {
    return this.todo.tasks();
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: '获取单个待办' })
  task(@Param('id', new SchemaPipe(idSchema)) id: string) {
    return this.todo.task(id);
  }

  @Post('tasks')
  @ApiOperation({ summary: '新增待办，ID 可省略由服务端生成' })
  @optionalMatch()
  @body(createTaskSchema)
  createTask(
    @Body(new SchemaPipe(createTaskSchema)) input: CreateTask,
    @Headers('if-match') match?: string,
  ) {
    return this.todo.createTask(input, match);
  }

  @Patch('tasks/:id')
  @ApiOperation({ summary: '修改待办字段' })
  @optionalMatch()
  @body(updateTaskSchema)
  updateTask(
    @Param('id', new SchemaPipe(idSchema)) id: string,
    @Body(new SchemaPipe(updateTaskSchema)) input: UpdateTask,
    @Headers('if-match') match?: string,
  ) {
    return this.todo.updateTask(id, input, match);
  }

  @Put('tasks/:id/completion')
  @ApiOperation({ summary: '设置完成或恢复未完成；重复完成保留首次完成时间' })
  @optionalMatch()
  @body(completionSchema)
  complete(
    @Param('id', new SchemaPipe(idSchema)) id: string,
    @Body(new SchemaPipe(completionSchema)) input: { completed: boolean },
    @Headers('if-match') match?: string,
  ) {
    return this.todo.completeTask(id, input.completed, match);
  }

  @Delete('tasks/:id')
  @ApiOperation({ summary: '删除待办，专注记录保留' })
  @optionalMatch()
  deleteTask(
    @Param('id', new SchemaPipe(idSchema)) id: string,
    @Headers('if-match') match?: string,
  ) {
    return this.todo.deleteTask(id, match);
  }

  @Get('sessions')
  @ApiOperation({ summary: '读取专注历史' })
  sessions() {
    return this.todo.sessions();
  }

  @Post('sessions')
  @ApiOperation({
    summary: '保存专注记录；相同 ID 和内容可重试，内容不同返回 409',
  })
  @optionalMatch()
  @body(sessionSchema)
  createSession(
    @Body(new SchemaPipe(sessionSchema)) session: Session,
    @Headers('if-match') match?: string,
  ) {
    return this.todo.createSession(session, match);
  }

  @Get('timer')
  @ApiOperation({
    summary: '读取计时器状态 {timer:...}；无计时器返回 {timer:null}',
  })
  timer() {
    return this.todo.timer();
  }

  @Put('timer')
  @ApiOperation({
    summary: '保存计时器状态，传 {timer:null} 清空；客户端负责计时和结算',
  })
  @optionalMatch()
  @body(timerInputSchema)
  setTimer(
    @Body(new SchemaPipe(timerInputSchema)) input: { timer: Timer | null },
    @Headers('if-match') match?: string,
  ) {
    return this.todo.setTimer(input.timer, match);
  }

  @Delete('timer')
  @ApiOperation({ summary: '清空计时器' })
  @optionalMatch()
  clearTimer(@Headers('if-match') match?: string) {
    return this.todo.setTimer(null, match);
  }

  @Get('stats')
  @ApiOperation({
    summary: '按北京时间统计近 N 天专注分钟、完成数量、每日柱状及分类数据',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    example: 7,
    description: '1～366，默认 7',
  })
  stats(@Query('days', new SchemaPipe(daysSchema)) days: number) {
    return this.todo.stats(days);
  }
}
