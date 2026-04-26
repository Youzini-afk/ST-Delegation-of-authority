# ST-Delegation-of-authority

ST-Delegation-of-authority 是一个面向 SillyTavern 的基础型服务端能力与权限治理项目。

它提供一个可被 SillyTavern 原生加载的服务端插件 `authority`，并在启动时自动部署前端 SDK 扩展 `third-party/st-authority-sdk`。第三方扩展可以通过这个 SDK 使用受治理的服务端能力，例如 SQL、KV、Blob、私有文件夹、HTTP fetch、后台任务、事件流、审计和管理员策略，而不需要每个扩展都重复实现自己的后端。

- **Rust `authority-core`**：权威执行层，负责 SQLite 数据面、控制面持久化、任务执行、私有文件夹操作、事件落库和 HTTP fetch。
- **Node server plugin**：SillyTavern adapter，负责插件生命周期、路由、会话、权限组合、SDK 安装和 SSE 桥接。
- **SDK extension**：前端接入层，暴露 `window.STAuthority`，并提供 Security Center 控制面 UI。

## 当前状态

- **版本**：`0.1.0`
- **插件 ID**：`authority`
- **SDK 扩展 ID**：`third-party/st-authority-sdk`
- **示例扩展 ID**：`third-party/st-authority-example`
- **CI 统一构建平台**：Windows x64、Linux x64、Linux arm64、Android/Termux arm64
- **当前核心能力**：`sql.private`、`trivium.private`、`storage.kv`、`storage.blob`、`fs.private`、`http.fetch`、`jobs.background`、`events.stream`
- **当前内置 job types**：`delay`、`sql.backup`、`trivium.flush`、`fs.import-jsonl`
- **控制面状态**：Security Center 已支持 `warning` 诊断、扩展详情 `activity.pages` / `jobsPage` 聚合，以及 paged audit/jobs/events 内部合同

## 服务端开发文档

- **文档索引**：`docs/server/README.md`
- **架构分层**：`docs/server/architecture.md`
- **公开 HTTP / SSE API**：`docs/server/http-api.md`
- **能力矩阵与隔离模型**：`docs/server/capabilities-and-isolation.md`
- **内部 core 运行时**：`docs/server/core-runtime.md`
- **安装、更新与 installable**：`docs/server/install-update-release.md`
- **给编程 AI 的接入指南**：`docs/server/ai-integration-guide.md`

## 最近落地

- **统一 cursor/page 合同**
  - `CursorPageRequest` / `CursorPageInfo` 已进入 shared-types
  - control audit / jobs / events 已统一使用 page envelope
  - SQL query 与 Trivium `filter-where` / `query` 已支持返回 page metadata

- **Security Center 诊断增强**
  - 审计记录新增 `warning` kind
  - 会持久化并展示 job queue pressure、slow job、retry scheduled、timeout / failed 等运行时线索
  - 总览、扩展详情、活动页现在会单独展示“最近告警”

- **后台任务注册表扩展**
  - 当前受支持内置任务为：`delay`、`sql.backup`、`trivium.flush`、`fs.import-jsonl`
  - `jobs.background` 仍然是受限内置任务模型，不是任意代码执行框架

- **性能基线命令**
  - 新增 `npm run bench:core`
  - 会拉起临时 `authority-core`，为 SQL 与 paged control audit/jobs/events 生成延迟基线

## 快速安装

以下命令默认在 `SillyTavern` 根目录执行；如果你是在外部目录执行，请把目标路径写成 `SillyTavern/plugins/authority`。

### 方式一：克隆到 SillyTavern 服务端插件目录

```bash
git clone https://github.com/Youzini-afk/ST-Delegation-of-authority.git plugins/authority
```

### 方式二：使用 SillyTavern 插件安装命令

```bash
node plugins.js install https://github.com/Youzini-afk/ST-Delegation-of-authority.git
```

安装说明：

- **不需要手动复制 SDK**：首次启动时 `authority` 会自动部署 `st-authority-sdk`。
- **不需要手动启动 core**：插件会自动启动内置的 `authority-core`。
- **不自动修改 SillyTavern 配置**：仍需你自行启用 server plugins。
- **目录名不强制等于插件 ID**：SillyTavern 加载后会按模块导出的 `info.id = authority` 识别插件。

