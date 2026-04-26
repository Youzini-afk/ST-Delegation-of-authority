# `authority-core` 运行时与内部 API

本文描述 Rust `authority-core` 的角色、内部 HTTP 端点、环境变量、健康检查、限制和运行边界。

## 1. 它是什么

`authority-core` 是当前系统的数据面和控制面执行层。

它不是给浏览器直接使用的公开 API 服务，而是由 Node server-plugin 管理的 **内部 loopback HTTP 服务**。

## 2. 监听地址与端口

## 2.1 在正常插件模式下

Node adapter 会在启动 core 前设置这些环境变量：

- `AUTHORITY_CORE_HOST=127.0.0.1`
- `AUTHORITY_CORE_PORT=<动态可用端口>`
- `AUTHORITY_CORE_TOKEN=<随机 token>`
- `AUTHORITY_CORE_VERSION=<managed core version>`
- `AUTHORITY_CORE_API_VERSION=authority-core/v1`

所以在正常集成模式下：

- host 固定是 `127.0.0.1`
- port 是 **运行时临时端口**
- 浏览器和外部系统都不应假设它有固定端口

## 2.2 在 standalone 模式下

如果你单独运行 `authority-core`，它的默认环境变量解析是：

- `AUTHORITY_CORE_HOST` 默认 `127.0.0.1`
- `AUTHORITY_CORE_PORT` 默认 `8173`
- `AUTHORITY_CORE_TOKEN` 默认空字符串
- `AUTHORITY_CORE_VERSION` 默认 `0.0.0-dev`
- `AUTHORITY_CORE_API_VERSION` 默认 `authority-core/v1`

这只是独立调试模式的默认值，不是插件集成模式的稳定合同。

## 3. 认证方式

`authority-core` 会校验：

- Header：`x-authority-core-token`

规则：

- 若 token 为空，则任何请求都通过
- 若 token 非空，则必须带正确 header

在正常插件模式下，Node adapter 总是带 token 调用它。

## 4. 健康检查端点

- `GET /health`

返回字段包括：

- `name`
- `apiVersion`
- `buildHash`
- `version`
- `platform`
- `pid`
- `startedAt`
- `uptimeMs`
- `requestCount`
- `errorCount`
- `activeJobCount`
- `queuedJobCount`
- `queuedRequestCount`
- `runtimeMode`
- `maxConcurrency`
- `currentConcurrency`
- `workerCount`
- `lastError`
- `jobRegistrySummary`
- `jobWorkerConcurrency`
- `maxJobQueueSize`
- `timeoutMs`
- `limits`

当前 `limits` 内含：

- `maxRequestBytes`
- `maxKvValueBytes`
- `maxBlobBytes`
- `maxHttpBodyBytes`
- `maxHttpResponseBytes`
- `maxEventPollLimit`

Node adapter 启动 core 后，会轮询 `/health` 直到 ready。

## 5. 当前内部端点清单

当前 `authority-core` 对 Node adapter 暴露的内部端点如下。

## 5.1 存储层

- `POST /v1/storage/kv/get`
- `POST /v1/storage/kv/set`
- `POST /v1/storage/kv/delete`
- `POST /v1/storage/kv/list`
- `POST /v1/storage/blob/put`
- `POST /v1/storage/blob/open-read`
- `POST /v1/storage/blob/get`
- `POST /v1/storage/blob/delete`
- `POST /v1/storage/blob/list`

## 5.2 私有文件

- `POST /v1/fs/private/mkdir`
- `POST /v1/fs/private/read-dir`
- `POST /v1/fs/private/write-file`
- `POST /v1/fs/private/open-read`
- `POST /v1/fs/private/read-file`
- `POST /v1/fs/private/delete`
- `POST /v1/fs/private/stat`

## 5.3 HTTP

- `POST /v1/http/fetch`
- `POST /v1/http/fetch-open`

## 5.4 SQL

- `POST /v1/sql/query`
- `POST /v1/sql/exec`
- `POST /v1/sql/batch`
- `POST /v1/sql/transaction`
- `POST /v1/sql/migrate`

## 5.5 Trivium

- `POST /v1/trivium/insert`
- `POST /v1/trivium/insert-with-id`
- `POST /v1/trivium/bulk-upsert`
- `POST /v1/trivium/get`
- `POST /v1/trivium/update-payload`
- `POST /v1/trivium/update-vector`
- `POST /v1/trivium/delete`
- `POST /v1/trivium/bulk-delete`
- `POST /v1/trivium/link`
- `POST /v1/trivium/bulk-link`
- `POST /v1/trivium/unlink`
- `POST /v1/trivium/bulk-unlink`
- `POST /v1/trivium/neighbors`
- `POST /v1/trivium/search`
- `POST /v1/trivium/search-advanced`
- `POST /v1/trivium/search-hybrid`
- `POST /v1/trivium/filter-where`
- `POST /v1/trivium/query`
- `POST /v1/trivium/index-text`
- `POST /v1/trivium/index-keyword`
- `POST /v1/trivium/build-text-index`

## 5.6 控制面

- `POST /v1/control/session/init`
- `POST /v1/control/session/get`
- `POST /v1/control/extensions/list`
- `POST /v1/control/extensions/get`
- `POST /v1/control/audit/log`
- `POST /v1/control/audit/recent`
- `POST /v1/control/grants/list`
- `POST /v1/control/grants/get`
- `POST /v1/control/grants/upsert`
- `POST /v1/control/grants/reset`
- `POST /v1/control/policies/get`
- `POST /v1/control/policies/save`
- `POST /v1/control/jobs/list`
- `POST /v1/control/jobs/get`
- `POST /v1/control/jobs/create`
- `POST /v1/control/jobs/cancel`
- `POST /v1/control/jobs/upsert`
- `POST /v1/control/events/poll`

