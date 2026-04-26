# 服务端架构与调用链

本文描述 `ST-Delegation-of-authority` 当前的服务端分层、生命周期、端口暴露模型，以及每一层的职责边界。

## 1. 总体结构

当前系统由三层组成：

```text
SillyTavern Frontend Extension
  -> window.STAuthority / AuthoritySDK
  -> /api/plugins/authority/*
  -> Node server-plugin adapter
  -> http://127.0.0.1:<ephemeral-port>/v1/*
  -> Rust authority-core
```

再加上一个控制面 UI：

```text
third-party/st-authority-sdk
  -> Security Center
  -> 会话初始化 / 权限提示 / 审计与告警可视化 / 管理员策略 / 管理员更新
```

## 2. 三层职责边界

## 2.1 SDK extension

SDK 是浏览器侧接入层，主要职责：

- 暴露 `window.STAuthority.AuthoritySDK`
- 负责 `AuthoritySDK.init()`
- 持有 `sessionToken`
- 调用 `/api/plugins/authority/*`
- 在需要时发起权限评估和用户提示
- 提供 Security Center UI

SDK 不应该：

- 直接访问 `authority-core`
- 假设存在固定 core 端口
- 绕过 session 直接调用受保护能力

## 2.2 Node server-plugin adapter

Node 插件是 **真正的公开服务端 API 层**，其职责包括：

- 注册 SillyTavern 插件路由
- 会话创建与校验
- 权限决策组合
- 审计日志写入
- 存储路径解析
- 聚合扩展详情、活动与作业视图
- 将请求转发给 Rust core
- 管理 `authority-core` 进程生命周期
- 首次启动时自动部署 `st-authority-sdk`
- 管理 installable / core 校验 / 管理员更新
- 提供 SSE 桥接

对开发者来说，**稳定接口优先级是 Node adapter 层，而不是 Rust core 直连**。

## 2.3 Rust authority-core

`authority-core` 是权威执行层，负责：

- KV / Blob / SQL / Trivium / 私有文件的底层执行
- 控制面状态持久化
- cursor-paged control audit / jobs / events 读取
- 会话、扩展、grant、policy、audit、jobs、events 的底层读写
- HTTP fetch
- 后台任务注册表执行（`delay`、`sql.backup`、`trivium.flush`、`fs.import-jsonl`）
- 持久化 queue pressure、retry、timeout / failure、slow job 等诊断线索
- 事件轮询源
- `/health` 健康检查

它不是浏览器公开接口，而是被 Node adapter 管理和调用的内部服务。

## 3. 运行时创建顺序

`packages/server-plugin/src/index.ts` 中：

1. `createAuthorityRuntime()` 创建 runtime
2. `registerRoutes(router, runtime)` 注册公开路由
3. `runtime.install.bootstrap()` 进行 SDK 部署与 core 校验
4. `runtime.core.start()` 启动 Rust core

退出时：

1. `runtime.core.stop()`
2. 清空 runtime 引用

## 4. Runtime 服务对象

当前 runtime 由这些服务组成：

- `events`
- `audit`
- `core`
- `extensions`
- `install`
- `policies`
- `permissions`
- `sessions`
- `storage`
- `files`
- `http`
- `jobs`

这意味着：

- **公开 API 在 `routes.ts`**
- **能力封装在 `services/*`**
- **权威执行落在 `CoreService -> authority-core`**

## 5. 请求调用链

典型调用链如下。

## 5.1 SQL 查询

```text
AuthoritySDK.sql.query()
  -> POST /api/plugins/authority/sql/query
  -> SessionService.assertSession()
  -> PermissionService.authorize(sql.private, database)
  -> resolvePrivateSqlDatabasePath(user, extensionId, database)
  -> CoreService.querySql(dbPath, request)
  -> POST /v1/sql/query
  -> authority-core 执行 SQLite 查询
```

## 5.2 Trivium 搜索

```text
AuthoritySDK.trivium.search()
  -> POST /api/plugins/authority/trivium/search
  -> 权限检查 trivium.private + database target
  -> 解析 .tdb 路径
  -> POST /v1/trivium/search
  -> authority-core 调用 TriviumDB
```

## 5.3 SSE 事件流

```text
browser EventSource
  -> GET /api/plugins/authority/events/stream
  -> Session 校验 + events.stream 权限检查
  -> SseBroker.register(...)
  -> 每 500ms 调用 core.pollControlEvents(...)
  -> 将控制面事件写回 SSE
```

