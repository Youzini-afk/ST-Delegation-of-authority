# 安装、更新、installable 与发布约束

本文专门讲服务端相关的“落地问题”：

- SDK 是如何自动部署的
- core artifact 怎么校验
- `managed/` 和 `.authority-release.json` 到底是什么
- 为什么很多改动必须跑 `sync:installable`
- `/admin/update` 到底做什么

## 1. installable 产物是什么

仓库根目录本身就是一个可安装的 SillyTavern 服务端插件。

其中最关键的 installable 产物有：

- `runtime/`
- `managed/sdk-extension/`
- `managed/core/`
- `.authority-release.json`

它们的职责分别是：

- **`runtime/`**
  - 给实际插件加载使用的运行时代码

- **`managed/sdk-extension/`**
  - 自动部署到 `public/scripts/extensions/third-party/st-authority-sdk` 的前端 SDK 产物

- **`managed/core/`**
  - 按平台管理的 `authority-core` 可执行产物与元数据

- **`.authority-release.json`**
  - 当前 installable 构建的统一 release metadata
  - 记录 SDK hash、core hash、版本、平台信息

## 2. 插件启动时的部署流程

启动阶段：

1. `install.bootstrap()`
2. 尝试解析 release metadata
3. 验证 managed core
4. 解析 SillyTavern 根目录
5. 检查 `st-authority-sdk` 目标目录
6. 若缺失或版本/hash 漂移，则重新部署 SDK
7. 更新 install status
8. 然后再启动 `authority-core`

## 3. SDK 自动部署路径

部署目标固定为：

```text
<SillyTavernRoot>/public/scripts/extensions/third-party/st-authority-sdk
```

判断一个目录是否由 Authority 管理，依赖：

```text
.authority-managed.json
```

如果目标目录存在但不是 Authority 管理的，install status 会进入：

- `conflict`

此时插件不会强行覆盖别人的目录。

## 4. `AUTHORITY_ST_ROOT` 的作用

`InstallService.resolveSillyTavernRoot()` 会从这些位置推断 ST 根目录：

- 当前工作目录
- `pluginRoot/../..`
- `AUTHORITY_ST_ROOT`

所以如果仓库布局特殊，可以显式设置：

```text
AUTHORITY_ST_ROOT=<path-to-sillytavern-root>
```

## 5. core 校验到底校什么

当前 `verifyBundledCore()` 至少会检查：

- release metadata 是否存在
- 当前平台是否在 release 支持平台内
- 当前平台 `authority-core.json` 是否存在
- metadata 是否有效且 `managedBy === authority`
- metadata 的 platform/arch 是否匹配当前运行平台
- metadata 版本是否匹配 release 中的 coreVersion
- binary 是否存在
- binary sha256 是否匹配 `authority-core.json`
- binary sha256 是否匹配 `.authority-release.json`

这些属于 **强校验**。

## 6. 哪些 hash 漂移只是 warning

当前实现里，这两类漂移只会给 warning，不会阻止 SDK 部署：

- 当前平台目录整体 `artifactHash` 漂移
- `managed/core/` 根目录整体 `coreArtifactHash` 漂移

前提是：

- 当前平台 binary 本身仍然校验通过

所以现在的语义是：

- **binary 校验失败 => core verification fail**
- **目录级 hash 漂移但 binary 正常 => 可继续部署 SDK，但带 warning**

## 7. install status 与 coreVerified 的区别

要把这两个概念分开：

- **`installStatus`**
  - 描述 SDK 部署结果
  - 例如 `installed`、`updated`、`ready`、`conflict`、`missing`、`error`

- **`coreVerified`**
  - 描述 managed core 校验结果

也就是说：

- SDK 部署状态不等于 core 一定完全健康
- core 校验 warning 也会通过 `/probe` 暴露

## 8. `/admin/update` 的真实语义

管理员更新接口：

- `POST /admin/update`

支持 action：

- `git-pull`
- `redeploy-sdk`

## 8.1 `git-pull`

行为：

1. 如 core 正在运行，先停 core
2. 在插件根目录执行 `git pull --ff-only`
3. `refreshReleaseMetadata()`
4. 重新部署 bundled SDK
5. 重启 core
6. 返回 git revision 摘要与 before/after install snapshot

但要特别注意：

- 即使 git pull 成功了，如果 Node server-plugin 自身代码变了，**仍通常需要重启 SillyTavern** 才能应用新的 Node 代码

## 8.2 `redeploy-sdk`

行为：

1. 不访问远端仓库
2. 不拉取新提交
3. 重新执行 SDK 部署与校验
4. 检查 / 恢复 core 状态

它适合：

- 前端 SDK 产物已变化，但不需要拉服务端代码
- 想强制刷新部署到 `third-party/st-authority-sdk`

## 8.3 Security Center 里的管理员运维面板

当前 `Security Center -> Updates` 已经不只是“更新页”，而是管理员运维面板。

它现在聚合了：

- `git-pull`
- `redeploy-sdk`
- 当前插件 / SDK / core 安装状态回显
- `Usage Summary`
- portable package 导出 / 导入
- import/export operation 列表、失败恢复、artifact 下载
- diagnostic bundle JSON
- diagnostic archive `.json.gz`

需要区分两类东西：

