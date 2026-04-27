# 能力矩阵、权限模型与数据隔离

本文专门回答几个最重要的问题：

- Authority 服务端到底提供了哪些能力？
- 每个能力的权限资源是什么？
- target 是怎么定义的？
- 数据按什么维度隔离？
- 哪些路径是稳定的、哪些不应该依赖？

## 1. 当前支持的权限资源

当前服务端公开支持这些资源：

- `storage.kv`
- `storage.blob`
- `fs.private`
- `sql.private`
- `trivium.private`
- `http.fetch`
- `jobs.background`
- `events.stream`

## 2. 风险等级与默认策略

| 资源 | 风险等级 | 默认策略 |
| --- | --- | --- |
| `storage.kv` | `low` | `prompt` |
| `storage.blob` | `low` | `prompt` |
| `fs.private` | `medium` | `prompt` |
| `sql.private` | `medium` | `prompt` |
| `trivium.private` | `high` | `prompt` |
| `http.fetch` | `medium` | `prompt` |
| `jobs.background` | `medium` | `prompt` |
| `events.stream` | `low` | `prompt` |

## 3. 权限判定顺序

权限决策链为：

```text
扩展级 / 全局管理员策略
  > 持久化 grant
  > 当前 session grant
  > 默认策略
```

如果最终结果不是 `granted`，`authorize(...)` 不会放行。

## 4. 用户选择如何落地

当前 `resolve` 支持：

- `allow-once`
- `allow-session`
- `allow-always`
- `deny`

落地规则：

- **`allow-once`**
  - session grant
  - `remainingUses = 1`

- **`allow-session`**
  - session grant

- **`allow-always`**
  - persistent grant

- **`deny`**
  - persistent grant
  - 状态为 `denied`

## 5. 数据隔离维度

Authority 当前至少按这些维度隔离数据：

- **SillyTavern 用户**
- **扩展 ID**
- **资源 target**（部分能力）
- **数据库名**（SQL / Trivium）
- **channel**（events）
- **hostname**（HTTP fetch）
- **job type**（jobs）

## 6. 路径布局

## 6.1 每用户 Authority 数据根

每个用户的数据根来自：

```text
<user.rootDir>/extensions-data/authority
```

基于它再拆出：

- `state/`
- `storage/`
- `sql/`

## 6.2 控制面路径

每用户控制面数据库：

```text
<user.rootDir>/extensions-data/authority/state/control.sqlite
```

这个库承载：

- session snapshot
- 扩展注册信息
- grants
- audit
- jobs
- events
- 运行诊断线索（warning / error 审计）
- 以及其他控制面记录

## 6.3 全局管理员策略路径

全局管理员策略不放在用户目录里，而是：

```text
<DATA_ROOT>/_authority-global/authority/state/control.sqlite
```

这意味着：

- 管理员策略是全局控制面数据
- 它和每个用户自己的控制面状态是分开的

## 7. 各能力的隔离与落盘模型

## 7.1 KV：`storage.kv`

KV 的底层是每扩展一个 sqlite 文件：

```text
<user.rootDir>/extensions-data/authority/storage/kv/<sanitized-extension-id>.sqlite
```

特点：

- 不按 target 再细分
- 一个扩展在一个用户下共享自己的 KV 库
- 不会和其他扩展共用同一个 KV sqlite

## 7.2 Blob：`storage.blob`

Blob 能力使用：

- 每用户控制面 DB 记录 blob metadata
- `storage/blobs` 作为 blob 根目录
- 结合 `userHandle + extensionId + blobDir` 调 core

对开发者来说，应理解为：

- Blob 是按用户和扩展隔离的
- 不应该假设某个跨扩展共享目录结构是稳定 API
- 正确入口是 blob 路由，而不是自己拼路径读文件

## 7.3 私有文件：`fs.private`

私有文件根目录：

```text
<user.rootDir>/extensions-data/authority/storage/files/<sanitized-extension-id>
```

特点：

- 每扩展独立 root
- 接口使用虚拟路径
- 不能越出 root
- symlink 被禁止
- 适合存放扩展自己的文本、配置、结构化文件等

## 7.4 SQL：`sql.private`

SQL 数据库路径：

```text
<user.rootDir>/extensions-data/authority/sql/private/<sanitized-extension-id>/<sanitized-database-name>.sqlite
```

特点：

- 用户隔离
- 扩展隔离
- 数据库名隔离
- target 就是数据库名

数据库名默认值：

```text
default
```

## 7.5 Trivium：`trivium.private`

Trivium 数据库路径：

```text
<user.rootDir>/extensions-data/authority/storage/trivium/private/<sanitized-extension-id>/<sanitized-database-name>.tdb
```

特点：

- 用户隔离
- 扩展隔离
- 数据库名隔离
- target 就是数据库名
- Trivium 本身支持向量、图边、文本索引和混合检索

重要边界：

- Authority **不生成 embedding**
- 调用方必须自己提供 `vector`
- 不应让两个不同运行时直接并发读写同一个 `.tdb`

## 7.6 HTTP：`http.fetch`

target 为：

