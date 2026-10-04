import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { connect, dbOptions } from './db-utils.mjs';

export async function migrate(options = dbOptions) {
  const sql = await readFile(
    new URL('../sql/001_initial_schema.sql', import.meta.url),
    'utf8',
  );
  const checksum = createHash('sha256').update(sql).digest('hex');
  const version = '001_initial_schema';
  const connection = await connect(options);
  try {
    const [[lock]] = await connection.query(
      "SELECT GET_LOCK('tomato_schema_migration',30) AS acquired",
    );
    if (lock.acquired !== 1) throw new Error('数据库迁移被另一进程占用');
    const statements = sql
      .replace(/^\s*--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    await connection.query(statements[0]);
    const [[existing]] = await connection.execute(
      'SELECT checksum FROM schema_migrations WHERE version=?',
      [version],
    );
    if (existing) {
      if (existing.checksum !== checksum)
        throw new Error(
          '已执行的迁移文件发生变更；请新增迁移，勿修改历史 SQL。',
        );
      return { applied: false, version };
    }
    // MySQL DDL implicitly commits. Statements are individually rerunnable after interruption.
    for (const statement of statements.slice(1))
      await connection.query(statement);
    await connection.execute(
      'INSERT INTO schema_migrations(version,checksum) VALUES (?,?)',
      [version, checksum],
    );
    return { applied: true, version };
  } finally {
    try {
      await connection.query("SELECT RELEASE_LOCK('tomato_schema_migration')");
    } finally {
      await connection.end();
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(await migrate());
  } catch (error) {
    console.error(`迁移失败：${error.code ?? error.message}`);
    process.exitCode = 1;
  }
}
