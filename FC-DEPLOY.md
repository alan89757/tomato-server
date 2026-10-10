# FC Web 函数部署（杭州 tomato）

适配控制台：自定义运行时 / Node.js 22 / Debian 12，ZIP 上传。保留一期所有客户端共享待办的模型。

## 打包

Windows PowerShell 在项目根目录运行：

```powershell
.\scripts\package-fc.ps1
```

脚本编译项目，将锁定版本的生产依赖安装到独立目录，生成 artifacts/fc-时间戳.zip。使用扁平 node_modules，检查不存在符号链接或 .node 原生二进制后打包。包根目录直接包含 dist、node_modules、package.json、scripts、sql，不包含本机 .env、源码和数据库备份。未来添加原生依赖时，必须改用 Linux 构建。

## 创建函数

- 地域：华东1（杭州）cn-hangzhou；函数名称：tomato。
- 运行环境：自定义运行时 / Node.js 22 / Debian 12。
- 上传生成的 ZIP；启动命令：node dist/main.js；监听端口：3000。
- 首次排障建议 0.5 vCPU、512 MB，之后按监控调整；这是起始配置而非容量保证。
- 超时：60 秒；单实例并发：20 可作为起点。实例连接池上限为 10，扩容时需结合数据库最大连接数限制最大实例数。
- 最小实例数：1 可减少冷启动；接受冷启动时可选 0。两者费用不同，按控制台实际报价确认。

## 数据库和环境变量

先准备杭州的云端 MySQL，并创建 tomato_todo 数据库与专用账号。使用 RDS 时，配置同地域 VPC 访问、交换机和安全组，将 FC 交换机网段加入 RDS IP 白名单。DB_HOST 填云数据库内网地址，不是 127.0.0.1。

在 FC 环境变量中配置以下值（不要上传本机 .env）：

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DB_HOST=云数据库内网地址
DB_PORT=3306
DB_USER=专用数据库账号
DB_PASSWORD=云数据库密码
DB_NAME=tomato_todo
API_KEY=至少32字符的随机密钥
CORS_ORIGINS=https://实际Web客户端域名
```

原生 APP 不依赖浏览器 CORS；如果同时使用 Web 客户端，需要填写实际来源。

在能访问云数据库的环境中配置 DB_*，运行 node scripts/migrate.mjs。也可在源码目录运行 pnpm db:migrate。该操作先于正式服务启动执行，重复运行会跳过已应用迁移。不要把迁移放入函数每次冷启动命令。

服务启动阶段即连接数据库并检查 app_state 表；数据库网络或迁移缺失会导致函数启动失败。

## HTTP 访问与验收

创建 HTTP 触发器，允许 GET、POST、PUT、PATCH、DELETE、OPTIONS。客户端当前使用 X-API-Key，不具备阿里云 IAM 签名能力；若选择无需 FC 签名认证，业务接口仍由应用 API_KEY 校验。

部署后从独立环境用只读冒烟脚本验证（API_URL 不带末尾斜杠）：

```powershell
$env:API_URL = 'https://函数访问域名/api'
$env:API_KEY = '在FC配置的密钥'
node scripts/smoke-local.mjs
```

检查 health.database=up、snapshot 及 ETag、待办、历史、计时器、统计、文档。正式客户端使用 HTTPS 域名，配置 EXPO_PUBLIC_API_URL=https://域名/api 与 EXPO_PUBLIC_API_KEY 后重新构建/更新应用。密钥会进入 APP 包，适用于当前共享数据设计。

官方文档：
- https://help.aliyun.com/zh/functioncompute/creating-a-web-function
- https://help.aliyun.com/zh/functioncompute/access-the-rds-mysql-example
