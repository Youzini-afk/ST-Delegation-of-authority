# 面向编程 AI 的集成与改造指南

本文是给编程 AI、自动化代理和高级开发者的“工作规则说明书”。

目的只有一个：**让你改对地方，并且不要破坏 Authority 当前的安全/发布模型。**

## 1. 先建立正确心智模型

如果你要改这个项目，请先默认下面几件事是真的：

- **公开 API 在 Node adapter，不在 Rust core**
- **浏览器接入优先走 `AuthoritySDK` / `AuthorityClient`**
- **`authority-core` 是内部 loopback 服务，不是前端稳定接口**
- **权限不是 UI 装饰，而是服务端真正拦截**
- **installable 产物不是自动永远同步的**

## 2. 常见任务应该改哪里

## 2.1 新增一个公开能力

通常需要同步修改：

- `packages/shared-types/src/index.ts`
- `packages/server-plugin/src/constants.ts`
- `packages/server-plugin/src/services/core-service.ts`
- `packages/server-plugin/src/services/*.ts`
- `packages/server-plugin/src/routes.ts`
- `crates/authority-core/src/main.rs`
- `packages/sdk-extension/src/client.ts`
- 如有需要：Security Center / permission prompt / README / docs

最常见遗漏：

- 漏了 `shared-types`
- 漏了 SDK client
- 漏了 route 层权限校验
- 漏了 installable 同步

## 2.2 新增一个只在内部使用的 core 端点

通常需要修改：

- `crates/authority-core/src/main.rs`
- `packages/server-plugin/src/services/core-service.ts`
- 调用该 core 代理的 server service

如果前端不直接用、公开 API 也不变，通常不需要改 SDK client。

## 2.3 修改权限行为

优先看：

- `packages/server-plugin/src/services/permission-service.ts`
- `packages/server-plugin/src/utils.ts`
- `packages/server-plugin/src/constants.ts`
- `packages/shared-types/src/index.ts`

关键点：

- target 的构造方式是否稳定
- 决策优先级是否变化
- `allow-once` 是否会被消费
- `deny` 是否应该持久化

## 2.4 修改数据隔离行为

优先看：

- `packages/server-plugin/src/store/authority-paths.ts`
- `packages/server-plugin/src/routes.ts`
- `packages/server-plugin/src/services/storage-service.ts`
- `packages/server-plugin/src/services/private-fs-service.ts`

这类改动风险高，因为它影响：

- 用户隔离
- 扩展隔离
- 路径兼容
- 数据迁移

## 2.5 修改 Security Center 展示

优先看：

- `packages/sdk-extension/src/security-center.ts`
- `packages/sdk-extension/src/security-center/*`
- `packages/sdk-extension/static/*`

但别忘了：

- `GET /extensions/:id` 的 `activity` 现在包含 `warnings` 与 `pages`
- `jobsPage` 是控制面聚合字段，不等于公开 `GET /jobs` 的返回合同
- `POST /jobs/list` 才是公开 jobs 的 page-aware 列表接口
- `Updates` 页现在还是管理员运维面板，里面包含 usage summary、portable package、operation 列表和 diagnostic archive
- 最终运行的是 `managed/sdk-extension/*`
- 改完源码后需要同步 installable

如果你改的是管理员运维面板，还应优先看：

- `packages/server-plugin/src/services/admin-package-service.ts`
- `packages/server-plugin/src/routes.ts`
- `docs/server/admin-import-export.md`

## 2.6 修改大列表 / 分页合同

优先看：

- `packages/shared-types/src/index.ts`
- `packages/server-plugin/src/services/core-service.ts`
- `crates/authority-core/src/main.rs`

默认规则：

- 优先复用 `CursorPageRequest` / `CursorPageInfo`
- 不要为 audit / jobs / events / SQL / Trivium 再发明一套新的分页 envelope
- 区分“公开工作流接口”和“控制面聚合接口”的分页语义

