# Tomato Server

`C:\project\tomato-todo` 的 NestJS + MySQL 服务端。字段与客户端 `src/domain/models.ts` 一致，提供 Snapshot v1、待办、专注历史、计时器和统计接口。

当前按客户端已有单用户模型实现：所有请求访问同一份数据，未引入注册、登录或多用户隔离。可通过 `API_KEY` 限制访问；部署多用户版本时应先增加用户归属与认证。

## 本机环境

- Node.js 24.19，pnpm 11.19，NestJS 12；依赖版本由 `pnpm-lock.yaml` 锁定。
- MySQL 8.4.11 Windows 服务：`TomatoMySQL84`，开机自动启动。
- 程序：`C:\Program Files\MySQL\mysql-8.4.11-winx64`。
- 数据：`C:\ProgramData\MySQL\TomatoMySQL84\data`。
- 配置：`C:\ProgramData\MySQL\TomatoMySQL84\my.ini`。
- 管理员连接配置：同目录 `admin.cnf`，访问权限限本机安装用户、管理员及 SYSTEM。
- MySQL 仅监听 `127.0.0.1:3306`。NestJS 默认监听 `0.0.0.0:3000`，便于手机调试。
- 应用通过 `tomato_app` 连接 `tomato_todo`，不使用 root；账号仅获该数据库的数据读写和迁移所需建表权限。

MySQL 程序、数据和下载缓存均位于项目之外。项目中的 `.env` 仅保存应用连接配置，已加入 `.gitignore`。

## 启动

```powershell
cd C:\project\tomato-server
pnpm install --frozen-lockfile
# 本机安装已生成 .env；其他机器可从 .env.example 复制并修改。
pnpm db:migrate
pnpm start:dev
```

构建后运行：

```powershell
pnpm build
pnpm start:prod
```

健康检查：<http://localhost:3000/api/health>。

交互接口文档：<http://localhost:3000/api/docs>；OpenAPI JSON：<http://localhost:3000/api/docs-json>。

MySQL 服务管理（管理员 PowerShell）：

```powershell
Get-Service TomatoMySQL84
Start-Service TomatoMySQL84
Stop-Service TomatoMySQL84
```

新机器尚未安装 MySQL 时，可在管理员 PowerShell 执行 `scripts/install-mysql.ps1`。脚本下载并校验 Oracle 官方 ZIP，将程序放入 Program Files、数据放入 ProgramData，注册自动启动服务并生成随机密码；遇到已有数据或其他同名安装会停止，避免覆盖。已经完成安装的本机无需再运行。

## 接口

基础地址：`http://localhost:3000/api`。JSON 字段采用客户端的 camelCase。成功返回实际数据；错误返回 `statusCode`、`message`、`timestamp`，校验失败另带字段路径 `errors`。

| 方法   | 路径                    | 功能                                    |
| ------ | ----------------------- | --------------------------------------- |
| GET    | `/health`               | 检查数据库连通性                        |
| GET    | `/snapshot`             | 获取 `{version:1,tasks,sessions,timer}` |
| PUT    | `/snapshot`             | 事务替换整份快照，必须携带 `If-Match`   |
| GET    | `/tasks`                | 获取所有待办，保留客户端顺序            |
| GET    | `/tasks/:id`            | 获取单个待办                            |
| POST   | `/tasks`                | 新增待办，ID 可由服务端生成             |
| PATCH  | `/tasks/:id`            | 修改部分字段                            |
| PUT    | `/tasks/:id/completion` | `{completed:true/false}` 设置完成状态   |
| DELETE | `/tasks/:id`            | 删除待办，保留专注记录                  |
| GET    | `/sessions`             | 获取专注历史                            |
| POST   | `/sessions`             | 保存记录，使用客户端计时器 ID 去重      |
| GET    | `/timer`                | 获取 `{timer:...}` 或 `{timer:null}`    |
| PUT    | `/timer`                | 保存 `{timer:...}` 或 `{timer:null}`    |
| DELETE | `/timer`                | 清空计时器                              |
| GET    | `/stats?days=7`         | 近 1～366 天专注统计，默认 7 天         |

服务器保存计时器状态，计时和结束结算继续由客户端现有领域逻辑负责。休息不应生成专注记录；自由专注使用 `taskId:"free"`。支持正向计时的实际小数分钟及已删除任务的历史记录。

数据日期 `dueDate` 为 `YYYY-MM-DD` 或 null，时间戳为包含毫秒的 ISO 8601，例如 `2026-10-04T13:00:00.000Z`；数据库时间按 UTC 保存，统计按 Asia/Shanghai 的自然日计算。`durationMinutes` 为 1～180 的整数，专注历史时长可以是小数。未知字段、重复快照 ID、非法日期及越界数值返回 400。

新增待办示例：

```json
{
  "title": "阅读 20 页",
  "note": "记录一个新想法",
  "category": "学习",
  "estimatedPomodoros": 2,
  "durationMinutes": 25,
  "dueDate": "2026-10-04",
  "theme": "sky",
  "kind": "pomodoro",
  "timingMode": "countdown"
}
```