```text
hostname
```

例如：

```text
https://api.openai.com/v1/embeddings
=> api.openai.com
```

这意味着权限是按主机名授予的，而不是按完整 URL。

## 7.7 Jobs：`jobs.background`

target 为：

```text
job.type
```

当前内置 job type 包括：

- `delay`
- `sql.backup`
- `trivium.flush`
- `fs.import-jsonl`

这很关键：

- 现在不是一个“通用执行任意后台函数”的平台
- 若未来扩展 job type，需要同时更新权限和服务端执行逻辑

当前几个内置任务的落盘/隔离语义分别是：

- `delay`
  - 只更新控制面 jobs / events / audit

- `sql.backup`
  - 读取当前扩展私有 SQL 数据库
  - 备份文件写到同扩展数据库目录下的 `__backup__`

- `trivium.flush`
  - 作用于当前扩展私有 Trivium `.tdb`
  - 不跨扩展共享数据库

- `fs.import-jsonl`
  - 从当前扩展 blob 读取 JSONL 源
  - 校验后写入当前扩展私有文件根目录

## 7.8 Events：`events.stream`

target 为：

```text
channel
```

默认 channel：

```text
extension:<extensionId>
```

因此：

- 事件订阅是按 channel 控制的
- 权限也是按 channel 细分的

## 7.9 limits 与 transfer 模型

这里有一个很容易被误解的点：

- `storage.blob`、`fs.private`、`http.fetch` 是 **权限资源**
- `storage.blob`、`fs.private`、`http.fetch` 也可能经过 `transfers/*` 这套 **运输层**
- 但 `transfers/*` 本身不是新的公开权限资源，只是大对象路径的 transport strategy

当前对外暴露的 limits 需要按三层理解：

- **core hard ceiling**
  - 由 `authority-core` 编译时常量决定
  - 主要通过 `core.health.limits` 暴露诊断

- **adapter transfer ceiling**
  - 由 Node adapter / `DataTransferService` 控制
  - 现在按操作拆成 `storageBlob*`、`privateFile*`、`httpFetch*`
  - 通过 `probe.limits.effectiveTransferMaxBytes` 与 `session.limits.effectiveTransferMaxBytes` 暴露

- **effective inline threshold**
  - 决定结果是 inline 还是 transfer
  - 通过 `probe.limits.effectiveInlineThresholdBytes` 与 `session.limits.effectiveInlineThresholdBytes` 暴露
  - 当前 source 可能为 `runtime` 或 `policy`

当前 limits policy surface 的真实边界是：

- inline threshold 可被 extension-scoped policy 下压
- transfer ceiling 仍然是 runtime-only
- 公开兼容字段 `maxDataTransferBytes` 仍保留，但它只是 generic compatibility max，不再代表每个操作都共享同一 ceiling

## 8. 私有文件安全边界

`fs.private` 这部分最需要写清楚，因为它最容易被误用。

当前实现包含这些安全约束：

- 虚拟路径会被标准化
- 根目录以外路径不可达
- `..` 路径穿越会被拒绝
- root 自身若是 symlink 会被拒绝
- 中间路径若是 symlink 会被拒绝
- 读取目录存在数量上限

因此：

- 不要把它当作宿主机任意文件访问能力
- 它是“扩展私有沙盒目录”能力

## 9. Trivium 的真实能力边界

Trivium 在当前服务端里提供的是：

- 向量写入
- payload 更新
- 图边 link/unlink
- neighbors
- vector search
- advanced search
- hybrid search
- text/keyword index
- stat / flush / query / filter

但不提供：

- embedding 生成
- 外部模型管理
- 自动记忆抽取
- prompt 注入

所以它是：

```text
数据库 + 检索引擎
```

而不是：

```text
完整记忆系统
```

## 10. 适合给 AI 的“能力理解方式”

如果你是编程 AI，建议按下面方式理解当前资源：

- **`storage.kv`**
  - 小型结构化配置 / 状态

- **`storage.blob`**
  - 二进制 / 大文本对象

- **`fs.private`**
  - 目录化私有文件工作区

- **`sql.private`**
  - 表结构明确、需要查询/事务/迁移的关系数据

- **`trivium.private`**
  - 向量 + 图关系 + 文本索引型检索数据

- **`http.fetch`**
  - 受 hostname 治理的外部网络调用

- **`jobs.background`**
  - 当前仅限受支持的内置后台任务类型

- **`events.stream`**
  - SSE 消费通道，不是任意 publish API

## 11. 常见误区

- **误区：`fs.private` 等于任意文件系统访问**
  - 错。它只在扩展私有 root 内工作。

- **误区：`trivium.private` 会帮我做 embedding**
  - 错。必须自己提供向量。

- **误区：SQL/Trivium 默认数据库能跨扩展共享**
  - 错。即使都叫 `default`，也按扩展 ID 隔离。

- **误区：管理员策略只影响 UI 提示**
  - 错。管理员策略会直接改变服务端授权结果。

- **误区：事件流等价于内存事件总线**
  - 错。当前公开层是 DB-backed 轮询桥接的 SSE 消费接口。