- **install/update 行为**
  - 影响 `runtime/`、`managed/sdk-extension/`、`managed/core/`、`.authority-release.json`
- **管理员运行时 artifact**
  - 例如 `.authoritypkg.zip` 与 diagnostic `.json.gz`
  - 这是运行时生成的运维文件，不属于 installable 发布产物

## 9. release metadata 为什么重要

`.authority-release.json` 里至少记录：

- `pluginId`
- `pluginVersion`
- `sdkExtensionId`
- `sdkVersion`
- `assetHash`
- `coreVersion`
- `coreArtifactHash`
- `coreArtifactPlatforms`
- `coreArtifacts`
- `coreBinarySha256`
- `buildTime`

这意味着它不是附带文件，而是 **installable 校验的关键合同**。

## 10. 为什么很多前端改动要同步 installable

这个项目不是只有源码。

很多真正会被 SillyTavern 运行和部署的文件是：

- `runtime/*`
- `managed/sdk-extension/*`
- `managed/core/*`
- `.authority-release.json`

所以：

- 改了 `packages/sdk-extension/src/*`
- 改了 `packages/server-plugin/src/*`
- 改了 `crates/authority-core/*`

并不代表 installable 就自动跟着更新了。

如果只改源码、不同步 installable，常见后果是：

- 前端实际运行的还是旧 managed SDK
- release metadata 与产物 hash 不一致
- probe / Security Center 报状态异常
- 更新页表现和真实运行代码不一致

## 11. 什么时候必须跑 `npm run sync:installable`

建议这样理解：

## 11.1 必跑场景

- 修改了 `sdk-extension` 并准备提交/发布
- 修改了 `server-plugin` 编译产物会影响 `runtime/`
- 修改了 `authority-core`
- 修改了 `managed/` 相关脚本或 release metadata 生成逻辑
- 准备推送一个“用户安装后应该立即生效”的改动

### 配套检查

最安全的顺序是：

```bash
npm run bench:core
npm run sync:installable
npm run check:installable
```

如果你在做性能相关改动，更推荐：

```bash
npm run typecheck
npm test
npm run bench:core
npm run sync:installable
npm run check:installable
```

当前 `sync:installable` 已经包含：

- `npm run typecheck`
- `npm run build`
- `npm test`
- `node ./scripts/installable.mjs sync`

## 12. 本项目的发布/同步命令

仓库根命令：

```bash
npm run build
npm run typecheck
npm test
npm run bench:core
npm run sync:installable
npm run check:installable
```

其中：

- `npm run build`
  - 构建 shared-types / core / server-plugin / sdk-extension / example-extension

- `npm test`
  - `vitest run`
  - `cargo test --manifest-path crates/authority-core/Cargo.toml`

- `npm run bench:core`
  - 拉起临时 `authority-core`
  - 生成 SQL 与 paged control audit/jobs/events 的延迟基线
  - 也是当前 CI 的 benchmark gate 命令

- `npm run sync:installable`
  - 全量构建 + 测试 + installable 同步

- `npm run check:installable`
  - 检查当前 tracked installable 是否与源码/生成逻辑一致

## 12.1 CI 里的 benchmark gate

当前 `.github/workflows/ci.yml` 在 `Typecheck`、`Build`、`Test` 之后，会继续执行：

```bash
npm run bench:core
```

并通过环境变量设置保守阈值：

- `AUTHORITY_BENCH_MAX_AVG_MS=150`
- `AUTHORITY_BENCH_MAX_P95_MS=300`

它的目的不是做完整性能评测，而是：

- 避免明显的性能回退直接进入 `main`
- 给 SQL 与 paged control audit/jobs/events 这条关键路径一个最低限度的回归门禁

如果你在改：

- 分页路径
- audit / jobs / events 轮询
- SQL adapter
- Trivium 查询聚合
- Security Center 依赖的控制面聚合接口

就应该默认关注 benchmark gate 是否会被影响。

## 13. 典型提交边界

如果你改了以下内容：

- `packages/sdk-extension/src/*`
- `packages/server-plugin/src/*`
- `crates/authority-core/*`

请默认检查是否还需要提交：

- `managed/sdk-extension/*`
- `runtime/*`
- `managed/core/<platform>/*`
- `.authority-release.json`

## 14. 对开发者的建议

- **把 `managed/` 和 `runtime/` 当成发布产物，不要当普通缓存目录**
- **不要手改 `.authority-release.json` 里的 hash**
  - 应该通过同步脚本重建
- **如果 probe 报 core hash mismatch，先看 release metadata 与 binary 是否同步**
- **如果只是前端 UI 改了，也要考虑 managed SDK 是否需要一起提交**
- **不要把 `.authoritypkg.zip` 或 diagnostic `.json.gz` 当成 installable 产物提交进仓库**

## 15. 对编程 AI 的建议

如果你是编程 AI：

- 不要只改源码就宣称“前端已更新”
- 不要忘记 installable 同步
- 不要把 `redeploy-sdk` 解释成“自动更新了 Node 服务端代码”
- 不要把 `git-pull` 解释成“马上生效，无需重启 ST”
- 改 core 后，一定考虑 `managed/core` 和 `.authority-release.json`
- 不要把管理员运行时 artifact 和 installable 发布产物混为一谈
