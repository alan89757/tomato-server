import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

export const categories = ['工作', '学习', '生活'] as const;
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const timestamp = z.iso.datetime({ offset: true, precision: 3 });
const date = z.iso.date();
const taskFields = {
  title: z.string().trim().min(1).max(80),
  note: z.string().max(500),
  category: z.enum(categories),
  estimatedPomodoros: z.number().int().min(1).max(1000),
  durationMinutes: z.number().int().min(1).max(180),
  dueDate: date.nullable(),
  theme: z.enum(['sky', 'city', 'mint', 'violet']).optional(),
  kind: z.enum(['pomodoro', 'goal', 'habit']).optional(),
  timingMode: z.enum(['countdown', 'countup', 'untimed']).optional(),
};
export const taskInputSchema = z.strictObject(taskFields);
export const taskSchema = z.strictObject({
  id,
  ...taskFields,
  createdAt: timestamp,
  completedAt: timestamp.nullable(),
});
export const createTaskSchema = z.strictObject({
  id: id.optional(),
  ...taskFields,
});
export const updateTaskSchema = taskInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, '至少传入一个待办字段');
export const completionSchema = z.strictObject({ completed: z.boolean() });
export const sessionSchema = z.strictObject({
  id,
  taskId: id,
  taskTitle: z.string().min(1).max(80),
  category: z.enum(categories),
  durationMinutes: z.number().positive().max(10080),
  completedAt: timestamp,
});
const epoch = z.number().int().min(0).max(8640000000000000);
export const timerSchema = z
  .strictObject({
    id,
    taskId: id.nullable(),
    taskTitle: z.string().min(1).max(80),
    category: z.enum(categories),
    mode: z.enum(['focus', 'break']),
    durationMinutes: z.number().int().min(1).max(180),
    remainingSeconds: z.number().int().min(0).max(10800),
    endsAt: epoch.nullable(),
    timingMode: z.enum(['countdown', 'countup']).optional(),
    startedAt: epoch.nullable().optional(),
    elapsedSeconds: z.number().int().min(0).max(604800).optional(),
    finishedAt: epoch.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.remainingSeconds > v.durationMinutes * 60) {
      ctx.addIssue({
        code: 'custom',
        path: ['remainingSeconds'],
        message: '剩余秒数不能超过设定时长',
      });
    }
    if (v.timingMode === 'countup' && v.endsAt !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: '正向计时 endsAt 必须为 null',
      });
    }
  });
export const timerInputSchema = z.strictObject({
  timer: timerSchema.nullable(),
});
export const snapshotSchema = z
  .strictObject({
    version: z.literal(1),
    tasks: z.array(taskSchema).max(10000),
    sessions: z.array(sessionSchema).max(50000),
    timer: timerSchema.nullable(),
    abandoned: z
      .array(z.strictObject({ id, abandonedAt: timestamp }))
      .max(50000)
      .optional(),
  })
  .superRefine((v, ctx) => {
    for (const key of ['tasks', 'sessions', 'abandoned'] as const) {
      if (
        new Set((v[key] ?? []).map((item) => item.id)).size !==
        (v[key] ?? []).length
      ) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'ID 不可重复' });
      }
    }
  });
export const daysSchema = z.coerce.number().int().min(1).max(366).default(7);
export const idSchema = id;
export type Task = z.infer<typeof taskSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Timer = z.infer<typeof timerSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type CreateTask = z.infer<typeof createTaskSchema>;
export type UpdateTask = z.infer<typeof updateTaskSchema>;

export class SchemaPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}
  transform(value: unknown) {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        message: '请求数据格式无效',
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return parsed.data;
  }
}