## 2.7 修改 limits / transfer 行为

优先看：

- `packages/shared-types/src/index.ts`
- `packages/server-plugin/src/constants.ts`
- `packages/server-plugin/src/services/permission-service.ts`
- `packages/server-plugin/src/services/data-transfer-service.ts`
- `packages/server-plugin/src/routes.ts`
- `packages/sdk-extension/src/client.ts`
- `crates/authority-core/src/main.rs`

先分清你改的是哪一层：

- **core hard ceiling**
  - 例如 core 内部请求、blob、HTTP、event poll 的编译时上限

- **adapter transport routing threshold**
  - 例如 `effectiveInlineThresholdBytes` 决定 inline vs transfer
  - 这是当前公开层真正仍在使用的 transport 决策值

- **compatibility transfer-max field**
  - 例如 `effectiveTransferMaxBytes`
  - 继续保留给旧合同，但当前不再代表插件层主动施加的 transfer ceiling

最常见误区：

- 只改了常量，没改 `/probe` / session 合同
- 只改了 probe，没改 SDK routing
- 只改了 routing，没改 `DataTransferService`
- 把 public adapter limits 和 core `/health.limits` 混为一谈

## 3. 对 AI 最重要的接口边界

## 3.1 前端应调用什么

前端优先调用：

- `window.STAuthority.AuthoritySDK.init(...)`
- `AuthorityClient.storage.*`
- `AuthorityClient.fs.*`
- `AuthorityClient.sql.*`
- `AuthorityClient.trivium.*`
- `AuthorityClient.http.fetch(...)`
- `AuthorityClient.jobs.*`
- `AuthorityClient.events.subscribe(...)`

不建议前端：

- 直接 fetch `/v1/*`
- 直接假设 core 端口
- 直接拼装 `x-authority-core-token`

## 3.2 公开 API 和内部 API 的判断规则

如果路径长这样：

```text
/ api/plugins/authority/...
```

它属于公开 adapter 层。

如果路径长这样：

```text
/ v1/...
```

它属于内部 core 层。

如果你在给前端写代码，默认只应该碰第一种。

## 4. 新增 route 时的 checklist

新增公开 route 前，先问自己：

- **这个能力对应哪个 `PermissionResource`？**
- **是否需要 target？**
  - 数据库名？
  - hostname？
  - channel？
  - job type？
- **请求/响应 DTO 是否应进 `shared-types`？**
- **Security Center 是否要显示它？**
- **是否需要审计日志？**
- **是否需要聚合进扩展详情页的 storage/activity/jobs？**
- **如果它属于管理员运维面板，README / `docs/server/http-api.md` / `docs/server/admin-import-export.md` 是否都要更新？**
- **如果它影响 payload 路径，是否还要更新 `/probe` / session limits 合同？**

## 5. 何时必须更新 installable

如果你改了这些内容，默认就应该考虑运行：

```bash
npm run sync:installable
npm run check:installable
```

触发条件包括：

- SDK 源码变了
- server-plugin 编译输出变了
- core 变了
- release metadata / managed 逻辑变了

额外提醒：

- 运行时生成的 `.authoritypkg.zip` / diagnostic `.json.gz` artifact 不是 installable 产物
- 不要把管理员导出包误当成应该提交进仓库的发布文件

## 6. 不要做的事

## 6.1 不要让浏览器直接访问 `authority-core`

原因：

- 端口不是固定值
- token 不应暴露给前端
- 这样会绕过 adapter 层的兼容与治理逻辑

## 6.2 不要绕过 `PermissionService`

原因：

- 你会破坏管理员策略优先级
- 会破坏 persistent / session grant 行为
- Security Center 看到的授权状态会和真实执行不一致

## 6.3 不要手写路径去碰数据文件

例如不要让前端或任意脚本直接假设：

