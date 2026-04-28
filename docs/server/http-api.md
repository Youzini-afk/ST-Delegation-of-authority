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
- 当前 transport hints / compatibility limits
- features

 这里的 `policies` 只包含**当前扩展的扩展级管理员覆盖策略**，不包含全局默认策略；管理员如果要读取全局默认策略，应使用 `GET /admin/policies`。

## 2.2 读取当前会话

- `GET /session/current`

要求带 `x-authority-session-token`。

返回结构与 `POST /session/init` 对齐，也包含：

- `grants`
- `policies`
- `limits`
- `features`

 同样地，这里的 `policies` 不是“所有有效默认策略”，而是当前扩展的显式管理员覆盖记录。

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
- `POST /sql/list-schema`
- `POST /sql/stat`
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
- `POST /trivium/search-hybrid-context`
- `POST /trivium/tql`
- `POST /trivium/tql-mut`
- `POST /trivium/create-index`
- `POST /trivium/drop-index`
- `POST /trivium/index-text`
- `POST /trivium/index-keyword`
- `POST /trivium/build-text-index`
- `POST /trivium/flush`
- `POST /trivium/stat`
- `POST /trivium/compact`
- `POST /trivium/check-mappings-integrity`
- `POST /trivium/delete-orphan-mappings`
- `POST /trivium/list-mappings`
- `GET /trivium/databases`

## 3.7 HTTP / Jobs / Events

- `POST /http/fetch`
- `POST /http/fetch-open`
- `POST /jobs/create`
- `GET /jobs`
- `POST /jobs/list`
- `GET /jobs/:id`
- `POST /jobs/:id/cancel`
- `POST /jobs/:id/requeue`
- `GET /events/stream`

## 3.8 管理员接口

- `GET /admin/policies`
- `POST /admin/policies`
- `GET /admin/usage-summary`
- `POST /admin/update`
- `GET /admin/import-export/operations`
- `POST /admin/import-export/export`
- `POST /admin/import-export/import-transfer/init`
- `POST /admin/import-export/import`
- `POST /admin/import-export/operations/:id/resume`
- `POST /admin/import-export/operations/:id/open-download`
- `GET /admin/diagnostic-bundle`
- `POST /admin/diagnostic-bundle/archive`

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
  - 当前运行时来源为 `runtime`

- `effectiveTransferMaxBytes`
  - 是继续保留给旧客户端的 compatibility field
  - 当前运行时会回报 unmanaged 值，表示插件不再主动施加 transfer ceiling

## 4.2 `POST /permissions/evaluate`

输入：`PermissionEvaluateRequest`

作用：

- 只做权限评估
- 不写入 grant
- 常用于前端决定是否直接执行、是否需要弹权限提示，或是否应立即拒绝

返回：`PermissionEvaluateResponse`

关键字段：

- `decision`
- `resource`
- `target`
- `riskLevel`
- `grant`

 其中：

- `decision` 可能来自扩展声明权限 gate、管理员扩展级策略、管理员默认策略、用户 grant，或系统内置默认策略。
- 当前系统内置默认策略全部为 `granted`，所以没有管理员额外收紧时，很多请求会直接返回 `granted`。
- `grant` 既可能是显式保存过的用户 / 管理员 grant，也可能是运行时合成出的 system policy grant（例如系统默认允许时）。

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

 当前语义：

- `allow-once`：写成单次 session grant，消费一次后失效
- `allow-session`：写成当前 session 内有效的 grant
- `allow-always`：写成 persistent grant
- `deny`：写成 persistent grant，状态为 `denied`

 这些用户 grant 只有在没有被更高优先级的管理员策略覆盖时，才会影响后续评估结果。

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

 这里的 `policies` 只包含当前扩展的扩展级管理员覆盖，不包含全局默认策略

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
- `purpose` 主要用于标记当前 transfer 对应的操作语义，例如 `httpFetchRequest` / `httpFetchResponse`
- 当前插件运行时不会再根据 `purpose` 对扩展施加额外的 transfer ceiling

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
- `list-schema`：分页列出当前数据库的 tables / indexes / views 等 schema object
- `stat`：返回当前数据库文件与慢查询摘要
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
- hybrid search with context
- TQL read / page query
- TQL mutation
- property index create / drop
- text / keyword 索引
- flush
- compact
- stat
- **check mappings integrity** (heavy diagnostics/maintenance operation)
- **delete orphan mappings** (heavy diagnostics/maintenance operation)
- list mappings
- list databases

