# Authority — SillyTavern 扩展的后端能力与权限治理

Authority 是一个 SillyTavern 服务端插件，给第三方扩展提供统一的后端能力——数据库、存储、文件读写、网络请求、图数据库、后台任务、事件流——而不是让每个扩展自己造轮子。

同时它不是裸放后端，上面盖了一层权限治理：扩展要先用先声明，用户可以放行或拒绝，管理员可以统一收口。

**插件 ID** `authority` · **SDK** `third-party/st-authority-sdk` · **平台** Windows x64 / Linux x64 / Linux arm64 / Android arm64

---

## 它能做什么

| 能力 | SDK 调用 | 说明 |
|---|---|---|
| SQL 数据库 | `client.sql.*` | 按用户按扩展隔离的 SQLite，支持 migration、transaction、分页查询 |
| Trivium 图数据库 | `client.trivium.*` | 向量检索 + 图谱 + TQL + 混合搜索 + 上下文检索 |
| KV 存储 | `client.storage.kv.*` | 轻量键值对 |
| Blob 存储 | `client.storage.blob.*` | 二进制文件，支持大文件分块传输 |
| 私有文件 | `client.fs.*` | 按用户按扩展隔离的文件目录，读写、删除、stat |
| HTTP 请求 | `client.http.fetch()` | 走 core 发出请求，支持大 body 分块 |
| 后台任务 | `client.jobs.*` | 内置 delay / sql.backup / trivium.flush / fs.import-jsonl |
| 事件流 | `client.events.subscribe()` | SSE 推送，core 管队列，Node 桥接 |

所有数据都是按用户 + 扩展隔离的，扩展不能访问其他扩展的数据或宿主文件系统。

## 快速开始

### 安装

在 SillyTavern 根目录执行：

```bash
# 方式一：直接克隆
git clone https://github.com/Youzini-afk/ST-Delegation-of-authority.git plugins/authority

# 方式二：SillyTavern 插件安装
node plugins.js install https://github.com/Youzini-afk/ST-Delegation-of-authority.git
```

### 启用

1. 确认 SillyTavern 配置中 `enableServerPlugins: true`
2. 启动 SillyTavern
3. 插件会自动部署 SDK 扩展和启动 Rust core
4. 打开扩展菜单，确认能看到 Authority Security Center

> 安装后不需要手动复制 SDK 或启动 core——插件会自动完成。目录名不强制等于插件 ID，SillyTavern 按 `info.id = authority` 识别。

### 升级

```bash
cd plugins/authority && git pull
```

如果开启了 `enableServerPluginsAutoUpdate`，SillyTavern 启动时也会自动拉取更新。更新后插件会在下次启动时自动完成 SDK 同步、core 平台匹配、版本一致性校验和 hash 校验。

### 卸载

删除 `SillyTavern/plugins/authority` 即可。如需同时移除自动部署的 SDK，再删除 `SillyTavern/public/scripts/extensions/third-party/st-authority-sdk`。

---

## SDK 接入

### 初始化

```js
const client = await window.STAuthority.AuthoritySDK.init({
  extensionId: 'third-party/your-extension',
  displayName: 'Your Extension',
  version: '1.0.0',
  installType: 'local',
  declaredPermissions: {
    sql: { private: true },
    trivium: { private: true }
  }
});
```

### SQL

```js
await client.sql.migrate({
  database: 'main',
  migrations: [
    { id: '001_create_notes', statement: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL)' }
  ]
});

const result = await client.sql.query({
  database: 'main',
  statement: 'SELECT id, title FROM notes ORDER BY id DESC',
  params: []
});
```

### Trivium

```js
await client.trivium.tqlMut({ database: 'graph', query: 'CREATE (a {name: "Alice", status: "active"})' });

const rows = await client.trivium.tql({ database: 'graph', query: 'MATCH (n) RETURN n' });

const page = await client.trivium.tqlPage({ database: 'graph', query: 'MATCH (n) RETURN n', page: { limit: 50 } });

const search = await client.trivium.searchHybridWithContext({
  database: 'graph',
  vector: [1, 0, 0],
  queryText: 'Alice',
  topK: 5
});
```