## 启用步骤

1. 打开 SillyTavern 配置文件。
1. 确认 `enableServerPlugins: true`。
1. 根据你的更新策略确认 `enableServerPluginsAutoUpdate`。
1. 启动 SillyTavern。
1. 首次启动后，`authority` 会自动部署 SDK 到：

```text
SillyTavern/public/scripts/extensions/third-party/st-authority-sdk
```

1. 打开 SillyTavern 扩展菜单，确认能看到 `Authority Security Center`。

## 升级

如果你是直接克隆到 `plugins/authority`：

```bash
cd plugins/authority
git pull
```

如果启用了 `enableServerPluginsAutoUpdate: true`，SillyTavern 启动时也会尝试拉取插件更新。

更新后，`authority` 会在下次启动时自动完成：

- **SDK 同步**：部署或刷新 `st-authority-sdk`。
- **Core 平台匹配**：确认 managed core 适配当前 `${process.platform}-${process.arch}`。
- **版本一致性校验**：确认 release metadata、SDK 和 core 版本一致。
- **Hash 校验**：校验 SDK artifact、core artifact 和 core binary SHA-256。
- **更新失败回滚**：受管 SDK 更新失败时恢复旧目录。

## GitHub Actions 多平台产物

仓库包含 `Core Artifacts` workflow：

```text
.github/workflows/core-artifacts.yml
```

它会构建并上传：

- `managed-core-win32-x64`
- `managed-core-linux-x64`
- `managed-core-linux-arm64`
- `managed-core-android-arm64`
- `authority-installable-multiplatform`

`authority-installable-multiplatform` 是汇总后的可安装产物，包含：

- `runtime/`
- `managed/sdk-extension/`
- `managed/core/win32-x64/`
- `managed/core/linux-x64/`
- `managed/core/linux-arm64/`
- `managed/core/android-arm64/`
- `.authority-release.json`

这样 Linux 服务器端和 Android/Termux 移动端可以直接使用 CI 产物，不需要你在本地交叉编译 core。

## 卸载

删除服务端插件目录：

```text
SillyTavern/plugins/authority
```

如果希望同时移除自动部署的 SDK，再删除：

```text
SillyTavern/public/scripts/extensions/third-party/st-authority-sdk
```

`authority` 只管理它自己部署的 `st-authority-sdk`。如果目标目录不是 `authority` 管理的目录，插件会进入 `conflict` 状态并拒绝覆盖。

## 冲突处理

如果 `public/scripts/extensions/third-party/st-authority-sdk` 已存在但不是 `authority` 管理目录：

1. 备份旧目录。
2. 删除或改名旧目录。
3. 重启 SillyTavern。
4. 让 `authority` 重新部署 SDK。

可以通过 `POST /api/plugins/authority/probe` 查看安装状态。

`installStatus` 可能为：

- `ready`
- `installed`
- `updated`
- `conflict`
- `error`
- `missing`

## 架构概览

```text
SillyTavern Frontend Extension
  -> window.STAuthority / AuthoritySDK
  -> /api/plugins/authority/*
  -> Node server plugin adapter
  -> localhost internal HTTP bridge
  -> Rust authority-core
  -> SQLite databases + Blob files + private files
```

职责边界：

- **SDK extension**
  - 提供 `AuthoritySDK.init()`
  - 管理前端权限弹窗
  - 提供 Security Center
  - 封装 KV、Blob、私有文件、SQL、HTTP、Jobs、Events API

- **Node server plugin**
  - 适配 SillyTavern server plugin 生命周期
  - 管理 SDK 安装状态
  - 启动、探活和关闭 Rust core
  - 做会话校验、权限评估和审计组合
  - 提供 SSE 事件流桥接

- **Rust authority-core**
  - 作为数据面和控制面的权威执行层
  - 管理 SQLite-backed KV、SQL、控制面状态、Job metadata、Event queue
  - 管理 Blob metadata 和 Blob 文件落盘
  - 管理按用户和扩展隔离的私有文件目录
  - 执行 HTTP fetch
  - 执行内置任务注册表（`delay`、`sql.backup`、`trivium.flush`、`fs.import-jsonl`）
  - 持久化 queue pressure、retry、timeout / failed、slow job 等诊断线索
  - 暴露 `/health` 诊断信息