重要边界：

- **Authority 不负责生成 embedding**
- Trivium 接口要求调用方传入 `vector`
- 默认数据库名也是 `default`
- 权限资源是 `trivium.private`
- target 是数据库名
- `resolve-id` / `upsert` / `get` / `search` / `neighbors` 等公开层接口会处理 external ID 映射
- 读路径优先推荐 `POST /trivium/tql`，变更路径优先推荐 `POST /trivium/tql-mut`
- 高频 payload 字段过滤建议配合 `POST /trivium/create-index` / `POST /trivium/drop-index`
- `POST /trivium/search-hybrid-context` 会返回 `hits` 和 `context.stageTimings`，适合调试或观测检索链路
- `stat` 返回 richer runtime metadata，例如 `edgeCount`、`vectorDim`、`databaseSize`、`walSize`、`vecSize`
- `check-mappings-integrity`、`delete-orphan-mappings` 和 `stat(includeMappingIntegrity)` 都会触发 mapping / node 集分析，应视为 diagnostics / maintenance 路径，而不是高频业务热路径

分页补充：

- `POST /trivium/tql` 可接受可选 `page`
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
- `POST /jobs/list`
- `GET /jobs/:id`
- `POST /jobs/:id/cancel`
- `POST /jobs/:id/requeue`

当前内置 job type 包括：

- `delay`
- `sql.backup`
- `trivium.flush`
- `fs.import-jsonl`

也就是说，当前公开后台任务能力并不是“任意代码执行框架”，而是受限的 job 类型执行。

额外边界：

- `GET /jobs` 仍然返回当前扩展的 job 数组，不单独暴露 page envelope
- `POST /jobs/list` 返回 page-aware jobs envelope，适合控制面和大列表场景
- `POST /jobs/:id/requeue` 会基于原 job type 再做一次 `jobs.background` 权限校验
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

- 全局默认策略（已把系统内置默认值与显式管理员默认值合并，便于 UI 直接展示）
- 扩展级覆盖策略
- legacy `limits` 文档（用于兼容 / import-export round-trip）
- `updatedAt`

## 13.2 `POST /admin/policies`

作用：

- 保存全局管理员策略

当前 `partial` 可包含：

- `defaults`
- `extensions`
- `limits`

其中：

- `defaults` / `extensions`
  - 是当前仍会被 Node 插件运行时真正应用的管理员策略
  - `extensions` 是按扩展、按 target 的最高优先级覆盖
  - `defaults` 是按资源生效的全局管理员默认策略
  - `defaults = prompt` 的语义是“没有用户 grant 时需要提示”
  - `defaults = granted / denied / blocked` 会先于用户 grant 生效
- `limits`
  - 当前仍允许保存并返回，用于兼容旧合同与 import/export round-trip
  - 但当前运行时不会把它作为插件层扩展 I/O 限制来执行

当前 Security Center 保存管理员策略时，会提交完整的 `defaults` map，而不仅是单个资源的局部 patch。

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

## 13.4 `GET /admin/usage-summary`

要求当前 ST 用户是 admin。

返回：`AuthorityUsageSummaryResponse`

主要用于 Security Center 的管理员运维面板，帮助管理员快速判断：

- 哪些扩展占用了最多 KV / Blob / SQL / Trivium / 私有文件
- 当前 grants 数量和拒绝情况
- 是否适合执行导出、清理或迁移

返回里包含：

