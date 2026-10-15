# 待办集同步升级

客户端新增了 `Snapshot.collections` 和 `Task.collectionId`。旧服务端的严格校验会以 HTTP 400 拒绝它们。本次升级同时增加接口校验和数据库读写支持。

在 tomato-server 目录执行：

```powershell
pnpm db:migrate
pnpm build
```

随后重启服务。生产环境需将新版服务端与 `sql/005_goal_collections.sql` 一起部署，在服务接流量前对目标数据库执行迁移。迁移只新增可空列，不修改既有数据。不要修改已执行的 001–004 迁移文件。

重启后，在 APP 点击“重新同步”，即可上传已保留的本机草稿，无需清缓存或重新创建待办集。

待办集按账号保存在 `user_app_state.collections`，事项归属保存在 `user_tasks.collection_id`；两者随快照在同一事务中保存，沿用账号隔离与 ETag 冲突保护。旧快照仍可读取和保存，未传 `collections` 时保留服务端已有待办集，显式传 `[]` 才清空它们。移出待办集可将事项的 `collectionId` 设为 `null`。
