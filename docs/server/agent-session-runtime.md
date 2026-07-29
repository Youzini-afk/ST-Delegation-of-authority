# Authority Agent 持久会话运行时

本文定义 Authority Agent 当前持久会话运行时的领域边界、持久化不变量与恢复语义。系统以 Session 为产品实体，不再提供“一项任务对应一份完整 Run JSON”的公共模型，同时保留权限、审批、工具和工作区版本树能力。

## 1. 领域边界

```text
Agent Session（用户持续交互的主实体）
├─ Conversation tree：用户、助手、工具结果、压缩与分支摘要
├─ Execution journal：Run、Step、Generation、工具、审批和恢复事实
└─ Workspace history：文件检查点、diff、版本与回退
```

- **Session** 是长期存在的对话、所有权与工作区边界。
- **Run** 是一次已接受输入到 Agent 再次空闲之间的执行过程。它属于 Session，不是独立聊天。
- **Step** 是一次模型生成及随后处理的工具批次。
- **Generation** 是 Step 内的一次 provider 请求；重试产生新的 Generation。
- **Invocation** 是一次工具调用及其副作用边界。
- **Workspace checkpoint** 是工作区版本树提交，不等同于执行循环的安全边界。

Session 是产品 UI 和插件 SDK 的主要对象。Run、Step 与 Generation 主要用于恢复、诊断和审计，不应重新变成左侧的一次性任务列表。

## 2. 两类事实

同一会话日志保存两类互相关联但职责不同的事实：

1. **对话事实**定义模型和用户说过什么。
   - 对话 entry 带 `parentId`，组成树。
   - ref 的活动 leaf 决定当前分支。
   - reroll、历史编辑和分支不会复制旧 Run，也不会改写已有 entry。

2. **执行事实**定义运行时做过什么。
   - Run、Step、Generation、队列、审批和工具记录按日志顺序还原。
   - 执行事实没有对话父指针，也不能改变对话树拓扑。
   - 工具结果进入模型上下文时，另有一个关联 Invocation 的对话 entry。

这条边界防止“执行重试改变历史对话”以及“把多轮会话拼接成多份 Run 文件”。

## 3. 持久化格式

每个 Session 位于：

```text
<agent-state>/sessions/<session-id>/
  journal.jsonl
  writer.lock
```

`journal.jsonl` 是唯一事实源。每条记录包含：

- 会话 ID；
- 单调、连续的 sequence；
- 上一条记录的 SHA-256；
- 带稳定 ID 和时间戳的 typed entry；
- 当前记录的 SHA-256。

hash 使用递归排序键名的 canonical JSON 计算。完整记录损坏、乱序、断链或语义不合法时拒绝打开；只允许忽略最后一条不完整写入形成的 torn tail。

写入规则：

1. 在内存副本上验证下一条记录及其状态转换；
2. 追加一整行；
3. `fsync` 日志；
4. 只有成功后才发布新的内存投影。

若写入或 `fsync` 结果不确定，当前 writer 立即 fault，不允许继续产生效果。重新打开时：

- 完整且 hash 正确的更长前缀被保留；
- 最后一条无换行但完整、hash 正确的记录被封口；
- 不完整尾部截断到最后一个有效记录边界。

稳定 entry ID 提供幂等重试：相同 ID 和相同内容返回原记录；相同 ID 的不同内容被拒绝。

## 4. 单写者

每个 Session 同时只允许一个 writer：

- `writer.lock` 使用独占创建；
- 记录 token、PID、hostname 和创建时间；
- 每次追加前重新核对 token；
- 只有同一主机且能够确认 PID 已死亡时才自动回收有效锁；
- 其他主机持有的锁绝不按时间强夺；
- 损坏或旧格式锁只能在超过保守时限后回收。

会话级单写者保证执行因果顺序。不同 Session 可以并行运行；修改同一工作区时仍必须经过 `WorkspaceHistoryService` 的跨进程工作区锁。

运行时按职责拆分，避免把产品命令、模型循环和副作用恢复重新揉成一个任务服务：

