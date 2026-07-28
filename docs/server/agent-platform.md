# Authority Agent 平台

Authority Agent 的目标是把 DOA 建设为 SillyTavern 的通用 Agent Runtime、IDE 与插件 Agent SDK。它面向整个 ST 工作区提供代码、文件、终端、进程、配置、插件和浏览器工具，而不是只提供一组预定义修复动作。

## 产品边界

- Agent 能在用户授权的 ST 工作区内完成 IDE 级操作，包括修改源码、配置、插件与用户数据，运行命令、测试和构建，并观察结果。
- 现有 Authority Module transaction 直接作为服务端 Agent tool；不再建立第二套服务端工具注册协议。
- 前端插件可注册浏览器工具、发起 Agent Run、提供上下文并订阅结果。BME 等领域插件继续拥有自己的数据与语义，DOA 负责任务循环和工具编排。
- 安全模型不以削弱工具能力为目标。用户通过 `plan`、`ask`、`auto` 三种执行模式控制自主程度；DOA 文件工具造成的变化进入版本树，终端执行前对工作区建立检查点。`.git`、`node_modules` 与工作区外副作用不在回退范围内，必须明确提示并审批。

## 分层

```text
Security Center / Agent IDE / third-party extensions
  -> AuthorityClient.agent.*
  -> Node server-plugin AgentService
       -> OpenAI-compatible LLM loop
       -> host workspace tools
       -> ModuleHostService transactions
       -> browser tool rendezvous
       -> WorkspaceHistoryService
  -> content-addressed workspace history
```

正常运行时 AgentService 属于 Node server-plugin。独立恢复入口作为第二个构建产物 `runtime/agent.cjs` 与 DOA 同仓库、同安装包、同版本发布；它不启动 SillyTavern，也不导入主插件入口。

## Agent Run

每次任务形成一个持久 Run。Run 保存目标、调用方用户与扩展、工作区、模型 profile、执行模式、工具白名单、步骤事件、工具调用、审批和当前版本树 head。

状态机：

```text
queued -> running
  -> waiting_approval -> running
  -> waiting_browser_tool -> running | interrupted
  -> completed | failed | cancelled | interrupted
```

ST 或 DOA 重启后，仍处于执行状态的 Run 标记为 `interrupted`。浏览器或 module 工具已开始执行、但因取消、超时或重启无法确认结果时，invocation 标记为 `outcome_unknown`，Run 同样中断，不允许模型自动重试。只读步骤可以重新发起；包含修改或未知外部副作用的任务必须先核对版本树和调用结果，不能盲目续跑。

Run、消息、事件、工具调用和审批分别按 Run 原子落盘到 `<DATA_ROOT>/_authority-global/authority/state/agent/runs`。列表只读取启动时建立并随写入更新的内存摘要索引，并按 `(createdAt, id)` 稳定 cursor 分页返回；旧列表入口也只返回首个有界页面，不会在每次打开历史时重读或一次返回所有完整对话。终态 Run 自动保留最近 1000 条且总文件大小不超过 512 MiB，管理员也可主动缩减；仍在退出执行栈的 Run、进行中的 Run 与工作区 commit/object/ref 历史都不参与当次清理。

OpenAI-compatible LLM profile 保存在同一状态目录；API key 因服务端重启后仍需发起请求而持久化，但不做应用层加密：POSIX 下目录/文件收紧为 `0700/0600`，Windows 依赖 ST data 目录继承的本机账户 ACL，备份也必须按密钥材料保护。它不返回客户端，面向客户端的 profile 只包含是否已配置、mask 和 fingerprint。远程 profile 只允许 HTTPS，本机回环地址可使用 HTTP；更换 origin 时必须同时明确更换或清除 key。模型调用使用非流式 Chat Completions tool-call 协议，请求体、assistant 内容、工具参数、usage 元数据和单 Run 持久文件均有硬上限。单次 Run 还有明确步数上限，DOA 同时执行数与单用户启动频率也有固定上限；默认并发大于一时，单用户不能占满所有全局执行槽。

## 工具模型

工具统一为 `AgentToolDescriptor`：稳定 ID、自然语言说明、JSON Schema、执行位置、风险等级、审批策略和是否改变工作区。

