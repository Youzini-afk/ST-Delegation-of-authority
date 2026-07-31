# Authority Agent 平台

Authority Agent 把 DOA 建设为 SillyTavern 内的通用 Agent Runtime、IDE 工作台与插件 Agent SDK。内置工作台默认以整个 SillyTavern 为作用域，插件启动时自动注册这一恢复边界；插件 Agent SDK 仍可显式使用其他已授权工作区。BME 等领域插件继续拥有自己的数据与语义，DOA 负责持续会话、模型循环、工具编排、权限和恢复。

## 产品模型

Agent 的主实体是持久 **Session**，不是一次性任务卡片：

```text
Session
├─ 持续对话与活动分支
├─ Run：一条输入到 Agent 再次空闲的一次执行
│  ├─ Step：一次模型生成及其工具批次
│  │  └─ Generation：一次 provider 请求
│  └─ Invocation / Approval：工具与审批事实
└─ Workspace history：检查点、diff、回退和恢复
```

- 用户在同一 Session 中持续交流，不需要为每次追问新建任务。
- Run、Step、Generation 是 Session 内的执行、恢复与诊断记录，不是左栏导航对象。
- Agent 忙碌时，新输入按 `steer`、`follow_up` 或下一轮执行排队；断开页面不会取消运行。
- `plan`、`ask`、`auto` 控制自主程度，不改变 Session 的持久化模型。

## 运行架构

```text
Security Center / third-party extension
  -> AuthorityClient.agent.sessions.*
  -> Node routes + Authority caller context
  -> AgentSessionRuntimeService
       -> AgentSessionStoreService       journal + projection + writer lock
       -> AgentSessionRunExecutor         model loop + input queue
       -> AgentSessionToolExecutor        durable side-effect boundary
       -> AgentSessionRecoveryService     conservative restart recovery
       -> AgentToolRegistryService        host / module / browser tools
       -> WorkspaceHistoryService         checkpoint / diff / rollback
```

模型调用采用 OpenAI-compatible Chat Completions tool-call 协议。LLM profile 由管理员配置并保存在服务端；API key 不返回前端，只暴露已配置状态、mask 和 fingerprint。每个 profile 还必须声明模型的上下文窗口与最大输出 tokens，运行时据此管理长会话。远程 endpoint 必须使用 HTTPS，本机回环地址可以使用 HTTP。

DOA 不限制一次 Run 的总步数、工具调用次数或总运行时长，也不因活跃 Run 数量拒绝已经授权的会话。调度器仍以有限执行槽公平推进不同用户的 Run；这是吞吐调度，不是任务配额，排队不会改变或截断任务。

## Session 日志与恢复

每个 Session 的唯一事实源是：

```text
<DATA_ROOT>/_authority-global/authority/state/agent/sessions/<session-id>/
  journal.jsonl
  journal.000001.jsonl
  journal.000002.jsonl
  ...
  writer.lock
```

日志是带连续 sequence 和 SHA-256 前向链的 append-only JSONL。`journal.jsonl` 达到轮转目标后继续写入编号 segment，不设置 Session 总大小上限；hash chain 跨 segment 连续。写入先在内存副本验证，再追加、`fsync`，最后发布新投影；同一 Session 只允许一个持有可核验 token 的 writer。完整损坏、乱序、segment 缺口或断链会拒绝打开，仅最后一个 segment 的最后一条未写完整记录可被安全截断。

工具副作用遵守“意图先落盘、效果随后发生、结果最后落盘”。重启时恢复器只根据已有事实裁决：

- 尚未开始的工具不会被自动重放；
- 已开始但没有结果的外部调用不会被假定失败；
- browser、module、终端等无法证明幂等的调用会标为 `outcome_unknown` 并暂停；
- pending approval 保持待审批；
- 工作区变更结合前后检查点与当前 head 核对。

Session 不因一次 Run 被暂停而终结。用户仍可查看会话、审批、工具活动、工作区差异并显式恢复。

完整日志格式、队列和有效前缀规则见 [Agent 持久会话运行时](agent-session-runtime.md)。

## 工具模型

工具统一使用 `AgentToolDescriptor`：稳定 ID、说明、JSON Schema、执行位置、风险等级、审批策略以及是否改变工作区。

- `host`：文件、搜索、补丁、终端、进程、Git、ST 状态和版本树工具。
- `module`：直接映射既有 `ModuleHostService.execute()`，继续复用 session、权限、超时、审计和幂等合同。
- `browser`：由前端插件按 session/browser instance 注册，服务端持久化 invocation，浏览器认领后回传结果。

第一批 host 工具保持 IDE 原语：列目录、读文件、文本搜索、原子写入、精确替换、终端、状态、历史和 diff。模型只看到 workspace ID 与相对路径；文件工具不跟随 symlink。DOA 不截断文件、搜索结果或写入内容；终端超长输出会完整保存为 Session 所属 artifact，并通过 `host_read_artifact` 按需读取，模型上下文只携带预览和可恢复引用。

浏览器注册采用短租约。工具描述变化会产生新的 registration ID；调用先持久化，再由同一用户、扩展和 browser instance 以稳定 claim ID 认领并回传。同一 claim 重试幂等，其他 claim 不能重复执行。SSE 只负责通知，invocation、结果与终态以 Session 日志和 HTTP 快照为准。

## 权限与审批

Agent 不绕过 Authority 的既有身份链：

```text
ST user -> Authority session -> extension -> declared permission
        -> workspace ACL / target authorization -> tool policy
```