`theme`、`kind`、`timingMode` 可省略，与已有客户端旧数据兼容。

## 快照版本与客户端接入

读取和写入数据的响应均含 `ETag`，例如 `"0"`。保存快照时把最近读取的完整值（包括双引号）放到 `If-Match`。服务端通过行锁和事务检查版本后写入全部数据。缺少版本返回 428；版本已过期返回 409，已有数据保持原样。其他写操作也可携带 `If-Match` 检查版本。

```ts
const base = 'http://localhost:3000/api';
const loaded = await fetch(`${base}/snapshot`);
const snapshot = await loaded.json();
const etag = loaded.headers.get('ETag')!;
// 在 snapshot 上完成当前用户的修改。
const saved = await fetch(`${base}/snapshot`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'If-Match': etag },
  body: JSON.stringify(snapshot),
});
if (saved.status === 409) {
  // 重新读取，合并本地修改，再由用户确认保存；不要直接覆盖服务端。
}
```

提供 `examples/http-todo-repository.ts.template`：复制为客户端 `src/data/httpRepository.ts`，然后在客户端 `src/data/repository.ts` 中导入并替换实例：

```ts
import { HttpTodoRepository } from './httpRepository';
export const repository: TodoRepository = new HttpTodoRepository(
  'http://你的电脑局域网IP:3000/api',
);
```

此示例遵循现有 `TodoRepository.load/save` 接口，不需要更换 UI。模板只提供 HTTP 适配器，客户端代码尚未改动。`TodoProvider` 目前只会提示保存重试；处理 409 时还需要增加重新加载、合并入口，不能仅重试旧快照。网络超时也可能发生于服务器提交之后，需重新读取确认服务器版本。

首次服务器数据为空，不自动插入虚构历史或覆盖客户端现有本地数据。若要迁移已有本地数据，先用 `LocalTodoRepository.load()` 读取旧快照，再通过 HTTP `load()` 获取服务器 ETag；确认服务器内容及待迁移数据后调用 HTTP `save()`。两种存储互相独立。

浏览器用 `http://localhost:3000/api`；Android 模拟器通常用 `http://10.0.2.2:3000/api`；真机用电脑局域网 IPv4，手机与电脑需在同一网络。按需允许 Windows 防火墙的 3000 端口。真机不能使用 localhost 访问电脑。原生 Android 的 HTTP 明文策略需按客户端构建配置处理；正式部署使用 HTTPS。

浏览器来源白名单由 `CORS_ORIGINS` 配置，多个来源以逗号分隔，默认允许 Expo Web 的 localhost/127.0.0.1:8081，并暴露 ETag。

开发环境 `API_KEY` 默认为空。设置后所有业务接口需携带 `X-API-Key`；Swagger 页面可以通过 Authorize 添加它。该共享密钥用于此单用户服务，不等于用户登录；分发到公开客户端的密钥不能作为多用户安全边界。`NODE_ENV=production` 要求至少 32 字符的密钥。

## SQL 与备份

- `sql/001_initial_schema.sql`：可审阅的建表 SQL，包含表、字段、索引、约束及初始状态行。
- `sql/backups/schema-*.sql`：通过本机真实数据库的 `SHOW CREATE TABLE` 导出的结构备份，不含任务内容及密码。
- `schema_migrations` 保存版本和 SHA-256 校验值。重复执行迁移不会清空数据；不要修改已执行迁移，应新增迁移文件并扩展迁移脚本。
- MySQL DDL 会隐式提交，迁移脚本逐条执行可重复的建表语句，全部成功后才登记版本；通过数据库命名锁串行执行。

```powershell
pnpm db:migrate
pnpm db:backup
```

恢复结构备份时，先创建空的 `tomato_todo` 数据库，在该库执行备份 SQL，然后执行 `pnpm db:migrate`。这只是表结构备份，完整用户数据备份可使用 MySQL 自带 `mysqldump`。

## 验证

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
# 本地服务已运行时执行，只读检查，不修改用户数据。
pnpm smoke
```

端到端测试自动创建独立随机 `tomato_test_*` 数据库并在结束后删除，不触碰 `tomato_todo`。本机默认读取受保护的 `admin.cnf`；其他环境使用 `TEST_DB_USER` 与 `TEST_DB_PASSWORD` 指定有权创建测试库的管理员账号。测试覆盖真实 MySQL 的快照往返、并发版本冲突、校验失败不写入、历史去重、任务删除保留记录、API Key 与 API 重启持久化。

项目结构：`src/todo` 为业务接口和校验，`src/database` 为 MySQL 连接池，`src/common` 为版本响应及错误处理，`scripts` 为迁移、备份、安装和只读冒烟工具。

官方参考：[NestJS 文档](https://docs.nestjs.com/first-steps)、[MySQL Windows 服务安装](https://dev.mysql.com/doc/refman/8.4/en/windows-start-service.html)。