- `host`：DOA 内建的文件、搜索、补丁、终端、进程、Git、ST 状态和版本树工具。
- `module`：映射到现有 `ModuleHostService.execute()`；继续使用 session、权限、超时、审计和幂等合同。
- `browser`：由前端插件按 session/browser instance 注册，服务端创建持久 invocation，浏览器认领后回传结果。

SSE 只负责通知。浏览器调用、结果和终态必须持久保存，并可由 HTTP 查询恢复，不能把 SSE 连接本身当作事实源。

插件经 Authority session 使用 `/agent/*`：列出本调用用户与扩展可用的工具、创建和查询该用户与扩展的 Run、取消自己的 Run，以及注册、领取、回传浏览器工具。`agent.run` 与 `agent.browser` 是彼此独立、默认 `prompt` 的高风险权限：创建 Run 必须显式给出已登记且当前用户在 ACL 内的工作区 ID，再按该工作区授权；浏览器注册按 browser instance 授权，不会获得工作区通配权限。

浏览器注册是短租约能力，前端存活时续租；工具描述变化会产生新的 registration ID，旧 Run 不能借审批执行被替换后的描述。模型发起浏览器工具后，服务端先持久化 invocation，再由相同用户、扩展和 browser instance 通过带稳定 claim ID 的 HTTP claim 认领，最后凭同一 claim 回传结果。重复 claim 对同一 claim ID 幂等，不同 claim 不能重复执行；claim secret 不出现在普通扩展的 Run detail 中。超时、取消或晚到结果按持久 invocation 状态裁决，断开的 SSE 不影响正确性。

管理员经 `/admin/agent/*` 管理 LLM profile、分页查看全部 Run、处理审批和清理旧终态记录，并使用 `/admin/agent/workspaces/*` 管理工作区 ACL、检查点、diff 与回退。审批记录持久化处理管理员身份；profile 响应永远只返回是否已配置、mask 与 fingerprint，不返回 API key 明文。

前端 extension ID 是同一 ST 页面内的归属与治理标识，不是抵抗恶意同源脚本的密码学身份。所有前端插件共享页面 origin；安装恶意前端插件等价于授予它页面级能力。真正的服务端隔离边界是已认证用户、工作区 ACL、Authority session 与服务端策略。若将来需要抵抗同源插件互相冒充，必须由 ST loader 提供隔离执行环境或不可伪造的扩展凭据，SDK 缓存本身不能提供这种保证。

第一批 host 工具保持为 IDE 原语：列目录、读文件、文本搜索、原子写文件、精确文本替换、工作区终端、状态、历史和 diff。模型只看到 workspace ID 与相对路径，不接收服务器物理根路径。文件工具不跟随 symlink，读取、搜索和命令输出都有上限；终端只继承运行所需的最小环境变量集，不继承服务端密钥。`plan` 只暴露 DOA 能确认无副作用的 host 检查工具，不执行 module/browser 工具；`ask` 按工具策略持久化审批并暂停；`auto` 可直接执行普通工作区写入。高风险 module/browser 工具仍始终审批，终端也始终单独审批并为整个工作区（排除 `.git`、`node_modules`）建立检查点。

## Agent 工作台

Security Center 的管理员 `Agent` 页是平台自带 IDE 入口，复用 `AuthorityClient.agent.*`，不拥有第二套执行协议。它提供：

- 新建 `plan` / `ask` / `auto` Run，选择工作区、LLM profile 与最大步骤；
- 查看持久消息、事件、工具调用和最终结果，并对活动 Run 轻量轮询；
- 批准或拒绝等待中的高风险工具、取消 Run；
- 注册工作区 ACL、查看 dirty 状态与最近提交 diff、建立检查点、回退或恢复中断的回退；
- 管理只显示 mask/fingerprint 的 LLM profile，以及分页、筛选和清理旧终态 Run。

工作台自身也以 `third-party/st-authority-sdk` session 发起 Run；即使当前用户是管理员，创建 Run 仍经过 `agent.run:<workspaceId>` 的声明与授权流程。管理员 API 负责治理数据和审批，不提供绕过 Run 权限的新建入口。

## 工作区版本树

Authority 使用自己的内容寻址对象库，不接管或修改用户已有 Git：

```text
objects/<sha256>       blob 与 canonical tree 对象
commits/<sha256>.json  commit 对象
refs/<name>.json       带 generation 的 head
workspaces.json        工作区注册表
```

