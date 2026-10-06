import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapshotSchema,
  timerSchema,
  taskSchema,
} from '../dist/todo/schemas.js';
import { summarize } from '../dist/todo/stats.js';

const task = {
  id: 'client-task-1',
  title: '学习',
  note: '',
  category: '学习',
  estimatedPomodoros: 2,
  durationMinutes: 25,
  dueDate: '2026-10-04',
  createdAt: '2026-10-03T10:00:00.000Z',
  completedAt: null,
};
test('客户端快照允许历史记录引用已删除待办，拒绝重复 ID、未知字段与非法日期', () => {
  const snapshot = {
    version: 1,
    tasks: [task],
    sessions: [
      {
        id: 'old-session',
        taskId: 'deleted-task',
        taskTitle: '旧任务',
        category: '工作',
        durationMinutes: 1 / 60,
        completedAt: '2026-10-03T16:00:00.000Z',
      },
    ],
    timer: null,
  };
  assert.ok(snapshotSchema.safeParse(snapshot).success);
  assert.ok(
    !snapshotSchema.safeParse({ ...snapshot, tasks: [task, task] }).success,
  );
  assert.ok(!taskSchema.safeParse({ ...task, dueDate: '2026-02-30' }).success);
  assert.ok(!taskSchema.safeParse({ ...task, admin: true }).success);
  assert.ok(!taskSchema.safeParse({ ...task, title: '   ' }).success);
});
test('计时器支持正向计时和空状态，拒绝负秒数、不完整字段和超出时长', () => {
  const timer = {
    id: 'timer-1',
    taskId: null,
    taskTitle: '自由专注',
    category: '生活',
    mode: 'focus',
    durationMinutes: 25,
    remainingSeconds: 1500,
    endsAt: null,
    timingMode: 'countup',
    startedAt: 1,
    elapsedSeconds: 0,
  };
  assert.ok(timerSchema.safeParse(timer).success);
  assert.ok(!timerSchema.safeParse({ ...timer, remainingSeconds: -1 }).success);
  assert.ok(
    !timerSchema.safeParse({ ...timer, remainingSeconds: 1501 }).success,
  );
  assert.ok(!timerSchema.safeParse({ ...timer, endsAt: undefined }).success);
});
test('统计使用北京时间的日界线，不包含未来日期且保留小数专注时长', () => {
  const sessions = [
    {
      id: 'before',
      taskId: 'free',
      taskTitle: '自由',
      category: '生活',
      durationMinutes: 25,
      completedAt: '2026-10-03T15:59:59.999Z',
    },
    {
      id: 'today',
      taskId: 'free',
      taskTitle: '自由',
      category: '生活',
      durationMinutes: 1.5,
      completedAt: '2026-10-03T16:00:00.000Z',
    },
    {
      id: 'future',
      taskId: 'free',
      taskTitle: '自由',
      category: '生活',
      durationMinutes: 25,
      completedAt: '2026-10-04T16:00:00.000Z',
    },
  ];
  const result = summarize(
    {
      version: 1,
      tasks: [{ ...task, completedAt: '2026-10-03T16:00:00.000Z' }],
      sessions,
      timer: null,
    },
    1,
    new Date('2026-10-04T05:00:00.000Z'),
  );
  assert.equal(result.minutes, 1.5);
  assert.equal(result.completed, 1);
  assert.deepEqual(result.bars, [
    { key: '2026-10-04', label: '10/4', minutes: 1.5 },
  ]);
});

test('放弃记录校验、旧快照兼容和统计', () => {
  const empty = { version: 1, tasks: [], sessions: [], timer: null };
  const abandoned = {
    id: 'abandoned-1',
    abandonedAt: '2026-10-04T02:00:00.000Z',
  };
  assert.ok(snapshotSchema.safeParse(empty).success);
  const snapshot = { ...empty, abandoned: [abandoned] };
  assert.ok(snapshotSchema.safeParse(snapshot).success);
  assert.ok(
    !snapshotSchema.safeParse({
      ...snapshot,
      abandoned: [abandoned, abandoned],
    }).success,
  );
  assert.ok(
    !snapshotSchema.safeParse({
      ...snapshot,
      abandoned: [{ ...abandoned, abandonedAt: 'invalid' }],
    }).success,
  );
  assert.equal(
    summarize(snapshot, 1, new Date('2026-10-04T03:00:00.000Z')).abandoned,
    1,
  );
  assert.equal(
    summarize(snapshot, 1, new Date('2026-10-05T03:00:00.000Z')).abandoned,
    0,
  );
});
