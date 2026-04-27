# 管理员 import/export 与诊断归档

本文专门描述 Security Center 管理员运维面板里这组“高层管理能力”：

- `Usage Summary`
- `Portable Package` 导出 / 导入
- import/export operation 持久跟踪、失败恢复与 artifact 下载
- `Diagnostic Bundle` JSON 与 `Diagnostic Archive` 归档

它和普通扩展工作流接口不是一回事。
这组能力是 **管理员专用控制面**，主要面向运维、迁移、备份、排障，而不是给普通 third-party 扩展当常规业务 API 使用。

## 1. 快速事实

- **管理员路由前缀**：`/api/plugins/authority/admin/*`
- **运行时服务入口**：`runtime.adminPackages`
- **高层包默认导出格式**：`.authoritypkg.zip`
- **逻辑包格式**：`authority-portable-package-v1`
- **archive 包装格式**：`authority-portable-package-archive-v2`
- **诊断归档格式**：`authority-diagnostic-bundle-archive-v1`
- **管理员包上传上限**：`256 MiB`
- **导入兼容性**：继续支持旧的单文件 `.json.gz` 包，但会产生 warning
- **operation 状态**：`queued`、`running`、`completed`、`failed`

## 2. Security Center 里的入口

当前管理员在 `Authority Security Center -> Updates` 页能直接执行：

- 查看插件 / SDK / core 当前安装状态
- 查看 `Usage Summary`
- 启动 portable package 导出
- 上传并导入 portable package
- 查看 import/export operation 列表
- 下载完成的 artifact
- 恢复失败 operation
- 下载脱敏 `Diagnostic Bundle` JSON
- 下载 `.json.gz` `Diagnostic Archive`
- 执行 `git-pull` 与 `redeploy-sdk`

因此，这个页面已经不是单纯的“更新页”，而是当前的 **管理员运维面板**。

## 3. Portable Package 的两层格式

## 3.1 逻辑层格式

服务端内部仍然把高层包视为一个逻辑聚合对象：

- `AuthorityPortablePackage`
- `AuthorityPortableExtensionPackage`

它包含：

- 包级 manifest
- 可选 `policies`
- 可选 `usageSummary`
- 每个扩展的：
  - extension metadata
  - persistent grants
  - KV entries
  - blobs
  - private files
  - SQL databases
  - Trivium databases

这层格式的 `format` 仍然是：

- `authority-portable-package-v1`

## 3.2 archive 包装层格式

真正写到磁盘给管理员下载的导出 artifact，现在默认是：

- `.authoritypkg.zip`

其 archive manifest 格式为：

- `authority-portable-package-archive-v2`

archive 至少包含：

```text
manifest.json
policies.json
usage-summary.json
extensions/<index>-<extensionId>/extension.json
extensions/<index>-<extensionId>/grants.json
extensions/<index>-<extensionId>/kv.json
extensions/<index>-<extensionId>/blobs/*
extensions/<index>-<extensionId>/files/*
extensions/<index>-<extensionId>/sql/*
extensions/<index>-<extensionId>/trivium/*
```

其中：

- `manifest.json`
  - 描述 archive 本身的格式、生成时间、逻辑包 manifest
  - 持有所有 entry 的 `path` / `mediaType` / `sizeBytes` / `checksumSha256`
- JSON 元数据文件
  - 保存扩展声明、grants、KV、policies、usage summary
- raw payload 文件
  - 保存 Blob、私有文件、SQL、Trivium 数据库与 Trivium mapping

这样做的目的，是避免把所有大对象重新内嵌回一个超大的 JSON 文档里。

## 3.3 校验与安全约束

archive 读取时会做这些校验：

- `manifest.json` 是否存在
- archive `format` 是否匹配 `authority-portable-package-archive-v2`
- 逻辑层 `packageManifest.format` 是否匹配 `authority-portable-package-v1`
- manifest 中声明的每个 entry 是否真的存在
- entry `sizeBytes` 是否匹配
- entry `checksumSha256` 是否匹配
- 每个引用路径是否都在 manifest 里注册过

也就是说，导入不会盲信 zip 内任意文件名，而是先走 manifest 校验。

## 3.4 legacy 导入兼容

如果导入源不是 zip，而是旧的单文件 `.json.gz` / `.authoritypkg.json.gz`：

- 服务端仍会尝试 gunzip + JSON parse
- 若其逻辑格式仍是 `authority-portable-package-v1`，则允许继续导入
- operation 会附带 warning，提示建议重新导出为新的 `.authoritypkg.zip`

## 4. 导出流程

导出路由：

- `POST /admin/import-export/export`

当前行为：

1. 解析导出请求
2. 解析目标扩展集合
3. 可选读取全局 policies
4. 可选构建 `usageSummary`
5. 逐扩展收集：
   - grants
   - KV
   - Blob
   - private files
   - SQL
   - Trivium
6. 组装逻辑层 portable package
7. 组装 zip archive manifest + raw payload entries
8. 写出 `.authoritypkg.zip` artifact
9. 将 operation 标记为 `completed`

导出本身是异步 operation，不会在路由返回里直接内联整个文件内容。

## 5. 导入流程

导入分两步。

## 5.1 先上传到 transfer staging

上传初始化：

- `POST /admin/import-export/import-transfer/init`

这一步：

- 会创建一个 `fs.private` 类型的 transfer
- `purpose` 为 `privateFileWrite`
- 校验 `sizeBytes > 0`
- 校验包大小不超过 `256 MiB`