tree entry 按名称排序后以 canonical JSON 计算 SHA-256；blob 以原始字节计算 SHA-256；commit 引用 tree 与 parent commit。ref 更新采用 generation compare-and-swap，并先写 journal，再以临时文件 rename 发布。

Agent 的每次写工具调用和可能修改文件的终端命令都必须先建立检查点。回退不会直接移动旧 ref：它先持久化回退 journal 和当前状态，再把目标 tree 物化到工作区，最后创建新的 rollback commit，因此进程在任一步中断都能由 `resume` 继续，历史也保持可追踪。回退请求可携带稳定 `operationId`；完成记录先于 journal 清理落盘，同一操作重试不会重复生成历史。

单次 Agent 写工具把“变更前检查点、工具执行、变更后检查点”放在同一个跨进程工作区锁内。这样独立恢复器或另一个 Agent 不能插入两次检查点之间；工具失败时仍追加失败检查点，保留已经发生的部分改动，供用户检查或回退。

检查点默认可以是稀疏的：只把即将被工具修改的路径加入版本树，之后持续跟踪这些路径。这样不会因为改一个插件文件就复制整个 ST、`data` 或依赖目录；需要完整基线时可显式检查点 `.`。`.git`、`node_modules` 和版本树自身始终排除。

稀疏回退只物化目标 commit 当时跟踪的路径；当前 head 独有的路径仅进入回退前安全快照，不会被误判为目标中已删除。若当前文件已经偏离预期 head，普通回退拒绝覆盖并返回冲突；只有显式 `force` 才允许强制恢复。恢复开始后若又出现写入，`resume` 会先追加新的安全快照，而不是覆盖历史外状态。

## 独立恢复

```bash
node plugins/authority/runtime/agent.cjs rescue status
node plugins/authority/runtime/agent.cjs rescue workspaces
node plugins/authority/runtime/agent.cjs rescue log
node plugins/authority/runtime/agent.cjs rescue diff <from> <to>
node plugins/authority/runtime/agent.cjs rescue checkpoint [paths...]
node plugins/authority/runtime/agent.cjs rescue rollback <commit> --operation-id <stable-id>
node plugins/authority/runtime/agent.cjs rescue resume
```

恢复入口只依赖 Node 标准库和版本树公开格式。恢复数据位于 `<DATA_ROOT>/_authority-global/authority/state/agent-workspaces`，不会随插件 `git pull` 或 installable 同步被删除。

installable 安装使用上面的 `plugins/authority/runtime/agent.cjs`；`npm run dev:link` 会把构建目录直接链接为插件根，因此开发模式入口是 `plugins/authority/agent.cjs`。若不从 ST 根目录启动 CLI，需传 `--data-root <path>` 或 `--store <path>`。

## 不变量

1. Agent 子系统初始化失败不能阻止 ST 启动；路由先注册，Agent 后台启动不被 `init()` await。
2. 模型不能直接调用任意内部函数；所有动作必须经过已注册工具和结构化参数。
3. `plan` 只执行 DOA 已知的只读 host 工具；`ask` 按工具策略在副作用前暂停；`auto` 可以自动修改工作区，但 host 修改仍强制创建检查点。
4. 前端插件不能借 Agent 绕过其用户身份、工作区 ACL、session、声明权限和管理员策略；extension ID 在同源页面内只作归属标识。
5. API key 不返回前端明文；读取配置只返回 mask 与 fingerprint。本地状态目录与备份属于密钥信任边界。
6. 工作区工具不跟随 symlink 越出工作区。显式增加其他根目录属于新的管理员授权。
7. 网络发送等外部副作用无法由文件版本树撤销，工具必须标记为不可回退并按策略审批。
8. 工作区注册和 ACL 属于本机管理员信任边界；普通用户只能启动 ACL 明确允许的工作区 Run。ACL 撤销阻止新 Run，已启动 Run 作为已授予能力继续到终态，管理员可显式取消。
9. 版本树会拒绝或重新暂存普通并发写入，但纯 Node 恢复器不是针对同一系统账户恶意竞态的文件系统沙箱；若未来纳入该威胁模型，物化层必须改用各平台原生的目录句柄相对操作。
