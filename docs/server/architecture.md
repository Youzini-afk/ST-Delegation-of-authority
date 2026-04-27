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
  -> 会话初始化 / 权限提示 / 审计与告警可视化 / 管理员策略 / 管理员运维面板
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
- limits 决策组合（effective inline thresholds / transfer ceilings）
- 审计日志写入
- 存储路径解析
- 聚合扩展详情、活动与作业视图
- 聚合管理员 usage summary、portable package 与 diagnostic archive 视图
- 将请求转发给 Rust core
- 管理 `authority-core` 进程生命周期
- 首次启动时自动部署 `st-authority-sdk`
- 管理 installable / core 校验 / 管理员更新
- 管理 portable package operation、artifact 与 diagnostic archive
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

- `adminPackages`
- `events`
- `audit`
- `core`
- `transfers`
- `extensions`
- `install`
- `policies`
- `permissions`
- `sessions`
- `storage`
- `files`
- `http`
- `jobs`
- `trivium`

这意味着：

- **公开 API 在 `routes.ts`**
- **能力封装在 `services/*`**
- **管理员高层导入导出封装在 `AdminPackageService`**
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

## 5.4 大对象读写与动态 inline / transfer 分流

```text
AuthoritySDK.storage.blob.get() / fs.readFile() / http.fetch()
  -> Node adapter 先做 session + permission
  -> PermissionService 返回 session-scoped effective limits
  -> 若 payload / response 小于 effective inline threshold
       -> 直接走 inline 响应
  -> 否则
       -> 走 DataTransferService staging + read/discard
```

这里要区分三件事：

- `effectiveInlineThresholdBytes`
  - 决定某个操作应返回 inline 还是 transfer
  - 当前可能来自 `runtime` 或 extension-scoped `policy`

- `effectiveTransferMaxBytes`
  - 决定某个操作允许使用多大的 transfer payload
  - 当前来源为 `runtime`

- `core.health.limits`
  - 是内部执行层的 hard ceiling 诊断，不等于公开 adapter 一定完全暴露这些上限

## 5.5 Security Center 扩展详情

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

## 5.6 Security Center 管理员运维面板

```text
Security Center -> Updates
  -> GET /api/plugins/authority/admin/usage-summary
  -> GET /api/plugins/authority/admin/import-export/operations
  -> POST /api/plugins/authority/admin/import-export/export
  -> POST /api/plugins/authority/admin/import-export/import-transfer/init
  -> POST /api/plugins/authority/admin/import-export/import
  -> POST /api/plugins/authority/admin/import-export/operations/:id/resume
  -> POST /api/plugins/authority/admin/import-export/operations/:id/open-download
  -> GET /api/plugins/authority/admin/diagnostic-bundle
  -> POST /api/plugins/authority/admin/diagnostic-bundle/archive
  -> runtime.adminPackages
  -> DataTransferService / PolicyService / StorageService / PrivateFsService / TriviumService
```

这条链路说明：

- 管理员运维面板不是单一接口，而是一组聚合 route + 持久 operation 模型
- portable package 与 diagnostic archive 属于 Node adapter 运行时生成的管理员 artifact，不是 installable 发布产物
- 下载 artifact 时仍复用 DataTransferService，而不是额外发明一套下载协议

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

同一条请求还有一条独立但相关的 limits 决策链：

- **access policy / grant**
  - 决定这条请求是否允许执行

- **effective inline thresholds**
  - 决定执行后是否走 inline vs transfer

- **effective transfer ceilings**
  - 决定 transfer 路径本身的最大 payload

当前实现中：

- inline threshold 可以被 extension-scoped limits policy 下压
- transfer ceiling 仍然是 runtime-only
- 这两类 effective limits 会通过 `/probe` 与 session 返回对外暴露

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
