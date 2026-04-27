# 公开 HTTP / SSE API

本文只描述 **Node server-plugin 对外公开** 的接口，也就是复用 SillyTavern 路由空间的这层：

```text
/ api/plugins/authority/*
```

不要把本文和 `authority-core` 的内部 `/v1/*` 端点混淆。内部端点请看 `core-runtime.md`。

## 1. 基础信息

- **公开 API Base**：`/api/plugins/authority`
- **默认内容类型**：JSON
- **会话 Header**：`x-authority-session-token`
- **会话 Query**：`authoritySessionToken`
- **错误格式**：结构化 `AuthorityErrorPayload`，基础形态为 `{ "error": "...", "code": "...", "category": "...", "details": ... }`

## 2. 认证与会话

## 2.1 会话初始化

扩展通常先调用：

- `POST /session/init`

提交 `AuthorityInitConfig`，返回：

- `sessionToken`
- `user`
- `extension`
- 当前 grants
- 当前 policies
- 当前 limits
- features

## 2.2 读取当前会话

- `GET /session/current`

要求带 `x-authority-session-token`。

返回结构与 `POST /session/init` 对齐，也包含：

- `grants`
- `policies`
- `limits`
- `features`

## 2.3 谁需要 session

除了：

- `/probe`
- 管理员接口（依赖当前 ST 用户 admin 身份）

之外，绝大多数能力接口都需要有效 session。

## 3. 路由分组总览

当前公开路由如下。

## 3.1 诊断与会话

- `POST /probe`
- `POST /session/init`
- `GET /session/current`
- `POST /permissions/evaluate`
- `POST /permissions/evaluate-batch`
- `POST /permissions/resolve`

## 3.2 扩展与控制面视图

- `GET /extensions`
- `GET /extensions/:id`
- `POST /extensions/:id/grants/reset`

## 3.3 KV / Blob

- `POST /storage/kv/get`
- `POST /storage/kv/set`
- `POST /storage/kv/delete`
- `POST /storage/kv/list`
- `POST /transfers/init`
- `POST /transfers/:id/append`
- `POST /transfers/:id/read`
- `POST /transfers/:id/discard`
- `POST /storage/blob/put`
- `POST /storage/blob/commit-transfer`
- `POST /storage/blob/get`
- `POST /storage/blob/open-read`
- `POST /storage/blob/delete`
- `POST /storage/blob/list`

## 3.4 私有文件

- `POST /fs/private/mkdir`
- `POST /fs/private/read-dir`
- `POST /fs/private/write-file`
- `POST /fs/private/write-file-transfer`
- `POST /fs/private/read-file`
- `POST /fs/private/open-read`
- `POST /fs/private/delete`
- `POST /fs/private/stat`

## 3.5 SQL

- `POST /sql/query`
- `POST /sql/exec`
- `POST /sql/batch`
- `POST /sql/transaction`
- `POST /sql/migrate`
- `POST /sql/list-migrations`
- `GET /sql/databases`

## 3.6 Trivium

- `POST /trivium/resolve-id`
- `POST /trivium/resolve-many`
- `POST /trivium/insert`
- `POST /trivium/insert-with-id`
- `POST /trivium/upsert`
- `POST /trivium/bulk-upsert`
- `POST /trivium/get`
- `POST /trivium/update-payload`
- `POST /trivium/update-vector`
- `POST /trivium/delete`
- `POST /trivium/bulk-delete`
- `POST /trivium/link`
- `POST /trivium/bulk-link`
- `POST /trivium/unlink`
- `POST /trivium/bulk-unlink`
- `POST /trivium/neighbors`
- `POST /trivium/search`
- `POST /trivium/search-advanced`
- `POST /trivium/search-hybrid`
- `POST /trivium/filter-where`
- `POST /trivium/query`
- `POST /trivium/index-text`
- `POST /trivium/index-keyword`
- `POST /trivium/build-text-index`
- `POST /trivium/flush`
- `POST /trivium/stat`
- `POST /trivium/compact`
- `POST /trivium/delete-orphan-mappings`
- `POST /trivium/list-mappings`
- `GET /trivium/databases`

## 3.7 HTTP / Jobs / Events