> Trivium 推荐用法：读路径用 `tql()` / `tqlPage()`，变更用 `tqlMut()`，字段过滤用 `createIndex()` / `dropIndex()`，检索上下文用 `searchHybridWithContext()`。`checkMappingsIntegrity` / `deleteOrphanMappings` 是诊断维护路径，不要用在热路径。

### KV / Blob / 文件 / HTTP / Jobs / Events

```js
await client.storage.kv.set({ key: 'foo', value: 'bar' });
const { value } = await client.storage.kv.get({ key: 'foo' });

await client.storage.blob.put({ name: 'image.png', content: base64Data, encoding: 'base64', contentType: 'image/png' });
const blob = await client.storage.blob.get({ id: '...' });

await client.fs.writeFile({ path: 'data/config.json', content: '{"ok":true}' });
const file = await client.fs.readFile({ path: 'data/config.json' });

const resp = await client.http.fetch({ url: 'https://api.example.com/data' });

const job = await client.jobs.create({ type: 'delay', payload: { ms: 5000 } });

client.events.subscribe({ channel: 'extension:third-party/your-extension' }, (event) => { /* ... */ });
```

---

## 权限与安全

Authority 的安全边界是轻量但明确的：

**扩展声明 → 用户授权 → 管理员收口**

- 扩展在 `init()` 时声明所需能力
- 用户可以选择 `allow-once` / `allow-session` / `allow-always` / `deny`
- 管理员可以设全局默认策略和按扩展覆盖策略
- 当前所有资源系统默认 `granted`，新装扩展开箱即用

权限评估顺序（从高到低）：

```
声明门控 → 管理员扩展覆盖 → 管理员默认(granted/denied/blocked) → 持久授权 → 会话授权 → 管理员默认(prompt) → 系统默认(granted)
```

这意味着：没有管理员收紧规则时大部分请求直接放行；管理员设 `prompt` 时用户仍可手动授权；管理员设 `denied` / `blocked` 时强于用户授权。

**明确不提供**：任意 shell 执行、VM 执行、服务端代码托管、任意文件系统访问、REST 直连作为扩展一等接入方式。

### Security Center

Authority 内置 Security Center 控制面 UI，通过 `window.STAuthority.openSecurityCenter()` 打开：

- **总览** — 插件状态、core 运行状态、资源概览
- **扩展详情** — 声明权限、授权记录、策略覆盖、资源占用、活动审计
- **数据资产** — 按扩展聚合的数据库和存储视图
- **活动与排障** — 审计（permission / usage / warning / error）、任务状态、告警
- **管理员策略** — 全局默认、扩展级策略覆盖、grant 重置
- **运维面板** — 更新、用法汇总、portable package 导入导出、诊断归档

---

## 架构

```
SillyTavern 前端
  → window.STAuthority / AuthoritySDK
  → /api/plugins/authority/*
  → Node server plugin（适配层）
  → localhost 内部 HTTP
  → Rust authority-core（执行层）
  → SQLite + Blob 文件 + 私有文件
```

- **SDK extension** — 前端接入、权限弹窗、Security Center
- **Node server plugin** — 插件生命周期、路由、会话、权限评估、SDK 安装、SSE 桥接
- **Rust authority-core** — 数据面和控制面权威执行层：SQL/KV/Blob/Trivium/文件/HTTP/Jobs/Events

---

## 项目开发

### 前置条件

- Node.js + npm
- Rust toolchain
- Windows x64 环境（生成 managed core）

### 常用命令