## 5.7 分页、诊断与作业注册补充

- `POST /v1/control/audit/recent`
  - 返回 `permissions` / `usage` / `errors` / `warnings`
  - 每一类都会附带 `pages.*: CursorPageInfo`

- `POST /v1/control/jobs/list`
  - 返回 `jobs` 与 `page: CursorPageInfo`

- `POST /v1/control/events/poll`
  - 同时支持传统 `afterId` 和新的 `page`
  - 返回 `events`、`cursor` 与 `page: CursorPageInfo`

- `POST /v1/sql/query`
  - 可接受可选 `page`
  - 当提供 `page` 时，结果会带 `page: CursorPageInfo`

- `POST /v1/trivium/filter-where` / `POST /v1/trivium/query`
  - 可接受可选 `page`
  - 当提供 `page` 时，结果会带 `page: CursorPageInfo`

- 当前内置后台任务注册表：
  - `delay`
  - `sql.backup`
  - `trivium.flush`
  - `fs.import-jsonl`

- 当前会持久化的运行诊断包括：
  - queue pressure
  - retry scheduled
  - timeout / failure
  - slow job

## 6. core 不直接负责什么

即使 `authority-core` 很强，也不要把它理解成“全系统入口”。

它不直接负责：

- 浏览器侧 session 生命周期
- 用户权限提示 UI
- 管理员更新页面
- SDK 自动部署
- SillyTavern 路由注册
- 浏览器可见的稳定公开 API 兼容层

这些都属于 Node adapter。

## 7. 路径安全与私有文件约束

私有文件相关内部实现里，core 做了这些防护：

- 规范化虚拟路径
- 根路径映射
- 拒绝路径穿越
- 拒绝 symlink root
- 拒绝中间路径 symlink

所以它不是宿主机任意文件访问器，而是 **受限沙盒 root**。

## 8. 请求大小 / 数据大小限制

当前编译进 core 的限制包括：

- `MAX_REQUEST_SIZE = 1 MiB`
- `MAX_KV_VALUE_BYTES = 128 KiB`
- `MAX_BLOB_BYTES = 2 MiB`
- `MAX_HTTP_BODY_BYTES = 512 KiB`
- `MAX_HTTP_RESPONSE_BYTES = 2 MiB`
- `MAX_EVENT_POLL_LIMIT = 200`
- `MAX_PRIVATE_READ_DIR_LIMIT = 200`

这些限制对开发者和 AI 很重要：

- 大对象不要塞进 KV
- Blob 不要假设可以无限大
- HTTP fetch 不要假设能拉无限响应体
- 事件轮询和目录枚举都有上限

## 9. Trivium open 参数

Trivium 内部 open 请求可接受：

- `dbPath`
- `dim`
- `dtype`
- `syncMode`
- `storageMode`

支持的类型：

- `dtype`
  - `f32`
  - `f16`
  - `u64`

- `syncMode`
  - `full`
  - `normal`
  - `off`

- `storageMode`
  - `mmap`
  - `rom`

默认配置：

- `dim = 1536`
- `storageMode = mmap`
- `syncMode` 由请求默认解析

## 10. Trivium 的算法边界

当前 core 集成的 TriviumDB 提供：

- 普通向量检索
- 图邻居扩展
- 高级搜索配置
- hybrid search
- 文本索引 / 关键词索引
- payload filter

但它不做：

- embedding 生成
- 模型下载 / 调度
- 上下文注入策略

## 11. Node adapter 如何调用 core

所有内部请求都统一走：

```text
http://127.0.0.1:<port><requestPath>
```

并带：

- `content-type: application/json`
- `x-authority-core-token: <token>`

如果当前状态不是 `running`，`CoreService.request()` 会先尝试 `start()`。

## 12. 进程管理模型

`CoreService` 会：

- 解析当前平台 managed artifact
- 校验 `authority-core.json`
- 校验 binary sha256
- 启动 child process
- 监听 stdout/stderr
- 在进程退出时把状态更新成 `stopped` 或 `error`

这意味着：

- `authority-core` 的 stderr/stdout 会被 Node adapter 转发到日志
- core 崩掉后，Node 层能感知并更新状态
- 下一次请求可能触发重启尝试

## 13. `AUTHORITY_CORE_ROOT` 的作用

若设置：

```text
AUTHORITY_CORE_ROOT=<path>
```

Node adapter 会优先去这个路径下找 managed core。

这主要适用于：

- 调试自定义 core 构建产物
- 手动覆盖 core artifact 根目录

## 14. 对开发者的建议

- **改内部执行能力，看 `authority-core/src/main.rs`**
- **改公开行为，不要只改 core，还要看 Node route 和 shared types**
- **不要把 `/v1/*` 当成浏览器稳定接口**
- **新增 core 端点时，要同步更新 `CoreService` 代理方法**
- **对路径安全相关改动，要非常谨慎，避免破坏隔离假设**

## 15. 对编程 AI 的建议

如果你是编程 AI：

- 不要建议前端直接访问 `/v1/*`
- 不要假设固定 port
- 不要跳过 `CoreService` 直接“手写内部请求”到处散落
- 不要把 core token 暴露到前端
- 新增能力时，优先保持 `shared-types -> core -> CoreService -> routes -> SDK client` 的一致性
