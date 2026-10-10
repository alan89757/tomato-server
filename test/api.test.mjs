import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { migrate } from '../scripts/migrate.mjs';
import { checkedIdentifier } from '../scripts/db-utils.mjs';

// Integration tests use an isolated, randomly named database, never tomato_todo.
test(
  '真实 MySQL：快照事务、冲突、校验、CRUD、历史、鉴权与重启持久化',
  { timeout: 90000 },
  async (t) => {
    let adminPassword = process.env.TEST_DB_PASSWORD;
    if (!adminPassword) {
      const ini = await readFile(
        `${process.env.ProgramData ?? 'C:/ProgramData'}/MySQL/TomatoMySQL84/admin.cnf`,
        'utf8',
      );
      adminPassword = ini.match(/^password=(.+)$/m)?.[1].trim();
    }
    assert.ok(
      adminPassword,
      '需要 TEST_DB_PASSWORD 或本机安装生成的 admin.cnf',
    );
    const options = {
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.TEST_DB_USER ?? 'root',
      password: adminPassword,
      charset: 'utf8mb4',
    };
    const admin = await mysql.createConnection(options);
    const database = 'tomato_test_' + randomBytes(8).toString('hex');
    const socket = createServer();
    await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const key = randomBytes(24).toString('hex');
    const url = `http://127.0.0.1:${port}/api`;
    let processHandle;
    let output = '';
    async function stop() {
      if (processHandle && processHandle.exitCode === null) {
        const exited = once(processHandle, 'exit');
        processHandle.kill();
        await exited;
      }
    }
    async function start() {
      processHandle = spawn(process.execPath, ['dist/main.js'], {
        cwd: new URL('../', import.meta.url),
        windowsHide: true,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          HOST: '127.0.0.1',
          PORT: String(port),
          DB_USER: options.user,
          DB_PASSWORD: adminPassword,
          DB_NAME: database,
          API_KEY: key,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      processHandle.stdout.on('data', (data) => {
        output += data;
      });
      processHandle.stderr.on('data', (data) => {
        output += data;
      });
      for (let i = 0; i < 100; i++) {
        if (processHandle.exitCode !== null)
          throw new Error(`测试服务启动失败：${output}`);
        try {
          const response = await fetch(`${url}/health`, {
            headers: { 'X-API-Key': key },
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`测试服务启动超时：${output}`);
    }
    async function request(
      path,
      { method = 'GET', body, etag, withKey = true, token } = {},
    ) {
      const response = await fetch(url + path, {
        method,
        headers: {
          ...(withKey ? { 'X-API-Key': key } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(etag ? { 'If-Match': etag } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      return {
        status: response.status,
        body: await response.json(),
        etag: response.headers.get('etag'),
      };
    }
    try {
      await admin.query(
        `CREATE DATABASE ${checkedIdentifier(database)} CHARACTER SET utf8mb4`,
      );
      assert.equal((await migrate({ ...options, database })).applied, true);
      assert.equal((await migrate({ ...options, database })).applied, false);
      await start();
      await t.test('默认账号、密码校验、会话及退出登录', async () => {
        assert.equal((await request('/auth/me')).status, 401);
        assert.equal(
          (
            await request('/auth/login', {
              method: 'POST',
              body: { username: 'admin', password: 'wrong' },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await request('/auth/login', {
              method: 'POST',
              body: { username: 'missing', password: '123456' },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await request('/auth/login', {
              method: 'POST',
              body: { username: '', password: '' },
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request('/auth/login', {
              method: 'POST',
              withKey: false,
              body: { username: 'admin', password: '123456' },
            })
          ).status,
          401,
        );
        const login = await request('/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: '123456' },
        });
        assert.equal(login.status, 200);
        assert.equal(login.body.user.username, 'admin');
        assert.equal(login.body.user.password_hash, undefined);
        assert.match(login.body.token, /^[a-f0-9]{64}$/);
        assert.ok(Date.parse(login.body.expiresAt) > Date.now());
        const token = login.body.token;
        assert.equal(
          (await request('/auth/me', { token })).body.username,
          'admin',
        );
        assert.equal(
          (await request('/auth/me', { token: '0'.repeat(64) })).status,
          401,
        );
        const [[stored]] = await admin.query(
          `SELECT password_hash FROM ${checkedIdentifier(database)}.users WHERE username='admin'`,
        );
        assert.notEqual(stored.password_hash, '123456');
        await stop();
        await start();
        assert.equal(
          (await request('/auth/me', { token })).body.username,
          'admin',
        );
        assert.equal(
          (await request('/auth/logout', { method: 'POST', token })).status,
          200,
        );
        assert.equal((await request('/auth/me', { token })).status, 401);
        const expired = await request('/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: '123456' },
        });
        await admin.query(
          `UPDATE ${checkedIdentifier(database)}.auth_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)`,
        );
        assert.equal(
          (await request('/auth/me', { token: expired.body.token })).status,
          401,
        );
      });
      let original;
      const task = {
        id: 'client-1',
        title: '阅读 20 页',
        note: "中文与 SQL 字符 '; DROP TABLE tasks; --",
        category: '学习',
        estimatedPomodoros: 2,
        durationMinutes: 25,
        dueDate: '2026-10-04',
        createdAt: '2026-10-04T00:00:00.000Z',
        completedAt: null,
        theme: 'sky',
        kind: 'goal',
        timingMode: 'countup',
      };
      const session = {
        id: 'session-1',
        taskId: task.id,
        taskTitle: task.title,
        category: task.category,
        durationMinutes: 1 / 60,
        completedAt: '2026-10-04T01:00:00.000Z',
      };
      const timer = {
        id: 'timer-1',
        taskId: task.id,
        taskTitle: task.title,
        category: task.category,
        mode: 'focus',
        durationMinutes: 25,
        remainingSeconds: 1500,
        endsAt: null,
        timingMode: 'countup',
        startedAt: Date.now(),
        elapsedSeconds: 13,
      };
      const snapshot = {
        version: 1,
        tasks: [task],
        sessions: [session],
        timer,
        abandoned: [
          { id: 'abandoned-1', abandonedAt: '2026-10-04T02:00:00.000Z' },
        ],
      };
      await t.test('健康检查、API Key 和初始空快照', async () => {
        assert.equal(
          (await request('/health', { withKey: false })).status,
          401,
        );
        assert.equal((await request('/health')).body.database, 'up');
        original = await request('/snapshot');
        assert.deepEqual(original.body, {
          version: 1,
          tasks: [],
          sessions: [],
          timer: null,
          abandoned: [],
        });
        assert.equal(original.etag, '"0"');
      });
      await t.test(
        '事务保存客户端快照，UTF-8、小数与计时器完整往返',
        async () => {
          assert.equal(
            (await request('/snapshot', { method: 'PUT', body: snapshot }))
              .status,
            428,
          );
          const saved = await request('/snapshot', {
            method: 'PUT',
            body: snapshot,
            etag: original.etag,
          });
          assert.equal(saved.status, 200);
          assert.deepEqual((await request('/snapshot')).body, snapshot);
        },
      );
      await t.test('校验失败与旧版本冲突均不修改原有数据', async () => {
        const before = await request('/snapshot');
        assert.equal(
          (
            await request('/snapshot', {
              method: 'PUT',
              body: { ...snapshot, tasks: [task, task] },
              etag: before.etag,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request('/snapshot', {
              method: 'PUT',
              body: { ...snapshot, timer: { ...timer, remainingSeconds: -1 } },
              etag: before.etag,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request('/snapshot', {
              method: 'PUT',
              body: snapshot,
              etag: original.etag,
            })
          ).status,
          409,
        );
        const after = await request('/snapshot');
        assert.equal(after.etag, before.etag);
        assert.deepEqual(after.body, before.body);
      });
      await t.test(
        '数据库写入中途失败会回滚删除和插入，不泄露 SQL 内容',
        async () => {
          const before = await request('/snapshot');
          const table = checkedIdentifier(database) + '.tasks';
          await admin.query(
            `ALTER TABLE ${table} ADD CONSTRAINT chk_test_rollback CHECK (title <> 'force-rollback')`,
          );
          try {
            const response = await request('/snapshot', {
              method: 'PUT',
              body: {
                ...snapshot,
                tasks: [{ ...task, title: 'force-rollback' }],
              },
              etag: before.etag,
            });
            assert.equal(response.status, 500);
            assert.equal(response.body.message, '服务器内部错误');
            const after = await request('/snapshot');
            assert.deepEqual(after.body, before.body);
            assert.equal(after.etag, before.etag);
          } finally {
            await admin.query(
              `ALTER TABLE ${table} DROP CHECK chk_test_rollback`,
            );
          }
        },
      );
      await t.test('两个同时提交的同版本快照只有一个可以成功', async () => {
        const before = await request('/snapshot');
        const results = await Promise.all([
          request('/snapshot', {
            method: 'PUT',
            body: snapshot,
            etag: before.etag,
          }),
          request('/snapshot', {
            method: 'PUT',
            body: snapshot,
            etag: before.etag,
          }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      });
      await t.test(
        '待办编辑、完成、恢复；历史写入幂等且拒绝同 ID 不同内容',
        async () => {
          assert.equal(
            (
              await request('/tasks/client-1', {
                method: 'PATCH',
                body: { note: '新备注' },
              })
            ).status,
            200,
          );
          const done = await request('/tasks/client-1/completion', {
            method: 'PUT',
            body: { completed: true },
          });
          assert.ok(done.body.completedAt);
          assert.equal(
            (
              await request('/tasks/client-1/completion', {
                method: 'PUT',
                body: { completed: true },
              })
            ).body.completedAt,
            done.body.completedAt,
          );
          assert.equal(
            (
              await request('/tasks/client-1/completion', {
                method: 'PUT',
                body: { completed: false },
              })
            ).body.completedAt,
            null,
          );
          assert.equal(
            (await request('/sessions', { method: 'POST', body: session }))
              .status,
            201,
          );
          assert.equal((await request('/sessions')).body.length, 1);
          assert.equal(
            (
              await request('/sessions', {
                method: 'POST',
                body: { ...session, durationMinutes: 26 },
              })
            ).status,
            409,
          );
          assert.equal(
            (await request('/tasks/client-1', { method: 'DELETE' })).status,
            200,
          );
          assert.equal((await request('/sessions')).body.length, 1);
          assert.equal((await request('/tasks/client-1')).status, 404);
        },
      );
      await t.test('创建默认 ID、计时器清空、查询参数与文档', async () => {
        const { id, createdAt, completedAt, ...input } = task;
        assert.equal(
          (await request('/tasks', { method: 'POST', body: input })).status,
          201,
        );
        assert.equal(
          (
            await request('/tasks', {
              method: 'POST',
              body: { ...input, durationMinutes: 0 },
            })
          ).status,
          400,
        );
        assert.equal(
          (await request('/tasks/client-1', { method: 'PATCH', body: {} }))
            .status,
          400,
        );
        assert.equal(
          (await request('/timer', { method: 'PUT', body: { timer } })).status,
          200,
        );
        assert.deepEqual((await request('/timer')).body, { timer });
        assert.equal(
          (await request('/timer', { method: 'DELETE' })).status,
          200,
        );
        assert.deepEqual((await request('/timer')).body, { timer: null });
        assert.equal((await request('/stats?days=7')).body.bars.length, 7);
        assert.equal((await request('/stats?days=0')).status, 400);
        assert.equal((await request('/stats?days=garbage')).status, 400);
        assert.ok(
          (await request('/docs-json')).body.paths['/api/snapshot'].put,
        );
      });
      await t.test('停止并重新启动 API 后数据不丢失', async () => {
        const before = await request('/snapshot');
        await stop();
        await start();
        const after = await request('/snapshot');
        assert.deepEqual(after.body, before.body);
        assert.equal(after.etag, before.etag);
      });
    } finally {
      await stop();
      // The only deleted database is the freshly generated tomato_test_<random> fixture.
      await admin.query(
        `DROP DATABASE IF EXISTS ${checkedIdentifier(database)}`,
      );
      await admin.end();
    }
  },
);
