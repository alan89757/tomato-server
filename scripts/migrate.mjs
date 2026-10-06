import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { connect, dbOptions } from './db-utils.mjs';

export async function migrate(options = dbOptions) {
  const files = (await readdir(new URL('../sql/', import.meta.url)))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  const connection = await connect(options);
  try {
    const [[lock]] = await connection.query(
      "SELECT GET_LOCK('tomato_schema_migration',30) AS acquired",
    );
    if (lock.acquired !== 1) throw new Error('数据库迁移被另一进程占用');
    const applied = [];
    for (const file of files) {
      const sql = await readFile(
        new URL('../sql/' + file, import.meta.url),
        'utf8',
      );
      const checksum = createHash('sha256').update(sql).digest('hex');
      const version = file.replace(/\.sql$/, '');
      const statements = sql
        .replace(/^\s*--.*$/gm, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      if (file === '001_initial_schema.sql')
        await connection.query(statements[0]);
      const [[existing]] = await connection.execute(
        'SELECT checksum FROM schema_migrations WHERE version=?',
        [version],
      );
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error('已执行迁移被修改：' + version);
        continue;
      }
      for (const statement of file === '001_initial_schema.sql'
        ? statements.slice(1)
        : statements)
        await connection.query(statement);
      await connection.execute(
        'INSERT INTO schema_migrations(version,checksum) VALUES (?,?)',
        [version, checksum],
      );
      applied.push(version);
    }
    return { applied: applied.length > 0, versions: applied };
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
