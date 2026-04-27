# ST-Delegation-of-authority 服务端文档

这组文档面向两类读者：

- 开发者
- 编程 AI / 自动化代码代理

目标不是重复 README 的安装说明，而是把 **服务端能力边界、公开 API、内部 core 运行方式、权限与存储隔离、installable 更新约束** 讲清楚，方便你做二次开发、调试和架构判断。

## 快速事实

- **服务端插件 ID**：`authority`
- **前端 SDK 扩展 ID**：`third-party/st-authority-sdk`
- **公开 HTTP 基路径**：`/api/plugins/authority`
- **公开传输方式**：复用 SillyTavern 自身 HTTP 服务端口，不额外暴露独立公网端口
- **公开错误合同**：结构化 `AuthorityErrorPayload`，含 `code` / `category` / `details`
- **公开 limits 合同**：`/probe` 与 session 返回都携带 effective inline thresholds / transfer ceilings
- **内部 core 执行层**：Rust `authority-core`
- **内部 core 绑定地址**：插件运行时为 `127.0.0.1:<ephemeral-port>`
- **Session Header**：`x-authority-session-token`
- **Session Query**：`authoritySessionToken`
- **Core Header**：`x-authority-core-token`
- **内置后台任务**：`delay`、`sql.backup`、`trivium.flush`、`fs.import-jsonl`
- **控制面诊断种类**：`permission`、`usage`、`warning`、`error`
- **统一分页合同**：`CursorPageRequest` / `CursorPageInfo`
- **installable 关键产物**：`runtime/`、`managed/sdk-extension/`、`managed/core/`、`.authority-release.json`

## 文档目录

- `docs/server/architecture.md`
  - 架构分层、调用链、生命周期、端口暴露模型

- `docs/server/http-api.md`
  - Node server-plugin 对外公开的 HTTP / SSE API 清单，包括 Security Center 聚合视图与作业/事件边界

- `docs/server/capabilities-and-isolation.md`
  - 权限资源、风险等级、数据隔离、路径布局、能力边界

- `docs/server/core-runtime.md`
  - Rust `authority-core` 的内部 API、健康检查、环境变量、作业注册和分页/诊断细节

- `docs/server/install-update-release.md`
  - installable 产物、SDK 部署、core 校验、更新流程、同步命令与基线验证命令

- `docs/server/ai-integration-guide.md`
  - 面向编程 AI 的接入规则、常见修改任务、反模式和检查清单

## 适合先读哪一篇

- **想先理解系统全貌**
  - 先读 `architecture.md`

- **想知道具体暴露了哪些接口**
  - 先读 `http-api.md`

- **想判断一个能力会不会串数据 / 越权 / 冲突**
  - 先读 `capabilities-and-isolation.md`

- **想知道 core 到底监听了什么端口 / 有哪些内部端点**
  - 先读 `core-runtime.md`

- **想改构建、升级或发布流程**
  - 先读 `install-update-release.md`

- **想做性能回归或优化切片基线**
  - 先看根目录 `npm run bench:core`

- **想让编程 AI 快速安全地改这个项目**
  - 先读 `ai-integration-guide.md`

## 常用验证命令

```bash
npm run typecheck
npm test
npm run bench:core
npm run sync:installable
npm run check:installable
```

其中：

- `npm run bench:core`
  - 会临时拉起 `authority-core`
  - 生成 SQL 与 paged control audit/jobs/events 的延迟基线

- `npm run sync:installable`
  - 会先做类型检查、构建和测试
  - 然后同步 `runtime/`、`managed/sdk-extension/`、`managed/core/` 和 `.authority-release.json`

## 给编程 AI 的最小规则

- **优先走公开 Node adapter API，不要直接让前端访问 `authority-core`**
  - 公开入口是 `/api/plugins/authority/*`
  - `authority-core` 是内部实现层，不是给浏览器直连的稳定接口

- **不要假设 `authority-core` 有固定端口**
  - 插件正常运行时，端口是启动时动态分配的 loopback 端口

- **不要绕过 session 初始化**
  - 正常扩展接入应先调用 `AuthoritySDK.init()` 或 `POST /session/init`

- **不要把 installable 产物当成自动同步**
  - 改了前端构建产物、runtime 或 managed/core 后，要跑：
  - `npm run sync:installable`
  - `npm run check:installable`

- **不要把权限资源理解成“只有 UI 提示”**
  - 权限在 Node adapter 路由层会被真正校验
  - 部分能力还会以 target 细化，例如数据库名、hostname、channel、job type

## 范围说明

本目录只覆盖当前仓库里已经落地的服务端能力，不覆盖：

- 未来可能出现但尚未实现的公共 API
- 外部项目自己的召回/embedding 逻辑
- SillyTavern 核心本身的 API 设计

## 相关源码入口

- `packages/server-plugin/src/index.ts`
- `packages/server-plugin/src/routes.ts`
- `packages/server-plugin/src/runtime.ts`
- `packages/server-plugin/src/services/core-service.ts`
- `packages/server-plugin/src/services/install-service.ts`
- `packages/server-plugin/src/store/authority-paths.ts`
- `crates/authority-core/src/main.rs`
- `packages/shared-types/src/index.ts`
