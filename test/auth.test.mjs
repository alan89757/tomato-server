import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AuthService,
  hashPassword,
  verifyPassword,
} from '../dist/auth/auth.service.js';

// These tests need no running MySQL. Database-backed routes are covered in api.test.mjs.
test('密码使用随机盐，正确密码通过，错误密码和损坏哈希被拒绝', async () => {
  const first = await hashPassword('123456');
  const second = await hashPassword('123456');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('123456', first), true);
  assert.equal(await verifyPassword('wrong', first), false);
  assert.equal(await verifyPassword('123456', 'invalid'), false);
});

test('默认账号幂等创建；登录签发随机会话，数据库只接收摘要', async () => {
  let admin;
  let saved;
  const db = {
    pool: {
      async execute(sql, args) {
        if (sql.startsWith('INSERT IGNORE INTO users'))
          admin ??= { id: 1, username: args[0], password_hash: args[1] };
        if (sql.startsWith('SELECT id, username'))
          return [
            [args[0] === admin?.username ? admin : undefined].filter(Boolean),
          ];
        if (sql.startsWith('INSERT INTO auth_sessions')) saved = args;
        return [[]];
      },
    },
  };
  const auth = new AuthService(db);
  await auth.onModuleInit();
  const original = admin.password_hash;
  await auth.onModuleInit();
  assert.equal(admin.password_hash, original);
  await assert.rejects(auth.login('admin', 'wrong'), /用户名或密码错误/);
  await assert.rejects(auth.login('unknown', '123456'), /用户名或密码错误/);
  const login = await auth.login('admin', '123456');
  assert.deepEqual(login.user, { id: 1, username: 'admin' });
  assert.match(login.token, /^[a-f0-9]{64}$/);
  assert.equal(
    saved[0],
    createHash('sha256').update(login.token).digest('hex'),
  );
  assert.notEqual(saved[0], login.token);
  assert.equal(saved[1], 1);
  assert.ok(Date.parse(login.expiresAt) > Date.now());
  const next = await auth.login('admin', '123456');
  assert.notEqual(next.token, login.token);
  await assert.rejects(auth.me(), /请先登录/);
  await assert.rejects(auth.me('Bearer invalid'), /请先登录/);
});

test('错误密码连续尝试十次后限流', async () => {
  const auth = new AuthService({
    pool: {
      async execute() {
        return [[]];
      },
    },
  });
  await auth.onModuleInit();
  for (let i = 0; i < 10; i++)
    await assert.rejects(auth.login('unknown', 'wrong'), /用户名或密码错误/);
  await assert.rejects(
    auth.login('unknown', 'wrong'),
    (error) => error.getStatus() === 429,
  );
});