浏览器随后通过标准 transfer append 流程把文件分块传完。

## 5.2 再启动高层回放

真正启动导入：

- `POST /admin/import-export/import`

请求至少包含：

- `transferId`
- `mode`
- `fileName`

服务端会：

1. 读取 transfer 对应的 staging 文件
2. 复制到 operation 的工作目录
3. 解析 zip archive 或 legacy `.json.gz`
4. 回放 policies、grants、KV、Blob、private files、SQL、Trivium
5. 记录 `importSummary`
6. 丢弃 transfer staging 文件

## 5.3 `replace` 与 `merge` 的真实语义

`replace` 不是“先删控制面里所有东西”，而是按当前实现做 **受控的扩展级清空 + 再回放**。

### `replace`

如果包里带有 `policies`：

- 会先删除全局 policy document
- 再保存包里的 defaults / extensions / limits

对每个扩展：

- 重置 persistent grants
- 删除该扩展的全部 Blob
- 删除该扩展私有文件目录
- 删除该扩展 KV SQLite
- 删除该扩展 SQL 数据库目录
- 删除该扩展 Trivium 数据库目录
- 然后再回放包里的扩展状态

### `merge`

- 不先清空扩展状态
- 直接把包中内容写回当前扩展命名空间
- 适合做追加式迁移或部分覆盖

当前仍然没有更细粒度的冲突策略；`merge` / `replace` 就是现阶段唯一的高层导入模式。

## 6. Operation 生命周期

operation 通过这些路由暴露：

- `GET /admin/import-export/operations`
- `POST /admin/import-export/operations/:id/resume`
- `POST /admin/import-export/operations/:id/open-download`

每个 operation 至少包含：

- `id`
- `kind`
- `status`
- `progress`
- `summary`
- `error`
- `createdAt` / `updatedAt`
- 导出请求或导入模式
- source 文件名
- artifact 摘要
- import summary
- warnings

## 6.1 状态机

常见状态为：

- `queued`
- `running`
- `completed`
- `failed`

导出完成后，artifact 记录在 operation 上。
导入完成后，会写入 `importSummary` 与 `warnings`。

## 6.2 服务重启后的恢复

如果进程重启时存在 `queued` / `running` operation：

- 启动恢复逻辑会把它们标记成 `failed`
- `error` 会被设成：`operation_recovery_required`
- 需要管理员手动点 `resume`

这意味着当前模型是 **持久状态 + 手动恢复**，而不是后台自动幂等恢复。

## 6.3 当前 warning 来源

当前常见 warning 包括：

- 导入源是 legacy 单文件 `.json.gz`
- extension metadata 里没有可用 `displayName`

warning 不会阻止 operation 成功，但会写回 operation 结果供 UI 展示。

## 7. Artifact 下载

下载导出包或诊断归档时，路由不会直接把文件 body 一次性吐给浏览器。
而是会：

1. 打开 artifact
2. 创建新的 download transfer
3. 返回 `artifact` 摘要 + `transfer` 初始化结果
4. 浏览器通过 transfer `read` 分块拉取

这套机制和大文件 Blob / 私有文件下载复用同一类 DataTransfer 基础设施。

## 8. Diagnostic Bundle 与 Diagnostic Archive

## 8.1 `GET /admin/diagnostic-bundle`

返回一个脱敏 JSON 结构，主要用于直接查看和轻量排障。

它包含：

- `probe`
- `policies`
- `usageSummary`
- `jobs`
- `extensions`
- `releaseMetadata`

## 8.2 `POST /admin/diagnostic-bundle/archive`

这一步会生成一个 `.json.gz` 诊断归档。

当前 archive 内部的文件列表包括：

- `bundle.json`
- `probe.json`
- `policies.json`
- `usage-summary.json`
- `jobs.json`
- `extensions/index.json`
- `extensions/<extensionId>.json`
- `release-metadata.json`（若存在）

需要注意：

- 诊断 archive 目前仍然是 gzip JSON 归档，不是 zip
- 它的目标是排障与快照，而不是做可回放数据迁移

## 9. 它和 installable / 发布产物的关系

portable package artifact 与 diagnostic archive：

- **不是** `runtime/` 产物
- **不是** `managed/sdk-extension/` 产物
- **不是** `managed/core/` 产物
- **不是** `.authority-release.json`

它们属于 **运行时生成的管理员 artifact**，和 installable 发布链路是两套概念。

不要把：

- `.authoritypkg.zip`
- diagnostic `.json.gz`

误认为需要提交进仓库或纳入 installable 同步。

## 10. 当前限制

当前已经支持：

- 统一导出 grants / policies / Blob / private files / SQL / Trivium
- zip archive + raw payload 分片
- legacy `.json.gz` 导入兼容
- operation 持久化与失败恢复

但仍然还没有：

- 更细粒度的导出选择器
- 更细粒度的导入冲突策略
- 流式 zip 生成 / 解析
- 将 diagnostic archive 也升级成 zip 多文件归档

如果你要继续扩展这一块，建议同时对齐：

- `packages/shared-types/src/index.ts`
- `packages/server-plugin/src/services/admin-package-service.ts`
- `packages/server-plugin/src/services/zip-archive.ts`
- `packages/server-plugin/src/routes.ts`
- `packages/sdk-extension/src/security-center.ts`
- `docs/server/http-api.md`
- 本文