- 创建或继续 Session 要求 `agent.run:<workspaceId>`。
- browser 工具要求独立的 `agent.browser:<browserInstanceId>`。
- 所有 `/admin/agent/*` 同时要求有效 Authority session 和当前 ST 用户的 admin 身份；审计记录实际调用扩展。
- `plan` 只暴露 DOA 能确认无副作用的只读 host 工具。
- `ask` 在策略要求的副作用前持久化审批并暂停。
- `auto` 可执行普通工作区写入，但写入仍强制建立检查点。
- 终端与高风险 module/browser 工具始终单独审批；网络等外部副作用不能伪装成可由文件版本树撤销。

前端 extension ID 是同一 ST 页面内的归属与治理标识，不是抵抗恶意同源脚本的密码学身份。真正的服务端边界是已认证用户、Authority session、工作区 ACL 和服务端策略。

## 工作区版本树

Authority 使用自己的内容寻址对象库，不接管或修改用户已有 Git：

```text
objects/<sha256>       blob 与 canonical tree
commits/<sha256>.json  commit
refs/<name>.json       带 generation 的 head
workspaces.json        工作区注册表与 ACL
```

每次写工具和可能修改文件的终端命令都在同一个跨进程工作区锁内执行“变更前检查点、工具、变更后或失败检查点”。另一个 Agent 或独立恢复器不能插入这个边界。

检查点默认可以是稀疏的，只跟踪即将修改的路径；`.git`、`node_modules` 与版本树自身始终排除。普通回退会拒绝覆盖已经偏离预期 head 的文件，只有显式 `force` 才允许强制恢复。回退使用持久 journal 和稳定 `operationId`，中断后可继续，并以新 commit 保留完整历史。

## SDK 与实时事件

插件通过 `client.agent.sessions.*` 使用 Session：

- `create`、`listPage`、`get`、`update`；
- `send`，以及 `cancelRun`、`resumeRun`、`waitForRun`；
- `subscribe` 获取“权威快照 + 后续事件”。

Agent Session SSE 先使用 Authority session header 换取 30 秒、单次使用且绑定用户/扩展/Session 的 ticket，URL 不携带长期 session token。重连重新申请 ticket 并先接收最新快照，因此事件流不是事实源，也不要求客户端自行补日志缺口。

`client.agent.browser.*` 提供浏览器工具注册、claim 和结果回传。管理员 API 另外提供 profile、全局 Session 审查、审批和工作区历史治理，但不提供绕过 `agent.run` 权限的新建入口。

## Agent 工作台

Security Center 的 Agent 页直接复用公共 Session SDK，不维护第二套执行协议：

- 左侧是可分页的持久 Session 列表和新会话入口；
- 中间是连续时间线、恢复提示与固定输入框；
- 右侧只呈现当前 Session 的任务、审批、执行轨迹、变更和版本检查点；
- 执行策略位于输入区，模型连接集中在全局设置页；工作区注册、工具目录和服务端路径不暴露给内置工作台用户；
- Run / Step / Generation 只在活动状态与诊断详情中出现。

工作台以 `third-party/st-authority-sdk` 的 Authority session 工作。默认作用域虽然由服务端自动注册，创建和继续会话仍经过工作区 ACL 与 `agent.run:<workspaceId>` 授权，不会因隐藏配置界面而绕过安全边界。

## 独立恢复

`runtime/agent.cjs` 与插件同仓库、同安装包发布，但不启动 SillyTavern，也不导入主插件入口。ST 或插件启动失败时可直接运行：

```bash
node plugins/authority/runtime/agent.cjs rescue status
node plugins/authority/runtime/agent.cjs rescue workspaces
node plugins/authority/runtime/agent.cjs rescue log
node plugins/authority/runtime/agent.cjs rescue diff <from> <to>
node plugins/authority/runtime/agent.cjs rescue checkpoint [paths...]
node plugins/authority/runtime/agent.cjs rescue rollback <commit> --operation-id <stable-id>
node plugins/authority/runtime/agent.cjs rescue resume
```

恢复数据位于 `<DATA_ROOT>/_authority-global/authority/state/agent-workspaces`，不会随插件更新或 installable 同步删除。开发模式的插件根由 `npm run dev:link` 直接链接，CLI 入口相应为 `plugins/authority/agent.cjs`；脱离 ST 根目录运行时传 `--data-root <path>` 或 `--store <path>`。

## 数据与升级边界

- LLM profile 继续使用 `agent/profiles.json`，以便管理员现有模型配置正常保留。
- 当前运行时读取 `agent/sessions/*/journal.jsonl` 及其连续编号 segments；旧 run-first 的 `agent/runs/*.json` 不读取、不迁移，也不主动删除。
- 工作区版本树独立位于 `state/agent-workspaces`，不属于 Session 日志，升级时不得覆盖。
- profile 和 Agent 状态目录包含密钥及敏感对话；POSIX 权限会收紧，Windows 依赖 ST data 目录的本机账户 ACL，备份应按密钥材料保护。

## 不变量

1. Agent 子系统初始化失败不能阻止 ST 启动；路由先注册，后台启动不阻塞插件初始化。
2. 模型只能通过已注册工具与结构化参数产生动作，不能直接调用任意内部函数。
3. 任何外部副作用前必须已有 durable intent；结果不明时禁止自动重试。
4. Session 日志和工作区版本树各司其职；文件回退不能撤销网络、module 或 browser 副作用。
5. 普通扩展不能绕过用户、Authority session、声明权限、工作区 ACL 和管理员策略。
6. API key 不返回前端；本地状态目录与备份属于密钥信任边界。
7. 文件工具不跟随 symlink 越出工作区；增加其他根目录必须由管理员重新授权。
8. 工作区 ACL 撤销会阻止新的执行；已开始的 Run 继续到安全边界，管理员可显式取消。
9. 历史文件可留置，但不得为旧 run-first 公共 API 重建兼容双栈。
