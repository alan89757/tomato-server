import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TodoService } from '../dist/todo/todo.service.js';

// Shared connection fixture checks query ownership and parameter shapes without MySQL.
function fixture() {
  const state = new Map();
  const tables = new Map(
    ['user_tasks', 'user_sessions', 'user_abandoned_sessions'].map((name) => [
      name,
      [],
    ]),
  );
  let queries = 0;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, args) {
      return this.query(sql, args);
    },
    async query(sql, args = []) {
      queries++;
      if (sql.startsWith('INSERT IGNORE INTO user_app_state')) {
        if (!state.has(args[0]))
          state.set(args[0], { revision: '0', timer: null });
        return [[]];
      }
      if (sql.startsWith('SELECT revision,timer FROM user_app_state')) {
        assert.match(sql, /WHERE user_id=\? FOR UPDATE$/);
        return [[state.get(args[0])]];
      }
      if (sql.startsWith('UPDATE user_app_state')) {
        assert.match(sql, /WHERE user_id=\?$/);
        const row = state.get(args[1]);
        if (sql.includes('revision=?')) row.revision = args[0];
        else row.timer = args[0];
        return [[]];
      }
      const insert = /^INSERT INTO (user_\w+) \(([^)]+)\) VALUES \?$/.exec(sql);
      if (insert) {
        const cols = insert[2].split(',');
        for (const values of args[0]) {
          assert.equal(
            values.length,
            cols.length,
            'every inserted row includes its owner',
          );
          const row = Object.fromEntries(cols.map((c, i) => [c, values[i]]));
          assert.ok(row.user_id > 0);
          assert.ok(
            !tables
              .get(insert[1])
              .some((r) => r.user_id === row.user_id && r.id === row.id),
          );
          tables.get(insert[1]).push(row);
        }
        return [[]];
      }
      const from = /FROM (user_\w+) WHERE user_id=\?/.exec(sql);
      if (from) {
        let rows = tables.get(from[1]);
        const owned = rows.filter((r) => r.user_id === args[0]);
        if (sql.startsWith('DELETE')) {
          tables.set(
            from[1],
            rows.filter(
              (r) =>
                r.user_id !== args[0] ||
                (sql.includes('AND id=?') && r.id !== args[1]),
            ),
          );
          return [[]];
        }
        if (sql.includes('AS position'))
          return [[{ position: sql.includes('MIN(') ? -1 : owned.length }]];
        return [owned.map((r) => ({ ...r }))];
      }
      if (sql.startsWith('UPDATE user_tasks SET')) {
        assert.match(sql, /WHERE user_id=\? AND id=\?$/);
        const columns = sql
          .slice(sql.indexOf(' SET ') + 5, sql.indexOf(' WHERE'))
          .split(',')
          .map((c) => c.split('=')[0]);
        const row = tables
          .get('user_tasks')
          .find((r) => r.user_id === args.at(-2) && r.id === args.at(-1));
        for (let i = 0; i < columns.length; i++) row[columns[i]] = args[i];
        return [[]];
      }
      throw new Error('Unexpected or unscoped SQL: ' + sql);
    },
  };
  const db = {
    pool: {
      async getConnection() {
        return connection;
      },
    },
  };
  const auth = {
    async me(header) {
      if (!/^Bearer [12]$/.test(header ?? '')) throw new Error('Unauthorized');
      return { id: Number(header.slice(-1)) };
    },
  };
  return {
    service: (id) =>
      new TodoService(db, auth, {
        header: () => (id ? `Bearer ${id}` : undefined),
      }),
    queryCount: () => queries,
  };
}
const empty = {
  version: 1,
  tasks: [],
  sessions: [],
  abandoned: [],
  timer: null,
};
const task = {
  id: 'same-id',
  title: 'first',
  note: '',
  category: '学习',
  estimatedPomodoros: 1,
  durationMinutes: 25,
  dueDate: null,
  createdAt: '2026-10-10T00:00:00.000Z',
  completedAt: null,
};
const session = {
  id: 'same-session',
  taskId: task.id,
  taskTitle: task.title,
  category: task.category,
  durationMinutes: 25,
  completedAt: task.createdAt,
};

test('所有待办接口按登录用户隔离，同 ID、版本、历史和计时器互不影响', async () => {
  const f = fixture(),
    first = f.service(1),
    second = f.service(2);
  const original = {
    ...empty,
    tasks: [task],
    sessions: [session],
    abandoned: [{ id: 'same-event', abandonedAt: task.createdAt }],
  };
  await first.save(original, '"0"');
  assert.deepEqual((await second.load()).value, empty);
  assert.equal((await second.load()).revision, '0');
  assert.equal((await first.load()).userId, 1);
  assert.equal((await second.load()).userId, 2);
  await assert.rejects(second.task(task.id), /待办不存在/);
  await assert.rejects(
    second.updateTask(task.id, { title: 'stolen' }),
    /待办不存在/,
  );
  await assert.rejects(second.deleteTask(task.id), /待办不存在/);
  await second.createTask({ ...task, title: 'second' });
  await second.createSession({ ...session, taskTitle: 'second' });
  await second.updateTask(task.id, { note: 'second note' });
  await second.completeTask(task.id, true);
  const timer = {
    id: 'same-timer',
    taskId: task.id,
    taskTitle: 'second',
    category: '学习',
    mode: 'focus',
    durationMinutes: 25,
    remainingSeconds: 1500,
    endsAt: null,
  };
  await second.setTimer(timer);
  assert.deepEqual((await first.timer()).value, { timer: null });
  assert.deepEqual((await second.timer()).value, { timer });
  assert.equal((await second.stats(366)).value.sessions[0].taskTitle, 'second');
  await second.save(empty, `"${(await second.load()).revision}"`);
  assert.deepEqual((await second.load()).value, empty);
  assert.deepEqual((await first.load()).value, original);
  assert.equal((await first.load()).revision, '1');
  await assert.rejects(first.save(empty, '"0"'), /数据已被更新/);
  assert.equal((await first.tasks()).value[0].title, 'first');
  assert.deepEqual((await first.sessions()).value, [session]);
  await first.deleteTask(task.id);
  assert.deepEqual((await first.sessions()).value, [session]);
  const count = f.queryCount();
  await assert.rejects(f.service(null).load(), /Unauthorized/);
  assert.equal(
    f.queryCount(),
    count,
    'unauthenticated access never reads todo tables',
  );
});
