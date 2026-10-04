import 'dotenv/config';
import mysql from 'mysql2/promise';

export const dbOptions = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true,
  connectTimeout: 10000,
};
export function checkedIdentifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]+$/.test(value))
    throw new Error('无效数据库标识符');
  return '`' + value + '`';
}
export async function connect(options = dbOptions) {
  checkedIdentifier(options.database);
  if (!options.user || !options.password)
    throw new Error('请先配置 .env 中的数据库账号与密码');
  return mysql.createConnection(options);
}