- `POST /http/fetch`
- `POST /http/fetch-open`
- `POST /jobs/create`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/cancel`
- `GET /events/stream`

## 3.8 管理员接口

- `GET /admin/policies`
- `POST /admin/policies`
- `POST /admin/update`

## 4. 接口语义详解

## 4.1 `POST /probe`

用途：

- 查询插件安装状态
- 查询 SDK / core 版本
- 查询 core 健康信息

不要求 session。

关键返回字段：

- `pluginVersion`
- `sdkBundledVersion`
- `sdkDeployedVersion`
- `coreBundledVersion`
- `coreArtifactPlatform`
- `coreArtifactPlatforms`
- `coreVerified`
- `coreMessage`
- `installStatus`
- `installMessage`
- `limits`
- `core`

`core` 内又包含：

- `state`
- `port`
- `pid`
- `version`
- `startedAt`
- `health`

`limits` 内除了公开 compatibility fields，还包括：

- `effectiveInlineThresholdBytes`
- `effectiveTransferMaxBytes`

它们都是按操作暴露的 map，当前 key 包括：

- `storageBlobWrite`
- `storageBlobRead`
- `privateFileWrite`
- `privateFileRead`
- `httpFetchRequest`
- `httpFetchResponse`

其中：

- `effectiveInlineThresholdBytes`
  - 用于决定 inline vs transfer routing
  - 当前 source 可能为 `runtime` 或 `policy`

- `effectiveTransferMaxBytes`
  - 用于决定 transfer staging 的最大 payload
  - 当前 source 为 `runtime`

## 4.2 `POST /permissions/evaluate`

输入：`PermissionEvaluateRequest`

作用：

- 只做权限评估
- 不写入 grant
- 常用于前端决定是否弹权限提示

返回：`PermissionEvaluateResponse`

关键字段：

- `decision`
- `resource`
- `target`
- `riskLevel`
- `grant`

## 4.3 `POST /permissions/evaluate-batch`

输入：`PermissionEvaluateBatchRequest`

作用：

- 一次请求评估多条权限描述符
- 不写入 grant
- 适合 SDK 或 UI 在一次交互前预判一批能力

返回：`PermissionEvaluateBatchResponse`

- `results: PermissionEvaluateResponse[]`

## 4.4 `POST /permissions/resolve`

输入：`PermissionResolveRequest`

额外包含：

- `choice`
  - `allow-once`
  - `allow-session`
  - `allow-always`
  - `deny`

作用：

- 把用户选择落成 session grant 或 persistent grant
- 写审计日志

## 4.5 `GET /extensions`

返回的是 **控制面聚合视图**，不是简单扩展列表。

每项大致包含：

- extension 基本信息
- `grantedCount`
- `deniedCount`
- `storage`
  - KV 数量
  - Blob 数量/字节
  - SQL 数量/字节
  - Trivium 数量/字节
  - 私有文件使用量

这个接口主要给 Security Center 用。

## 4.6 `GET /extensions/:id`

返回某扩展的聚合详情：

- `extension`
- `grants`
- `policies`
- `activity`
- `jobs`
- `jobsPage`
- `databases`
- `triviumDatabases`
- `storage`

其中：

- `activity.permissions` / `activity.usage` / `activity.errors` / `activity.warnings`
- `activity.pages.{permissions,usage,errors,warnings}`
- `jobs` 是当前页的 job 列表
- `jobsPage` 是对应的 `CursorPageInfo`

这个接口主要给 Security Center 用，所以它会比普通扩展工作流接口多一层聚合和分页元数据。

## 4.7 `POST /extensions/:id/grants/reset`

作用：

- 重置指定扩展的持久化授权
- 可按 `keys` 部分重置
- 也可整扩展重置

成功返回 `204`。

## 5. 能力接口矩阵

下表描述每类公开能力对应的权限资源和 target 语义。

| 能力 | 路由前缀 | 权限资源 | target 语义 |
| --- | --- | --- | --- |
| KV | `/storage/kv/*` | `storage.kv` | 无 target |
| Blob | `/storage/blob/*` | `storage.blob` | 无 target |
| 私有文件 | `/fs/private/*` | `fs.private` | 无 target |
| SQL | `/sql/*` | `sql.private` | 数据库名 |
| Trivium | `/trivium/*` | `trivium.private` | 数据库名 |
| HTTP fetch | `/http/fetch` | `http.fetch` | URL hostname |
| Jobs | `/jobs/*` | `jobs.background` | `job.type` |
| SSE 订阅 | `/events/stream` | `events.stream` | channel |

## 6. KV / Blob API

## 6.1 KV

- `POST /storage/kv/get`
- `POST /storage/kv/set`
- `POST /storage/kv/delete`
- `POST /storage/kv/list`

语义：

- 按扩展隔离
- 当前实现没有 target 维度
- 权限资源固定为 `storage.kv`

## 6.2 Transfer transport API

- `POST /transfers/init`
- `POST /transfers/:id/append`
- `POST /transfers/:id/read`
- `POST /transfers/:id/discard`

说明：

- 这是大对象 transport layer，不是新的权限资源
- 当前支持的 `resource` 为：`storage.blob`、`fs.private`、`http.fetch`
- `init` / `open-read` 路径内部会记录可选 `purpose`
- `purpose` 用于匹配按操作拆分的 transfer ceiling，例如 `httpFetchRequest` / `httpFetchResponse`

## 6.3 Blob

- `POST /storage/blob/put`
- `POST /storage/blob/commit-transfer`
- `POST /storage/blob/get`
- `POST /storage/blob/open-read`
- `POST /storage/blob/delete`
- `POST /storage/blob/list`

`put` 使用：

- `name`
- `content`
- `encoding`
- `contentType`

补充：

- `put`
  - 常规 inline 写入

- `commit-transfer`
  - 将已 staged 的 `storage.blob` transfer 提交为 blob

- `open-read`
  - 会根据 `session.limits.effectiveInlineThresholdBytes.storageBlobRead` 决定返回
  - `mode: inline` 时直接带内容
  - `mode: transfer` 时返回 `transfer`

## 7. 私有文件 API

- `POST /fs/private/mkdir`
- `POST /fs/private/read-dir`
- `POST /fs/private/write-file`
- `POST /fs/private/write-file-transfer`
- `POST /fs/private/read-file`
- `POST /fs/private/open-read`
- `POST /fs/private/delete`
- `POST /fs/private/stat`

这些接口都由 `fs.private` 统一控制。

注意：

- 路径是虚拟相对路径，不是任意宿主机绝对路径
- 路径会被限制在扩展私有 root 内
- symlink 会被拒绝
- 路径穿越会被拒绝
- `write-file-transfer` 用于把 staged transfer 提交成私有文件
- `open-read` 会根据 `session.limits.effectiveInlineThresholdBytes.privateFileRead` 决定 `inline` 或 `transfer`

## 8. SQL API

- `POST /sql/query`
- `POST /sql/exec`
- `POST /sql/batch`
- `POST /sql/transaction`
- `POST /sql/migrate`
- `GET /sql/databases`

数据库名规则：

- 若未提供 `database`，默认是 `default`
- 权限 target 也是这个数据库名

语义：

- `query`：查询
- `exec`：执行单条语句
- `batch`：多语句按顺序执行
- `transaction`：事务执行，多语句失败则回滚
- `migrate`：幂等迁移，默认 migration table 为 `_authority_migrations`
- `list-migrations`：按 migration table 顺序读取当前数据库的已应用迁移记录
- `databases`：列出当前扩展的私有 SQL 文件

分页补充：

- `POST /sql/query` 现在可接受可选 `page`
- 当提供 `page` 时，响应会带 `page: CursorPageInfo`
- 默认 limit 为 100，最大 limit 为 1000

## 9. Trivium API

Trivium 公开 API 相对完整，支持：

- external string id 解析 / 稳定化
- 点写入
- upsert / bulk upsert
- 点读取
- payload/vector 更新
- 删除
- bulk delete
- 图边 link/unlink
- bulk link/unlink
- neighbors
- vector search
- advanced search
- hybrid search
- 条件过滤
- query
- text / keyword 索引
- flush
- compact
- stat
- delete orphan mappings
- list mappings
- list databases

重要边界：

- **Authority 不负责生成 embedding**
- Trivium 接口要求调用方传入 `vector`
- 默认数据库名也是 `default`
- 权限资源是 `trivium.private`
- target 是数据库名
- `resolve-id` / `upsert` / `get` / `search` / `neighbors` 等公开层接口会处理 external ID 映射
- `stat` 返回 richer runtime metadata，例如 `edgeCount`、`vectorDim`、`databaseSize`、`walSize`、`vecSize`

分页补充：

- `POST /trivium/filter-where` 与 `POST /trivium/query` 现在可接受可选 `page`
- 当提供 `page` 时，响应会带 `page: CursorPageInfo`
- 默认 limit 为 100，最大 limit 为 1000

## 10. `POST /http/fetch` / `POST /http/fetch-open`

输入：

- `url`
- `method?`
- `headers?`
- `body?`

`fetch-open` 还支持：

- `bodyTransferId?`

并返回：

- `mode: inline | transfer`
- 当 `mode = transfer` 时返回 `transfer`

权限 target：

- URL 的 `hostname`

即：

```text
http.fetch + hostname
```

例如：

```text
https://api.openai.com/v1/...
=> target = api.openai.com
```

补充：

- `POST /http/fetch`
  - 适合直接 inline body / inline response 的普通路径

- `POST /http/fetch-open`
  - 会根据 request / response effective limits 决定是否经过 transfer staging
  - request body 可以来自 `bodyTransferId`
  - response 可能直接 inline，也可能返回可读 transfer

## 11. Jobs API

- `POST /jobs/create`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/cancel`

当前内置 job type 包括：

- `delay`
- `sql.backup`
- `trivium.flush`
- `fs.import-jsonl`

也就是说，当前公开后台任务能力并不是“任意代码执行框架”，而是受限的 job 类型执行。

额外边界：

- `GET /jobs` 仍然返回当前扩展的 job 数组，不单独暴露 page envelope
- 如果你需要 `jobsPage` 这类分页元数据，应看 `GET /extensions/:id` 的控制面聚合响应

## 12. SSE 事件流

- `GET /events/stream`

特点：

- 使用 SSE
- 需要 session
- 默认 channel：`extension:<extensionId>`
- 也可通过 query 传入 `channel`
- Query 中可带 `authoritySessionToken`

服务端行为：

- 建立连接后先发一个 `authority.connected`
- 然后通过控制面事件轮询不断推送事件
- 底层使用带 cursor/page 元数据的 control events poll，但这些元数据不会直接暴露给浏览器 SSE 消费者

## 13. 管理员接口

## 13.1 `GET /admin/policies`

要求当前 ST 用户是 admin。

返回：

- 全局默认策略
- 扩展级覆盖策略
- extension-scoped limits policy
- `updatedAt`

## 13.2 `POST /admin/policies`

作用：

- 保存全局管理员策略

当前 `partial` 可包含：

- `defaults`
- `extensions`
- `limits`

## 13.3 `POST /admin/update`

当前支持两种 action：

- `git-pull`
- `redeploy-sdk`

返回结构包含：

- `before`
- `after`
- `git`
- `core`
- `coreRestarted`
- `requiresRestart`
- `message`

语义：

- `git-pull`
  - 在插件根目录执行 `git pull --ff-only`
  - 刷新 release metadata
  - 重新部署 bundled SDK
  - 尝试重启 `authority-core`
  - 如果 Node 服务端代码已变化，通常仍需要重启 SillyTavern 才能让新的 Node 代码生效

- `redeploy-sdk`
  - 只重新部署前端 SDK
  - 不从远端拉代码

## 14. 返回码与错误处理

常见情况：

- `200`
  - JSON 成功响应
- `204`
  - 如 grant reset
- `400`
  - 参数错误 / 权限未放行 / 资源不存在 / core 执行报错
- `401`
  - 内部 core token 未通过（主要是 core 内部层）

当前公开 Node adapter 的错误大多会被包装为：

```json
{
  "error": "...",
  "code": "validation_error",
  "category": "validation",
  "details": {}
}
```

当前常见 `category` 包括：

- `permission`
- `auth`
- `session`
- `validation`
- `limit`
- `timeout`
- `core`

当前常见 `code` 包括：

- `unauthorized`
- `invalid_session`
- `session_user_mismatch`
- `validation_error`
- `limit_exceeded`
- `timeout`
- `core_unavailable`
- `core_request_failed`

## 15. 给开发者和 AI 的建议

- **前端扩展优先使用 `AuthoritySDK` / `AuthorityClient`，而不是手写 fetch**
- **新增能力时，要同步更新**
  - `shared-types`
  - `server-plugin/routes.ts`
  - `server-plugin/services/*`
  - `sdk-extension/src/client.ts`
  - Security Center（如果需要展示）
- **新增 public route 时，要想清楚 target 语义**
  - 这个能力是否应该绑定 hostname / database / channel / job type
- **不要把 `/admin/update` 当成热更新 Node 代码的完整替代**
  - 插件代码变更后，通常仍要重启 SillyTavern