```bash
npm install                 # 安装依赖
npm run typecheck           # TypeScript 类型检查
npm run build               # 构建 shared-types → Rust core → server-plugin → sdk-extension → example
npm test                    # vitest + cargo test
npm run bench:core          # SQL 与分页审计基线延迟（CI gate: avg ≤ 150ms, p95 ≤ 300ms）
npm run bench:scale         # 大规模 Trivium / mapping / 混合负载基准
npm run sync:installable    # 重新生成可直装产物
npm run check:installable   # 校验产物一致性
npm run dev:link            # 构建并链接到本地 SillyTavern
npm run dev:unlink          # 清理联调链接
```

### 本地联调

`dev:link` 假设 SillyTavern 和本项目在同一父目录下：

```
<parent>/
├─ SillyTavern/
└─ ST-Delegation-of-authority/
```

```bash
npm install && npm run build && npm run dev:link
# 确认 SillyTavern enableServerPlugins: true，建议 AutoUpdate: false
# 启动 SillyTavern
```

### 发布流程

```bash
npm run typecheck && npm run build && npm test
npm run bench:core && npm run bench:scale
npm run sync:installable && npm run check:installable
```

多平台发布由 GitHub Actions `Core Artifacts` workflow 完成：每个平台构建 core → 上传 artifact → 汇总生成 `authority-installable-multiplatform`。

---

## 文档

| 文档 | 内容 |
|---|---|
| [docs/server/README.md](docs/server/README.md) | 服务端文档索引 |
| [docs/server/architecture.md](docs/server/architecture.md) | 架构分层、调用链、生命周期 |
| [docs/server/http-api.md](docs/server/http-api.md) | 公开 HTTP / SSE API 清单 |
| [docs/server/capabilities-and-isolation.md](docs/server/capabilities-and-isolation.md) | 能力矩阵、隔离模型、安全边界 |
| [docs/server/core-runtime.md](docs/server/core-runtime.md) | Rust core 内部 API、健康检查、作业注册 |
| [docs/server/install-update-release.md](docs/server/install-update-release.md) | 安装、更新、installable 产物 |
| [docs/server/admin-import-export.md](docs/server/admin-import-export.md) | 管理员运维、迁移、备份 |
| [docs/server/performance-benchmarks.md](docs/server/performance-benchmarks.md) | 基准测试说明 |
| [docs/server/ai-integration-guide.md](docs/server/ai-integration-guide.md) | 编程 AI 接入规则 |

---

## 排障

### Security Center 看不到

- 确认 `enableServerPlugins: true`
- 查看 `POST /api/plugins/authority/probe` 的 `installStatus`
- 如果 SDK 目录冲突，删除旧目录后重启

### Core 无法启动

- 查看 `probe.core.state` 和 `probe.core.lastError`
- 确认当前平台在 `.authority-release.json` 的 `coreArtifactPlatforms` 中
- 运行 `npm run check:installable`

### SDK 状态 conflict

- 检查 `SillyTavern/public/scripts/extensions/third-party/st-authority-sdk` 是否为 authority 管理的目录
- 备份后删除旧目录，重启让 authority 重新部署

### SQL 报权限错误

- 确认扩展声明了 `declaredPermissions: { sql: { private: true } }`
- 在 Security Center 查看 `sql.private` 授权或管理员策略

### 事件没有收到

- 确认声明了 `events.stream` 权限
- Job 事件默认 channel 为 `extension:<extensionId>`

---

## 当前限制与计划

**当前限制：**

- Jobs 仅支持内置类型（`delay`、`sql.backup`、`trivium.flush`、`fs.import-jsonl`），不是任意代码执行
- 事件流为 SSE，不支持 WebSocket 和跨用户广播
- SQL 主要覆盖 `sql.private`
- 不提供 shell 执行、VM 执行、服务端代码托管

**后续方向：**

- 更系统的压力基准与错误分类
- 更多内建 job 类型
- 更完善的事件订阅模型
- Security Center 深度运维视图
- **公开发布后的升级迁移策略**