## 可安装产物结构

仓库根目录本身就是可安装的 SillyTavern 服务端插件。

```text
ST-Delegation-of-authority/
├─ index.js
├─ package.json
├─ .authority-release.json
├─ runtime/
│  └─ index.cjs
├─ managed/
│  ├─ sdk-extension/
│  │  ├─ index.js
│  │  ├─ manifest.json
│  │  ├─ security-center.html
│  │  └─ ...
│  └─ core/
│     ├─ win32-x64/
│     │  ├─ authority-core.exe
│     │  └─ authority-core.json
│     ├─ linux-x64/            # CI artifact
│     ├─ linux-arm64/          # CI artifact
│     └─ android-arm64/        # CI artifact
├─ packages/
│  ├─ server-plugin/
│  ├─ sdk-extension/
│  ├─ example-extension/
│  └─ shared-types/
├─ crates/
│  └─ authority-core/
└─ scripts/
```

`.authority-release.json` 记录当前 installable 产物元数据：

- `pluginId`
- `pluginVersion`
- `sdkExtensionId`
- `sdkVersion`
- `assetHash`
- `coreVersion`
- `coreArtifactHash`
- `coreArtifactPlatform`
- `coreArtifactPlatforms`
- `coreArtifacts`
- `coreBinarySha256`
- `buildTime`

## 能力矩阵

| 权限资源 | SDK 能力 | Core 执行层 | 当前状态 |
| --- | --- | --- | --- |
| `storage.kv` | `client.storage.kv.*` | SQLite KV | 已实现 |
| `storage.blob` | `client.storage.blob.*` | SQLite metadata + 文件落盘 | 已实现 |
| `fs.private` | `client.fs.*` | 扩展私有目录读写 | 已实现 |
| `sql.private` | `client.sql.*` | SQLite private DB | 已实现 |
| `trivium.private` | `client.trivium.*` | TriviumDB + text/keyword index + graph search | 已实现 |
| `http.fetch` | `client.http.fetch()` | Rust HTTP fetch | 已实现 |
| `jobs.background` | `client.jobs.*` | Rust 内置任务注册表 + control metadata | 已实现 |
| `events.stream` | `client.events.subscribe()` | Rust event queue + Node SSE | 已实现 |

当前 SQL scope 以 `sql.private` 为主。数据库路径由服务端按用户和扩展映射，扩展不会直接传宿主文件路径。
`fs.private` 采用与 SQL 类似的隔离模型：每个用户、每个扩展都有独立私有根目录，扩展只能传相对虚拟路径，不能访问宿主目录或其他扩展的数据。

## 安全与治理模型

Authority 当前采用轻量但明确的安全边界：

- **扩展声明权限**：扩展在 `AuthoritySDK.init()` 时声明所需能力。
- **按资源授权**：资源粒度包括 KV、Blob、私有文件、SQL、HTTP、Jobs、Events。
- **按 target 授权**：例如 HTTP hostname、SQL database、job type、event channel。
- **用户选择**：支持 `allow-once`、`allow-session`、`allow-always`、`deny`。
- **管理员策略**：支持默认策略和按扩展覆盖策略。
- **审计记录**：记录 permission、usage、warning、error 四类活动。
- **host/path escape 防护**：SQL 数据库路径、Blob 路径和 `fs.private` 私有目录都由服务端映射并做路径逃逸检查。
- **资源限制**：core health 暴露当前请求、KV、Blob、HTTP、事件分页上限。

明确不提供：

- 任意 shell 执行
- 任意 VM 执行
- 任意服务端代码托管
- 任意文件系统访问
- 将 REST 直连接口作为 third-party 扩展的 first-class 接入方式

## Security Center

`Authority Security Center` 是当前控制面 UI。

当前视图包括：

- **总览**
  - 插件版本
  - SDK 安装状态
  - Core 运行状态
  - Core 分发校验
  - Core 请求数、错误数、活跃任务数
  - 扩展、授权、策略、数据库、任务、告警和错误概览

