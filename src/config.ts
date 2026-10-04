import 'dotenv/config';
import { z } from 'zod';

const identifier = /^[a-zA-Z0-9_]+$/;
const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DB_HOST: z.string().default('127.0.0.1'),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_NAME: z.string().regex(identifier),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:8081,http://127.0.0.1:8081'),
    API_KEY: z.string().default(''),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.API_KEY.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_KEY'],
        message: '生产环境 API_KEY 至少 32 个字符',
      });
    }
  });

const result = schema.safeParse(process.env);
if (!result.success) {
  // Never include environment values in startup errors.
  throw new Error(
    `环境变量配置无效：${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
  );
}
export const config = result.data;