- SQL 文件路径
- Trivium `.tdb` 路径
- Blob 文件内部布局

原因：

- 当前稳定合同是 API，不是文件布局细节
- 直接碰文件容易破坏并发和校验约束

## 6.4 不要把 `trivium.private` 当成 embedding 服务

Authority Trivium 当前要求调用方提供 `vector`。

如果你需要：

- 文本 -> embedding

应在调用方侧完成，再把向量传进来。

另外，当前推荐的 Trivium 调用方式是：

- 读路径优先使用 `trivium.tql()` / `trivium.tqlPage()`
- CREATE / SET / DELETE / DETACH DELETE 等图谱变更优先使用 `trivium.tqlMut()`
- 高频 payload 字段过滤优先考虑 `trivium.createIndex()` / `trivium.dropIndex()`
- 需要检索链路上下文或 stage timings 时，优先使用 `trivium.searchHybridWithContext()`

## 6.5 不要把 `jobs.background` 当成任意代码执行平台

当前公开内置 job type 包括：

- `delay`
- `sql.backup`
- `trivium.flush`
- `fs.import-jsonl`

如果 AI 擅自设计“后台执行任意 JS/Rust 逻辑”的接口，那不是当前实现。

## 6.6 不要把 Trivium mapping integrity 路径当成业务热路径

当前这些能力虽然是公开 API / SDK 能力，但更适合：

- diagnostics
- maintenance
- repair

具体包括：

- `trivium.stat({ includeMappingIntegrity: true })`
- `trivium.checkMappingsIntegrity()`
- `trivium.deleteOrphanMappings()`

原因是它们会触发 mapping / node 集分析，不适合挂在高频用户交互路径上。

## 7. 做改动时的推荐顺序

## 7.1 新能力

推荐顺序：

1. 在 `shared-types` 增 DTO / 类型
2. 在 core 增内部能力
3. 在 `CoreService` 增代理方法
4. 在 server service / route 暴露公开 API
5. 在 SDK client 暴露前端方法
6. 补文档 / Security Center
7. 对性能敏感改动补跑 `npm run bench:core` 与 `npm run bench:scale`，并参考 `performance-benchmarks.md`
8. 跑测试与 installable 同步

## 7.2 纯 UI 改动

推荐顺序：

1. 改 `packages/sdk-extension/src/*`
2. 改 `packages/sdk-extension/static/*`（若需要）
3. 构建并同步 `managed/sdk-extension/*`
4. 校验 probe / Security Center

## 7.3 core-only 改动

推荐顺序：

1. 改 `crates/authority-core`
2. 跑 `cargo test`
3. 更新 managed core 产物
4. 更新 `.authority-release.json`
5. 跑 installable 检查

## 8. AI 在生成代码时的边界提示

如果你是 AI，请尽量生成符合这些原则的实现：

- **所有 DTO 都经过 `shared-types`**
- **所有公开 route 都有权限检查**
- **所有重要写操作都尽量保留审计日志**
- **所有路径都经过标准化和隔离解析**
- **所有前端接入都优先复用 `AuthorityClient`**
- **所有发布相关改动都考虑 installable 同步**

## 9. 调试优先级建议

如果用户说“接口不工作了”，优先看：

1. `/api/plugins/authority/probe`
2. `core.state` 是否 `running`
3. session 是否有效
4. 权限是否 granted
5. route 是否正确映射到 core
6. Security Center / control audit 里是否已有 `warning` / `error` 诊断线索
7. installable 是否和源码一致

如果用户说“前端看起来没更新”，优先看：

1. `managed/sdk-extension/*` 是否同步
2. `.authority-release.json` 是否更新
3. 是否需要重启 SillyTavern

## 10. 一句话总结给 AI

> 在这个仓库里，**公开合同在 Node adapter，权威执行在 Rust core，浏览器接入在 SDK，发布落地在 installable**。改任何一层时，都要检查另外三层是否需要联动。