- `generatedAt`
- `totals`
- `extensions`

## 13.5 `GET /admin/import-export/operations`

要求当前 ST 用户是 admin。

返回：`AuthorityPackageOperationListResponse`

会列出当前用户下持久化保存的 import/export operation，包括：

- `status`
- `progress`
- `summary`
- `error`
- `artifact`
- `importSummary`
- `warnings`

这组 operation 是 Security Center 运维面板的后端状态来源。

## 13.6 `POST /admin/import-export/export`

要求当前 ST 用户是 admin。

输入：`AuthorityExportPackageRequest`

当前支持：

- `extensionIds?`
- `includePolicies?`
- `includeUsageSummary?`

行为：

- 启动一个异步 export operation
- 后台构建逻辑层 `AuthorityPortablePackage`
- 再写成 `.authoritypkg.zip` 多文件归档

返回值是 operation 本身，而不是直接返回 zip 文件 body。

## 13.7 `POST /admin/import-export/import-transfer/init`

要求当前 ST 用户是 admin。

输入：

- `sizeBytes`

行为：

- 创建一个 `fs.private` 类型的 transfer staging
- `purpose` 为 `privateFileWrite`
- 校验上传大小必须大于 0
- 校验上传大小不能超过 `256 MiB`

浏览器随后应通过标准 transfer append 路由把包文件上传完，再调用真正的 import route。

## 13.8 `POST /admin/import-export/import`

要求当前 ST 用户是 admin。

输入：`AuthorityPackageImportRequest`

当前字段包括：

- `transferId`
- `mode?`
- `fileName?`

当前 `mode` 支持：

- `replace`
- `merge`

语义：

- 读取 transfer staging 文件
- 启动一个异步 import operation
- 支持导入新的 `.authoritypkg.zip` 多文件归档
- 继续兼容旧的单文件 `.json.gz` 逻辑包

如果导入的是 legacy `.json.gz`，operation `warnings` 会提示管理员重新导出为新的 zip 形态。

## 13.9 `POST /admin/import-export/operations/:id/resume`

要求当前 ST 用户是 admin。

只允许恢复 `failed` 状态的 operation。

当前主要用于两类场景：

- 导入 / 导出运行中失败
- 服务重启后原本的 `queued` / `running` operation 被标记成 `operation_recovery_required`

恢复时会把 operation 重置回：

- `status = queued`
- `progress = 0`
- 清空上一轮的 `summary` / `error` / `startedAt` / `finishedAt`

然后重新进入后台执行。

## 13.10 `POST /admin/import-export/operations/:id/open-download`

要求当前 ST 用户是 admin。

不会直接把 artifact 文件一次性写进 HTTP 响应体。

返回：`AuthorityArtifactDownloadResponse`

其中包括：

- `artifact`
- `transfer`

也就是说，这个路由的语义是“打开一个 artifact 下载会话”，随后浏览器仍需通过 transfer read 接口分块读取。

## 13.11 `GET /admin/diagnostic-bundle`

要求当前 ST 用户是 admin。

返回脱敏 JSON 诊断快照，当前至少包含：

- `probe`
- `policies`
- `usageSummary`
- `jobs`
- `extensions`
- `releaseMetadata`

这个接口适合：

- 直接查看控制面状态
- 本地快速复制一份 JSON 用于排障

## 13.12 `POST /admin/diagnostic-bundle/archive`

要求当前 ST 用户是 admin。

行为：

- 基于 `GET /admin/diagnostic-bundle` 的内容生成一个 `.json.gz` 归档 artifact
- 当前 archive 格式为 `authority-diagnostic-bundle-archive-v1`
- 内部文件包括 `bundle.json`、`probe.json`、`policies.json`、`usage-summary.json`、`jobs.json`、`extensions/index.json`、逐扩展 snapshot，以及存在时的 `release-metadata.json`

返回值同样是 `AuthorityArtifactDownloadResponse`，需要浏览器继续走 transfer read 下载。

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