- Runtime coordinator 持有 Session actor、调度、公平并发、计时器和生命周期门闩。
- Run executor 只驱动 Generation、工具批次、steer 与 follow-up 边界。
- Tool executor 是唯一可跨越外部副作用边界的组件；它必须先看到 durable intent，并在同一 actor 内再次确认 Run 所有权。
- Recovery service 只核对已落盘事实并保守收束，不自动重发模型请求或工具调用。
- Journal service 集中可复用的审批、取消和工具结果协议；它不打开 writer，也不调度工作。

## 5. 有效前缀与外部副作用

任意已落盘前缀都必须可解释。对外部效果采用“意图先于效果、结果后于效果”：

```text
tool.requested
approval.requested / approval.resolved（如需要）
workspace.checkpointed(before)（工作区变更时）
tool.started
<执行外部效果>
workspace.checkpointed(after|failure)
tool.finished
conversation.message(role=tool)
```

进程可能在任意两项之间退出。恢复器按已有证据裁决：

- 仅有 requested、尚未 started：没有开始工具副作用；当前恢复策略会取消该 Invocation、暂停 Run，并要求显式恢复，不自动重放。
- started 后缺少 finished：不得假定失败，也不得盲目重试。
- browser/module/终端或其他不可证明幂等的调用：标为 `outcome_unknown` 并暂停。
- 工作区变更：结合 before/after/failure commit 与当前 workspace head 核对。
- pending approval：保持待审批，不因重启自动批准、拒绝或取消。

Session 不因当前 Run 中断而成为终态。当前 Run 可以 suspended，用户仍能查看完整对话、变更和恢复选项。

## 6. 输入队列

Agent 活动期间的新输入分为：

- `steer`：在下一个安全边界调整当前 Run；
- `follow_up`：当前 Run 原本将停止时继续处理；
- `next_run`：保留到下一次独立 Run。

队列内容先作为执行事实落盘。只有真正被模型消费时，才追加到当前 leaf 成为对话 entry；该 entry 同时引用并移除 queue ID。这样排队期间的分支移动或其他消息不会让队列提前占据错误的 parent。

## 7. 上下文与压缩

模型上下文从活动 ref 的 leaf 沿 `parentId` 回溯构建，不从历史 Run 文件拼接。

压缩是新的对话 entry，不删除或覆写原始历史。它记录摘要、保留边界和保留 entry；上下文投影使用最新压缩加保留尾部，审计与分支仍可读取完整日志。

## 8. 快照与实时事件

UI 读取的是日志投影，不直接解释持久格式。打开会话时服务端应提供一个原子快照，再发送后续实时事件：

```text
snapshot(lastSequence)
event(lastSequence + 1)
event(lastSequence + 2)
...
```

断线重连重新获取快照。SSE/连接只负责交付，不是事实源；断开 UI 不取消 Session 或 Run。

工作台结构：

- 左侧：Session 列表；
- 中间：持续时间线与固定输入框；
- 右侧：上下文、工具、审批、文件变更、版本和恢复；
- Run/Step/Generation 只在运行状态和诊断详情中出现。

## 9. 与现有 Authority 能力的关系

必须保留：

- 用户、extension、Authority session 与 workspace ACL；
- `agent.run:<workspaceId>` 授权；
- plan / ask / auto 工具策略；
- browser tool claim 和晚到结果裁决；
- module transaction 的权限、审计、超时与幂等合同；
- 变异前后 workspace checkpoint；
- content-addressed 工作区历史、回退 journal 和独立 rescue CLI；
- 并发、公平调度、频率和资源上限。

新的会话日志负责执行事实的持久与恢复，不替代工作区版本树，也不把网络、module 或 browser 副作用伪装成可由文件回退撤销。

## 10. 实现映射

- `AgentSessionStoreService`：日志、hash 链、单写者、损坏检测和投影加载。
- `AgentSessionRuntimeService`：Session actor、命令入口、调度、公平并发和生命周期。
- `AgentSessionRunExecutor`：Generation、工具批次、steer 与 follow-up 安全边界。
- `AgentSessionToolExecutor`：durable intent 之后的唯一外部副作用入口。
- `AgentSessionJournalService`：审批、取消、工具结果和通用日志协议。
- `AgentSessionRecoveryService`：重启后根据持久事实保守收束，不自动重发模型或工具调用。

公开 API、SDK 与工作台只消费 Session 快照和事件。历史 `agent/runs/*.json` 不属于当前事实源，运行时不会读取、迁移或删除它们，也不会为其保留旧公共 API。