- **扩展详情**
  - 扩展声明权限
  - 授权记录
  - 管理员策略覆盖
  - 扩展资源占用摘要
  - 扩展私有 SQL 数据库
  - 扩展私有文件用量
  - 后台任务
  - 活动、告警与错误审计
  - `activity.pages` 与 `jobsPage` 分页元数据

 - **SQL 数据库**
  - 按扩展聚合私有 SQL 数据库
  - 展示数据库路径、大小和更新时间

 - **活动与排障**
  - permission / usage / warning / error 审计
  - jobs 状态与近期告警
  - 最近错误 / 最近告警

- **管理员策略**
  - 全局默认策略
  - 扩展级策略覆盖
  - grant reset

- **管理员更新**
  - `git-pull` 与 `redeploy-sdk`
  - installable 与 core 状态回显

前端入口：

- `window.STAuthority`
- `window.STAuthority.AuthoritySDK`
- `window.STAuthority.openSecurityCenter()`

## SDK 接入示例

第三方扩展建议在 `manifest.json` 中声明依赖：

```json
{
  "dependencies": [
    "third-party/st-authority-sdk"
  ]
}
```

初始化：

```js
const client = await window.STAuthority.AuthoritySDK.init({
  extensionId: 'third-party/your-extension',
  displayName: 'Your Extension',
  version: '0.1.0',
  installType: 'local',
  declaredPermissions: {
    storage: {
      kv: true,
      blob: true
    },
    fs: {
      private: true
    },
    sql: {
      private: true
    },
    http: {
      allow: ['api.example.com']
    },
    jobs: {
      background: ['delay']
    },
    events: {
      channels: true
    }
  }
});
```

KV：

```js
await client.storage.kv.set('settings', { theme: 'dark' });
const settings = await client.storage.kv.get('settings');
const allEntries = await client.storage.kv.list();
```

Blob：

```js
const record = await client.storage.blob.put({
  name: 'avatar.png',
  contentType: 'image/png',
  content: base64Payload,
  encoding: 'base64'
});

const blob = await client.storage.blob.get(record.id);
```

私有文件：

```js
await client.fs.mkdir('/notes', { recursive: true });

await client.fs.writeFile('/notes/hello.txt', 'hello authority', {
  encoding: 'utf8',
  createParents: true
});

const file = await client.fs.readFile('/notes/hello.txt', {
  encoding: 'utf8'
});

const entries = await client.fs.readDir('/notes');
const stat = await client.fs.stat('/notes/hello.txt');
await client.fs.delete('/notes/hello.txt');
```

SQL：

```js
await client.sql.migrate({
  database: 'main',
  migrations: [
    {
      id: '001_create_notes',
      statement: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL)'
    }
  ]
});

await client.sql.exec({
  database: 'main',
  statement: 'INSERT INTO notes (title) VALUES (?)',
  params: ['hello']
});

const result = await client.sql.query({
  database: 'main',
  statement: 'SELECT id, title FROM notes ORDER BY id DESC',
  params: []
});
```

HTTP：

```js
const response = await client.http.fetch({
  url: 'https://api.example.com/data',
  method: 'GET'
});
```

Jobs：

```js
const job = await client.jobs.create('delay', {
  durationMs: 3000,
  message: 'done'
});

const latest = await client.jobs.get(job.id);
```

当前公开内置 job type：

- `delay`
- `sql.backup`
- `trivium.flush`
- `fs.import-jsonl`

Events：

```js
const subscription = await client.events.subscribe({
  channel: 'extension:third-party/your-extension',
  eventNames: ['authority.connected', 'authority.job'],
  onEvent: event => {
    console.log(event.name, event.data);
  }
});

subscription.close();
```

打开 Security Center：

```js
await client.openSecurityCenter();
```

## 服务端 API

这些接口由 SillyTavern server plugin 路由暴露在：

```text
/api/plugins/authority/*
```

当前主要接口：