注意：

- 当前公开层只提供 **订阅**，没有公开的“任意事件发布”HTTP 路由
- SSE 是基于控制面事件轮询桥接，不是纯内存广播

## 5.4 Security Center 扩展详情

```text
Security Center
  -> GET /api/plugins/authority/extensions/:id
  -> runtime.extensions.getExtension(...)
  -> runtime.audit.getRecentActivityPage(...)
  -> runtime.jobs.listPage(...)
  -> Node adapter 组装 activity + activity.pages + jobs + jobsPage
  -> 返回扩展详情聚合视图
```

这条链路很关键，因为它说明：

- 公开层聚合视图和 core 内部分页合同是两回事
- Security Center 可以看到 `warnings`、`activity.pages` 和 `jobsPage`
- 公开 `GET /jobs` 仍然是扩展工作流接口，而不是控制面详情接口

## 6. 端口与暴露面

这是最容易误解的地方。

## 6.1 对外公开的不是独立 Authority 端口

Authority 公开 API 复用的是 **SillyTavern 自己的 HTTP 服务端口**，路径基座为：

```text
/ api / plugins / authority
```

也就是：

```text
/ api/plugins/authority/*
```

所以对外你看到的是“路径空间”，不是新的公网监听端口。

## 6.2 `authority-core` 使用内部 loopback 端口

Node adapter 启动 core 时会：

- 先申请一个可用随机端口
- 绑定到 `127.0.0.1`
- 通过环境变量传给 core

运行时模型大致是：

```text
127.0.0.1:<ephemeral-port>
```

这意味着：

- 端口 **不是固定值**
- 不应在前端或外部系统里写死
- 正常情况下只允许本机 loopback 访问

## 6.3 standalone core 的默认端口

如果脱离 Node adapter 单独启动 `authority-core`，它的默认值是：

- `AUTHORITY_CORE_HOST=127.0.0.1`
- `AUTHORITY_CORE_PORT=8173`

但在本项目正常集成模式下，这个默认值通常不会被使用，因为 Node adapter 会显式传入动态端口。

## 7. Token 与会话

系统里有两套不同语义的 token：

## 7.1 session token

给前端扩展使用：

- Header：`x-authority-session-token`
- Query：`authoritySessionToken`

用途：

- 识别某个扩展会话
- 将调用绑定到当前 user + extension
- 作为公开 API 的身份凭证

## 7.2 core token

给 Node adapter 调用 Rust core 使用：

- Header：`x-authority-core-token`

用途：

- 保护内部 loopback HTTP API
- 防止无 token 本地请求直接访问内部端点

前端不应该知道或依赖这个 token。

## 8. 权限决策链

当前权限决策顺序是：

```text
admin/global policy
  > persistent grant
  > session grant
  > default policy status
```

默认策略当前全部是：

```text
prompt
```

这意味着如果没有管理员策略、没有持久授权、没有会话授权，公开 API 会把该能力视为“需要提示/未直接放行”。

## 9. 控制面数据与数据面数据

建议把数据分成两类理解：

## 9.1 控制面数据

主要在 `control.sqlite` 内：

- session snapshot
- extension registry
- grants
- policies
- audit logs
- jobs
- events

## 9.2 数据面数据

按能力分别落在不同位置：

- KV：每扩展一个 sqlite 文件
- Blob：blob 根目录 + control metadata
- 私有文件：扩展私有 root dir
- SQL：每扩展/每数据库一个 `.sqlite`
- Trivium：每扩展/每数据库一个 `.tdb`

## 10. 对开发者最重要的架构结论

- **改公开行为，优先看 `routes.ts`**
- **改底层执行，优先看 `core-service.ts` + `authority-core/src/main.rs`**
- **改权限行为，优先看 `permission-service.ts`**
- **改数据隔离，优先看 `authority-paths.ts`**
- **改安装/更新，优先看 `install-service.ts`**
- **改前端接入方式，优先看 `sdk-extension/src/client.ts`**

## 11. 对编程 AI 的建议

如果你是编程 AI，请默认遵守：

- 不要给前端新增直接访问 core 的逻辑
- 不要假设 core 固定端口
- 不要绕过 `session/init`
- 不要绕过 `PermissionService`
- 不要把 installable 产物当成“构建时自动已同步”
- 改动 public route 后，要考虑 SDK client、Security Center、shared types 是否都要更新
