import { mkdir, writeFile } from 'node:fs/promises';
import { connect, checkedIdentifier } from './db-utils.mjs';

const connection = await connect();
try {
  const [tables] = await connection.query('SHOW TABLES');
  const names = tables.map((row) => Object.values(row)[0]).sort();
  const lines = [
    '-- MySQL schema backup; no user task/session/timer data included.',
    '-- Restore into an empty database, then run pnpm db:migrate.',
    'SET NAMES utf8mb4;',
    '',
  ];
  for (const name of names) {
    const [[row]] = await connection.query(
      `SHOW CREATE TABLE ${checkedIdentifier(name)}`,
    );
    lines.push(row['Create Table'] + ';', '');
  }
  lines.push(
    'INSERT IGNORE INTO app_state (id,revision,timer) VALUES (1,0,NULL);',
    '',
  );
  const directory = new URL('../sql/backups/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const filename = `schema-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
  await writeFile(new URL(filename, directory), lines.join('\n'), 'utf8');
  console.log(`已备份 ${names.length} 张表结构：sql/backups/${filename}`);
} finally {
  await connection.end();
}