- `POST /probe`
- `POST /session/init`
- `GET /session/current`
- `POST /permissions/evaluate`
- `POST /permissions/resolve`
- `GET /extensions`
- `GET /extensions/:id`
- `POST /extensions/:id/grants/reset`
- `POST /storage/kv/get`
- `POST /storage/kv/set`
- `POST /storage/kv/delete`
- `POST /storage/kv/list`
- `POST /storage/blob/put`
- `POST /storage/blob/get`
- `POST /storage/blob/delete`
- `POST /storage/blob/list`
- `POST /fs/private/mkdir`
- `POST /fs/private/read-dir`
- `POST /fs/private/write-file`
- `POST /fs/private/read-file`
- `POST /fs/private/delete`
- `POST /fs/private/stat`
- `POST /sql/query`
- `POST /sql/exec`
- `POST /sql/batch`
- `POST /sql/transaction`
- `POST /sql/migrate`
- `GET /sql/databases`
- `POST /trivium/insert`
- `POST /trivium/insert-with-id`
- `POST /trivium/resolve-id`
- `POST /trivium/upsert`
- `POST /trivium/bulk-upsert`
- `POST /trivium/get`
- `POST /trivium/update-payload`
- `POST /trivium/update-vector`
- `POST /trivium/delete`
- `POST /trivium/bulk-link`
- `POST /trivium/link`
- `POST /trivium/bulk-unlink`
- `POST /trivium/unlink`
- `POST /trivium/bulk-delete`
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
- `GET /trivium/databases`
- `POST /http/fetch`
- `POST /jobs/create`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/cancel`
- `GET /events/stream`
- `GET /admin/policies`
- `POST /admin/policies`
- `POST /admin/update`

普通扩展应优先通过 SDK 调用，而不是直接把 REST API 当作主要接入方式。

## Probe 与诊断

调用：

```text
POST /api/plugins/authority/probe
```

常用字段：

- `pluginVersion`
- `sdkBundledVersion`
- `sdkDeployedVersion`
- `coreBundledVersion`
- `coreArtifactPlatform`
- `coreArtifactPlatforms`
- `coreArtifactHash`
- `coreBinarySha256`
- `coreVerified`
- `installStatus`
- `installMessage`
- `core.state`
- `core.pid`
- `core.port`
- `core.version`
- `core.lastError`
- `core.health.uptimeMs`
- `core.health.requestCount`
- `core.health.errorCount`
- `core.health.activeJobCount`
- `core.health.limits`

`core.health.limits` 包括：

- `maxRequestBytes`
- `maxKvValueBytes`
- `maxBlobBytes`
- `maxHttpBodyBytes`
- `maxHttpResponseBytes`
- `maxEventPollLimit`

## 开发环境

开发需要：

- Node.js
- npm
- Rust toolchain
- Windows x64 环境用于生成当前 managed core installable

安装依赖：

```bash
npm install
```

常用命令：

```bash
npm run typecheck
npm run build
npm test
npm run bench:core
npm run sync:installable
npm run check:installable
npm run dev:link
npm run dev:unlink
```

命令说明：

- `npm run typecheck`：TypeScript project references 类型检查。
- `npm run build`：构建 shared-types、Rust core、server-plugin、sdk-extension、example-extension。
- `npm test`：运行 Vitest 测试和 Rust core 稳定性测试。
- `npm run bench:core`：拉起临时 `authority-core`，输出 SQL 与 paged control audit/jobs/events 的基线延迟。
- `npm run sync:installable`：重新生成根目录可直装产物。
- `npm run check:installable`：检查根目录可直装产物是否与源码构建一致。
- `npm run dev:link`：构建并链接到本地 SillyTavern。
- `npm run dev:unlink`：清理本地 SillyTavern 联调链接。

本地编译主要用于开发验证、调试和联调，不作为面向最终用户的推荐发布方式。面向最终用户的可安装产物应优先由 GitHub Actions 的 `Core Artifacts` workflow 统一构建和发布。

## 本地联调

当前 `dev:link` 脚本假设目录结构为：

```text
E:\cursor_project\ST-Delegation of authority\
├─ SillyTavern
└─ ST-Delegation-of-authority
```

联调步骤：

1. 运行 `npm install`。
2. 运行 `npm run build`。
3. 运行 `npm run dev:link`。
4. 确认 SillyTavern 已启用 `enableServerPlugins: true`。
5. 建议本地开发时把 `enableServerPluginsAutoUpdate` 设为 `false`。
6. 启动 SillyTavern。

`dev:link` 会创建：

- `SillyTavern/plugins/authority`
- `SillyTavern/public/scripts/extensions/third-party/st-authority-sdk`
- `SillyTavern/public/scripts/extensions/third-party/st-authority-example`

## 发布与 installable 同步

发布前建议执行：

```bash
npm run typecheck
npm run build
npm test
npm run sync:installable
npm run check:installable
```

`sync:installable` 会刷新：

- `runtime/index.cjs`
- `managed/sdk-extension/*`
- `managed/core/<platform>/*`
- `.authority-release.json`

`check:installable` 会校验 installable 产物是否与当前源码和构建结果一致。

多平台发布链路由 GitHub Actions 完成：

1. 每个平台矩阵 job 运行 `scripts/build-core.mjs`。
2. 每个平台上传 `managed-core-<platform>` artifact。
3. 汇总 job 下载所有 core artifact。
4. 汇总 job 生成 `authority-installable-multiplatform`。
5. 汇总 job 运行 `scripts/installable.mjs sync` 和 `scripts/installable.mjs check` 校验 metadata。

## 测试覆盖

当前测试覆盖包括：

- 权限状态流转
- 一次性授权消费
- 管理员策略覆盖用户授权
- KV 命名空间隔离
- Blob 读写与删除
- 内建 delay 任务创建、完成、取消
- Managed SDK 首装、幂等、升级、冲突保护、漂移修复、失败回滚
- Managed core 平台匹配、版本一致性、binary hash、artifact hash
- SQL transaction 失败回滚
- SQL migration 幂等
- Jobs 与 Events 一致性
- Event polling 上限保护
- Core health 请求数、错误数、活跃任务数和限制值诊断
- 根目录 installable 一致性检查

`npm test` 当前会运行：

- `vitest run`
- `cargo test --manifest-path crates/authority-core/Cargo.toml`

## 排障

### Security Center 看不到

- 确认 `enableServerPlugins: true`。
- 确认服务端插件已加载。
- 查看 `POST /api/plugins/authority/probe` 的 `installStatus`。
- 如果 SDK 目录冲突，按冲突处理步骤删除或改名旧目录。

### Core 无法启动

- 查看 `probe.core.state`。
- 查看 `probe.core.lastError`。
- 确认当前平台是已内置 managed core 的平台。
- 确认 `.authority-release.json` 与 `managed/core/<platform>/authority-core.json` 存在。
- 运行 `npm run check:installable` 检查产物一致性。

### SDK 一直是 conflict

- 检查：

```text
SillyTavern/public/scripts/extensions/third-party/st-authority-sdk
```

- 如果这是旧目录或手动复制目录，请备份后删除。
- 重启 SillyTavern，让 `authority` 重新部署。

### SQL 报权限错误

- 确认扩展声明了：

```js
declaredPermissions: {
  sql: {
    private: true
  }
}
```

- 打开 Security Center 查看该扩展的 `sql.private` grant 或管理员策略。
- 确认使用的是 SDK 的 `client.sql.*` API，而不是手动传宿主文件路径。

### Events 没有收到 job 事件

- 确认声明了 `events.stream` 权限。
- 默认 job 事件 channel 为：

```text
extension:<extensionId>
```

- 使用 Security Center 查看 jobs 和 activity 状态。

## 当前限制

当前是 Beta 基线，不是最终完整平台。

已知限制：

- 仓库当前只跟踪 Windows x64 managed core 样例；长期目标是把面向用户的多平台产物统一交给 GitHub Actions artifact 分发。
- 后台任务当前只实现内建 `delay`。
- SSE 事件流由 Node adapter 桥接，core 负责事件队列。
- 不支持 WebSocket。
- 不支持跨用户广播。
- 当前 SQL 主要覆盖 `sql.private`。
- 不支持任意服务端代码托管。
- 不支持任意 shell / VM 执行。
- 不支持把 REST 直连接口作为普通扩展的一等接入方式。

## 路线方向

后续可继续推进：

- 更系统的 stress benchmark。
- 更细分的错误分类和指标导出。
- 更多内建 job 类型。
- 更完善的事件订阅模型。
- Security Center 深度运维视图。
- 公开发布后的升级和迁移策略。
