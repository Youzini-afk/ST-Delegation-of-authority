# Performance Benchmarks

这份文档只讨论两类性能脚本：

- `npm run bench:core`
- `npm run bench:scale`

它们的目标不同，不应该互相替代。

## 1. `bench:core` 的定位

`bench:core` 是当前仓库的 **轻量基线门禁**。

它会拉起临时 `authority-core`，验证：

- SQL query page
- control audit recent page
- control jobs list page
- control events poll page

它的特点是：

- 运行时间短
- 数据集较小
- 适合作为 CI benchmark gate
- 主要防止明显性能回退

当前 CI 只把 `bench:core` 当成硬门禁。

## 2. `bench:scale` 的定位

`bench:scale` 用来补足 **更贴近真实容量和重路径** 的证据。

当前覆盖：

- 大规模 Trivium 数据集
- external ID / mapping 读路径
- mapping integrity 重诊断路径
- mixed load（SQL + audit + jobs + events + Trivium read）
- admin package export / import 吞吐

它的特点是：

- 数据量明显更大
- 运行时间更长
- 默认 **不接入 CI 硬门禁**
- 更适合做本地优化切片、回归对比、PR 证据补充

## 3. 运行前提

`bench:scale` 依赖已构建的：

- `managed/core/<platform>/authority-core`
- `packages/server-plugin/dist/types/*`

最安全的准备方式：

```bash
npm run build
```

如果你同时在做功能和性能改动，更推荐：

```bash
npm run typecheck
npm test
npm run build
npm run bench:core
npm run bench:scale
```

## 4. 默认 profile

`bench:scale` 支持三档 profile：

- `smoke`
  - 适合快速验证脚本可跑通
  - 数据量最小

- `default`
  - 默认档
  - 适合本地性能回归与普通优化对比

- `large`
  - 更重的数据集
  - 适合做容量边界或更强的优化前后对照

默认使用：

- `AUTHORITY_SCALE_PROFILE=default`

示例：

```bash
AUTHORITY_SCALE_PROFILE=smoke npm run bench:scale
AUTHORITY_SCALE_PROFILE=large npm run bench:scale
```

PowerShell 示例：

```powershell
$env:AUTHORITY_SCALE_PROFILE = 'smoke'
npm run bench:scale
$env:AUTHORITY_SCALE_PROFILE = 'large'
npm run bench:scale
```

## 5. 关键环境变量

`bench:scale` 支持按需覆盖数据规模和输出行为。

最常用的有：

- `AUTHORITY_SCALE_PROFILE`
- `AUTHORITY_SCALE_ITERATIONS`
- `AUTHORITY_SCALE_HEAVY_ITERATIONS`
- `AUTHORITY_SCALE_CONCURRENCY`
- `AUTHORITY_SCALE_PAGE_LIMIT`
- `AUTHORITY_SCALE_TRIVIUM_NODES`
- `AUTHORITY_SCALE_TRIVIUM_ORPHANS`
- `AUTHORITY_SCALE_MIXED_SQL_ROWS`
- `AUTHORITY_SCALE_MIXED_JOB_RECORDS`
- `AUTHORITY_SCALE_ADMIN_EXTENSIONS`
- `AUTHORITY_SCALE_ADMIN_SQL_ROWS`
- `AUTHORITY_SCALE_ADMIN_TRIVIUM_NODES`
- `AUTHORITY_SCALE_OPERATION_TIMEOUT_MS`
- `AUTHORITY_SCALE_OUTPUT`
- `AUTHORITY_SCALE_KEEP_TEMP`
- `AUTHORITY_SCALE_MAX_AVG_MS`
- `AUTHORITY_SCALE_MAX_P95_MS`

其中：

- `AUTHORITY_SCALE_OUTPUT`
  - 把完整 JSON report 写到指定路径

- `AUTHORITY_SCALE_KEEP_TEMP`
  - 保留临时 benchmark 工作目录，方便排查导入导出产物或数据库内容

- `AUTHORITY_SCALE_MAX_AVG_MS` / `AUTHORITY_SCALE_MAX_P95_MS`
  - 可选本地门限
  - 默认不启用
  - 主要用于你自己做对比，不代表仓库默认 CI 要求

PowerShell 输出示例：

```powershell
$env:AUTHORITY_SCALE_PROFILE = 'default'
$env:AUTHORITY_SCALE_OUTPUT = 'artifacts/bench-scale-default.json'
npm run bench:scale
```

## 6. 结果怎么读

`bench:scale` 会输出：

- seed 摘要
- 每个 scenario 的 `avg/p50/p95/min/max`
- import/export 的吞吐估算（`MiB/s`）
- 可选 gate 结果

scenario 大致分为四组：

- `trivium`
- `mappings`
- `mixed`
- `admin`

其中要特别注意：

- `trivium.stat.includeMappingIntegrity`
- `trivium.checkMappingsIntegrity`
- `trivium.deleteOrphanMappings.dryRun`

这些是 **重诊断 / 维护路径**。

它们的意义是：

- 给你容量级耗时证据
- 帮你判断告警、审计和后台运维成本

而不是：

- 给用户交互热路径设 SLO

## 7. 推荐使用方式

如果你只是想确认“没有明显退化”：

```bash
npm run bench:core
```

如果你改动了下面这些内容，建议再跑：

```bash
npm run bench:scale
```

适用场景包括：

- Trivium 存储结构或 query/filter/mapping 逻辑
- SQL batch/transaction 行为
- control plane audit/jobs/events 读取路径
- admin package export/import
- 大数据通道或大体量 I/O 改动

## 8. 建议的提交流程

性能相关改动推荐顺序：

```bash
npm run typecheck
npm test
npm run bench:core
npm run bench:scale
npm run sync:installable
npm run check:installable
```

如果只做常规功能改动，`bench:scale` 不是必跑项。

## 9. 当前约束

当前仓库默认约束仍然是：

- `bench:core` 负责 CI benchmark gate
- `bench:scale` 负责扩展证据，不默认阻塞 CI

如果你未来要把某些 scale scenario 升级为门禁，建议单独讨论：

- 具体场景
- profile 固定值
- 平台差异
- 可接受波动范围
- 是否拆成独立 workflow
