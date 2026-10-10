import {
  ConflictException,
  HttpException,
  Injectable,
  Inject,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service.js';
import { Versioned } from '../common/http.js';
import type {
  CreateTask,
  Session,
  Snapshot,
  Task,
  Timer,
  UpdateTask,
} from './schemas.js';
import { summarize } from './stats.js';

interface StateRow extends RowDataPacket {
  revision: string;
  timer: Timer | string | null;
}
interface TaskRow extends RowDataPacket {
  id: string;
  title: string;
  note: string;
  category: Task['category'];
  estimated_pomodoros: number;
  duration_minutes: number;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  theme: Task['theme'] | null;
  kind: Task['kind'] | null;
  timing_mode: Task['timingMode'] | null;
}
interface SessionRow extends RowDataPacket {
  id: string;
  task_id: string;
  task_title: string;
  category: Session['category'];
  duration_minutes: number;
  completed_at: string;
}
const iso = (value: string) =>
  new Date(value.replace(' ', 'T') + 'Z').toISOString();
const sqlDate = (value: string | null) =>
  value === null
    ? null
    : new Date(value).toISOString().slice(0, 23).replace('T', ' ');
const taskColumns =
  'user_id,id,title,note,category,estimated_pomodoros,duration_minutes,due_date,created_at,completed_at,theme,kind,timing_mode,sort_order';
const sessionColumns =
  'user_id,id,task_id,task_title,category,duration_minutes,completed_at,sort_order';
const taskValues = (t: Task, order: number) => [
  t.id,
  t.title,
  t.note,
  t.category,
  t.estimatedPomodoros,
  t.durationMinutes,
  t.dueDate,
  sqlDate(t.createdAt),
  sqlDate(t.completedAt),
  t.theme ?? null,
  t.kind ?? null,
  t.timingMode ?? null,
  order,
];
const sessionValues = (s: Session, order: number) => [
  s.id,
  s.taskId,
  s.taskTitle,
  s.category,
  s.durationMinutes,
  sqlDate(s.completedAt),
  order,
];

@Injectable()
export class TodoService {
  private userId = 0;
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  private async transact<T>(
    operation: (connection: PoolConnection, state: StateRow) => Promise<T>,
    write = false,
    expected?: string,
    required = false,
  ): Promise<Versioned<T>> {
    const user = await this.auth.me(this.request.header('authorization'));
    if (!Number.isSafeInteger(user.id) || user.id <= 0)
      throw new UnauthorizedException('请先登录');
    this.userId = user.id;
    if (required && expected === undefined)
      throw new HttpException(
        '保存快照需要 If-Match，请先 GET /api/snapshot 获取 ETag',
        428,
      );
    if (expected !== undefined && !/^"(?:0|[1-9]\d*)"$/.test(expected))
      throw new HttpException(
        'If-Match 必须是服务器返回的完整 ETag，例如 "0"',
        400,
      );
    const connection = await this.db.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'INSERT IGNORE INTO user_app_state (user_id, revision, timer) VALUES (?,0,NULL)',
        [this.userId],
      );
      const [rows] = await connection.query<StateRow[]>(
        'SELECT revision,timer FROM user_app_state WHERE user_id=? FOR UPDATE',
        [this.userId],
      );
      const state = rows[0];
      if (!state) throw new Error('Missing app_state');
      const revision = String(state.revision);
      if (expected !== undefined && expected !== `"${revision}"`)
        throw new ConflictException({
          message: '数据已被更新，请重新加载后合并修改',
          currentETag: `"${revision}"`,
        });
      const value = await operation(connection, state);
      const nextRevision = write ? String(BigInt(revision) + 1n) : revision;
      if (write)
        await connection.execute(
          'UPDATE user_app_state SET revision=? WHERE user_id=?',
          [nextRevision, this.userId],
        );
      await connection.commit();
      return new Versioned(value, nextRevision, this.userId);
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY')
        throw new ConflictException('ID 已存在');
      throw error;
    } finally {
      connection.release();
    }
  }

  private async readTasks(connection: PoolConnection): Promise<Task[]> {
    const [rows] = await connection.query<TaskRow[]>(
      'SELECT * FROM user_tasks WHERE user_id=? ORDER BY sort_order,id',
      [this.userId],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      note: r.note,
      category: r.category,
      estimatedPomodoros: r.estimated_pomodoros,
      durationMinutes: r.duration_minutes,
      dueDate: r.due_date,
      createdAt: iso(r.created_at),
      completedAt: r.completed_at === null ? null : iso(r.completed_at),
      ...(r.theme === null ? {} : { theme: r.theme }),
      ...(r.kind === null ? {} : { kind: r.kind }),
      ...(r.timing_mode === null ? {} : { timingMode: r.timing_mode }),
    }));
  }
  private async readSessions(connection: PoolConnection): Promise<Session[]> {
    const [rows] = await connection.query<SessionRow[]>(
      'SELECT * FROM user_sessions WHERE user_id=? ORDER BY sort_order,id',
      [this.userId],
    );
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      taskTitle: r.task_title,
      category: r.category,
      durationMinutes: r.duration_minutes,
      completedAt: iso(r.completed_at),
    }));
  }
  private async readAbandoned(connection: PoolConnection) {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT id,abandoned_at FROM user_abandoned_sessions WHERE user_id=? ORDER BY sort_order,id',
      [this.userId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      abandonedAt: iso(String(row.abandoned_at)),
    }));
  }
  private timerFrom(state: StateRow): Timer | null {
    return typeof state.timer === 'string'
      ? (JSON.parse(state.timer) as Timer)
      : state.timer;
  }
  private async readSnapshot(
    connection: PoolConnection,
    state: StateRow,
  ): Promise<Snapshot> {
    return {
      version: 1,
      tasks: await this.readTasks(connection),
      sessions: await this.readSessions(connection),
      timer: this.timerFrom(state),
      abandoned: await this.readAbandoned(connection),
    };
  }
  load() {
    return this.transact((connection, state) =>
      this.readSnapshot(connection, state),
    );
  }
  save(snapshot: Snapshot, expected?: string) {
    return this.transact(
      async (connection) => {
        await connection.query('DELETE FROM user_tasks WHERE user_id=?', [
          this.userId,
        ]);
        await connection.query('DELETE FROM user_sessions WHERE user_id=?', [
          this.userId,
        ]);
        await connection.query(
          'DELETE FROM user_abandoned_sessions WHERE user_id=?',
          [this.userId],
        );
        // Batches keep statement sizes bounded and reduce round trips.
        for (let i = 0; i < snapshot.tasks.length; i += 200) {
          await connection.query(
            `INSERT INTO user_tasks (${taskColumns}) VALUES ?`,
            [
              snapshot.tasks
                .slice(i, i + 200)
                .map((t, n) => [this.userId, ...taskValues(t, i + n)]),
            ],
          );
        }
        for (let i = 0; i < snapshot.sessions.length; i += 200) {
          await connection.query(
            `INSERT INTO user_sessions (${sessionColumns}) VALUES ?`,
            [
              snapshot.sessions
                .slice(i, i + 200)
                .map((s, n) => [this.userId, ...sessionValues(s, i + n)]),
            ],
          );
        }
        const abandoned = snapshot.abandoned ?? [];
        for (let i = 0; i < abandoned.length; i += 200) {
          await connection.query(
            'INSERT INTO user_abandoned_sessions (user_id,id,abandoned_at,sort_order) VALUES ?',
            [
              abandoned
                .slice(i, i + 200)
                .map((record, index) => [
                  this.userId,
                  record.id,
                  sqlDate(record.abandonedAt),
                  i + index,
                ]),
            ],
          );
        }
        await connection.execute(
          'UPDATE user_app_state SET timer=? WHERE user_id=?',
          [
            snapshot.timer === null ? null : JSON.stringify(snapshot.timer),
            this.userId,
          ],
        );
        return snapshot;
      },
      true,
      expected,
      true,
    );
  }
  tasks() {
    return this.transact((connection) => this.readTasks(connection));
  }
  task(id: string) {
    return this.transact(async (connection) => {
      const task = (await this.readTasks(connection)).find((t) => t.id === id);
      if (!task) throw new NotFoundException('待办不存在');
      return task;
    });
  }
  createTask(input: CreateTask, expected?: string) {
    return this.transact(
      async (connection) => {
        const task: Task = {
          ...input,
          id: input.id ?? randomUUID(),
          createdAt: new Date().toISOString(),
          completedAt: null,
        };
        const [rows] = await connection.query<RowDataPacket[]>(
          'SELECT COALESCE(MIN(sort_order),0)-1 AS position FROM user_tasks WHERE user_id=?',
          [this.userId],
        );
        await connection.query(
          `INSERT INTO user_tasks (${taskColumns}) VALUES ?`,
          [[[this.userId, ...taskValues(task, Number(rows[0].position))]]],
        );
        return task;
      },
      true,
      expected,
    );
  }
  private async updateTaskRow(
    connection: PoolConnection,
    id: string,
    patch: UpdateTask & { completedAt?: string | null },
  ): Promise<Task> {
    const task = (await this.readTasks(connection)).find((t) => t.id === id);
    if (!task) throw new NotFoundException('待办不存在');
    const next: Task = { ...task, ...patch };
    await connection.execute(
      'UPDATE user_tasks SET title=?,note=?,category=?,estimated_pomodoros=?,duration_minutes=?,due_date=?,created_at=?,completed_at=?,theme=?,kind=?,timing_mode=? WHERE user_id=? AND id=?',
      [...taskValues(next, 0).slice(1, -1), this.userId, id],
    );
    return next;
  }
  updateTask(id: string, patch: UpdateTask, expected?: string) {
    return this.transact(
      (connection) => this.updateTaskRow(connection, id, patch),
      true,
      expected,
    );
  }
  completeTask(id: string, completed: boolean, expected?: string) {
    return this.transact(
      async (connection) => {
        const task = (await this.readTasks(connection)).find(
          (t) => t.id === id,
        );
        if (!task) throw new NotFoundException('待办不存在');
        return this.updateTaskRow(connection, id, {
          completedAt: completed
            ? (task.completedAt ?? new Date().toISOString())
            : null,
        });
      },
      true,
      expected,
    );
  }
  deleteTask(id: string, expected?: string) {
    return this.transact(
      async (connection) => {
        const tasks = await this.readTasks(connection);
        if (!tasks.some((t) => t.id === id))
          throw new NotFoundException('待办不存在');
        await connection.execute(
          'DELETE FROM user_tasks WHERE user_id=? AND id=?',
          [this.userId, id],
        );
        return { deleted: true };
      },
      true,
      expected,
    );
  }
  sessions() {
    return this.transact((connection) => this.readSessions(connection));
  }
  createSession(session: Session, expected?: string) {
    return this.transact(
      async (connection) => {
        const sessions = await this.readSessions(connection);
        const previous = sessions.find((s) => s.id === session.id);
        if (previous) {
          const normalized = {
            ...session,
            completedAt: new Date(session.completedAt).toISOString(),
          };
          if (
            Object.keys(previous).some(
              (key) =>
                previous[key as keyof Session] !==
                normalized[key as keyof Session],
            )
          )
            throw new ConflictException('同一专注记录 ID 已存在且内容不同');
          return previous;
        }
        const [rows] = await connection.query<RowDataPacket[]>(
          'SELECT COALESCE(MAX(sort_order),-1)+1 AS position FROM user_sessions WHERE user_id=?',
          [this.userId],
        );
        await connection.query(
          `INSERT INTO user_sessions (${sessionColumns}) VALUES ?`,
          [
            [
              [
                this.userId,
                ...sessionValues(session, Number(rows[0].position)),
              ],
            ],
          ],
        );
        return session;
      },
      true,
      expected,
    );
  }
  timer() {
    return this.transact(async (_connection, state) => ({
      timer: this.timerFrom(state),
    }));
  }
  setTimer(timer: Timer | null, expected?: string) {
    return this.transact(
      async (connection) => {
        await connection.execute(
          'UPDATE user_app_state SET timer=? WHERE user_id=?',
          [timer === null ? null : JSON.stringify(timer), this.userId],
        );
        return { timer };
      },
      true,
      expected,
    );
  }
  stats(days: number) {
    return this.transact(async (connection, state) =>
      summarize(await this.readSnapshot(connection, state), days),
    );
  }
}
