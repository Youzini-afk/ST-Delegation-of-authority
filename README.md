# ST-Delegation-of-authority

ST-Delegation-of-authority 是一个面向 SillyTavern 的基石型权限治理项目。

它的目标不是再做一个“具体业务扩展”，而是提供一个可被 SillyTavern 原生加载的服务端插件，加上一套前端 SDK 扩展，让后续第三方扩展在不重复安装复杂服务端能力的前提下，也能获得受治理的服务端权限、能力和审计能力。

V1 重点是把这三件事打通：

- 安全中心
- 授权治理
- 通用服务端能力

V1 明确不做：

- 任意服务端代码托管
- shell 执行
- vm 执行
- 任意文件系统访问

## V1 能力范围

当前实现已经覆盖以下可治理能力：

- `storage.kv`
- `storage.blob`
- `http.fetch`
- `jobs.background`
- `events.stream`

当前实现已经覆盖以下治理能力：

- 扩展注册与会话初始化
- 会话级授权与持久授权
- `granted / denied / prompt / blocked` 授权状态
- `allow-once / allow-session / allow-always / deny` 用户选择
- HTTP 按 `hostname` 粒度授权
- 管理员全局策略与扩展覆盖策略
- 权限审计、调用审计、错误审计
- 安全中心 UI
- 统一权限请求弹窗

## 技术路线

V1 固定为：

- `TypeScript + Node.js`
- `npm workspaces`
- 服务端插件使用 Webpack 打包为单文件插件目录
- 前端扩展使用 TypeScript 编译为扁平 ESM 产物

本仓库当前验证环境：

- Node.js `v24.13.1`
- npm `11.8.0`

## 仓库结构

```text
ST-Delegation-of-authority/
├─ packages/
│  ├─ server-plugin/        # SillyTavern 服务端插件 authority
│  ├─ sdk-extension/        # Authority SDK + Security Center
│  ├─ example-extension/    # 示例扩展，演示能力闭环
│  └─ shared-types/         # 共享类型定义
├─ scripts/                 # 构建、联调链接脚本
├─ stubs/                   # SillyTavern 前端类型 stub
├─ package.json
└─ README.md
```

固定命名如下：

- 服务端插件 ID: `authority`
- SDK 扩展目录/ID: `third-party/st-authority-sdk`
- 示例扩展目录/ID: `third-party/st-authority-example`
- 安全中心显示名: `Authority Security Center`

## 包说明

### `packages/server-plugin`

SillyTavern 服务端插件，导出标准：

- `info`
- `init(router)`

内部按四层拆分：

- `routes`
- `services`
- `store`
- `events`

主要职责：

- 会话初始化
- 权限判定与授权落盘
- KV / Blob / HTTP / Jobs / SSE 能力实现
- 审计日志落盘
- 管理员策略读写

### `packages/sdk-extension`

提供两部分内容：

- 运行时 `AuthoritySDK`
- 独立安全中心 UI

主要职责：

- 封装 `/api/plugins/authority/*` 接口
- 统一权限弹窗
- 统一会话管理
- 打开安全中心
- 给其他扩展提供稳定接入入口

当前运行时入口：

- 全局对象 `window.STAuthority`
- `window.STAuthority.AuthoritySDK`
- `window.STAuthority.openSecurityCenter()`

### `packages/example-extension`

示例扩展只用于验证平台能力，不承担真实业务。

它覆盖了最小闭环：

- `session/init`
- `storage.kv`
- `storage.blob`
- `http.fetch`
- `jobs`
- `events`

### `packages/shared-types`

放共享的协议类型和能力模型：

- 权限资源
- 授权状态
- 会话响应
- 策略结构
- Blob / Job 类型

## 已实现的接口

服务端插件当前已实现这些路由：

- `POST /probe`
- `POST /session/init`
- `GET /session/current`
- `POST /permissions/evaluate`
- `POST /permissions/resolve`
- `GET /extensions`
- `GET /extensions/:id`
- `POST /storage/kv/get`
- `POST /storage/kv/set`
- `POST /storage/kv/delete`
- `POST /storage/kv/list`
- `POST /storage/blob/put`
- `POST /storage/blob/get`
- `POST /storage/blob/delete`
- `POST /storage/blob/list`
- `POST /http/fetch`
- `POST /jobs/create`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/cancel`
- `GET /events/stream`
- `GET /admin/policies`
- `POST /admin/policies`

另外实现了一个辅助路由：

- `POST /extensions/:id/grants/reset`

这个路由用于安全中心里手动重置某个扩展的持久授权记录。

## 权限模型

当前授权状态：

- `granted`
- `denied`
- `prompt`
- `blocked`

当前用户决策：

- `allow-once`
- `allow-session`
- `allow-always`
- `deny`

当前授权粒度：

- `storage.kv` 按资源域授权
- `storage.blob` 按资源域授权
- `http.fetch` 按 `extension + hostname`
- `jobs.background` 按 `jobType`
- `events.stream` 按 `channel`

当前实现约束：

- 用户侧不支持 hostname 通配符授权
- 用户侧不能一次性放开整个 `http.fetch`
- 高风险域不对外开放
- `deny` 为持久拒绝，只有在安全中心重置后才会重新进入 `prompt`

## 数据落盘

Authority 数据按每用户目录落盘在：

```text
extensions-data/authority/
├─ state/
│  ├─ extensions.json
│  ├─ permissions.json
│  └─ policies.json
├─ audit/
│  ├─ permissions.jsonl
│  ├─ usage.jsonl
│  └─ errors.jsonl
├─ jobs/
│  └─ jobs.json
└─ storage/
   ├─ kv/
   │  └─ <extension-id>.json
   └─ blobs/
      └─ <extension-id>/
```

管理员全局策略额外会落在：

```text
<DATA_ROOT>/_authority-global/authority/state/policies.json
```

## 开发命令

根目录常用命令：

```bash
npm install
npm run typecheck
npm run build
npm test
npm run dev:link
npm run dev:unlink
```

这些命令分别用于：

- `npm install`: 安装 workspace 依赖
- `npm run typecheck`: 全仓类型检查
- `npm run build`: 构建四个 package
- `npm test`: 运行 Vitest 测试
- `npm run dev:link`: 构建并把产物链接进本地 SillyTavern
- `npm run dev:unlink`: 清理本地联调链接

## 本地联调

### 前置条件

当前 `dev:link` 脚本假设你的目录结构是：

```text
E:\cursor_project\ST-Delegation of authority\
├─ SillyTavern
└─ ST-Delegation-of-authority
```

也就是：

- 本仓库与 `SillyTavern` 是同级目录

### 1. 安装依赖

```bash
npm install
```

### 2. 构建

```bash
npm run build
```

### 3. 链接到本地 SillyTavern

```bash
npm run dev:link
```

它会自动创建以下联调链接：

- `SillyTavern/plugins/authority`
- `SillyTavern/public/scripts/extensions/third-party/st-authority-sdk`
- `SillyTavern/public/scripts/extensions/third-party/st-authority-example`

### 4. 启用 SillyTavern 服务端插件

SillyTavern 默认不一定开启服务端插件加载。

请确认你的 SillyTavern 配置里已经启用：

- `enableServerPlugins`

否则 `authority` 不会被加载。

### 5. 启动 SillyTavern 后验证

建议按这个顺序验证：

1. 确认服务端日志里 `authority` 插件被加载
2. 打开扩展菜单，确认能看到 `Authority Security Center`
3. 打开扩展菜单，确认能看到 `Authority Example`
4. 在示例扩展里测试 KV / Blob / HTTP / Jobs / SSE
5. 在安全中心里查看授权、活动和策略

## 手动安装产物

如果不想使用 `dev:link`，也可以手动复制构建产物。

构建输出目录：

- 服务端插件输出: `packages/server-plugin/dist/authority`
- SDK 扩展输出: `packages/sdk-extension/dist/extension`
- 示例扩展输出: `packages/example-extension/dist/extension`

手动复制目标：

- `packages/server-plugin/dist/authority` -> `SillyTavern/plugins/authority`
- `packages/sdk-extension/dist/extension` -> `SillyTavern/public/scripts/extensions/third-party/st-authority-sdk`
- `packages/example-extension/dist/extension` -> `SillyTavern/public/scripts/extensions/third-party/st-authority-example`

## 在其他扩展中接入

接入方扩展需要依赖：

- `third-party/st-authority-sdk`

`manifest.json` 里建议声明：

```json
{
  "dependencies": [
    "third-party/st-authority-sdk"
  ]
}
```

运行时初始化方式：

```js
const client = await window.STAuthority.AuthoritySDK.init({
  extensionId: 'third-party/your-extension',
  displayName: 'Your Extension',
  version: '0.1.0',
  installType: 'local',
  declaredPermissions: {
    storage: { kv: true },
    http: { allow: ['api.example.com'] }
  }
});
```

然后就可以通过 `client` 使用：

- `client.getSession()`
- `client.getCapabilities()`
- `client.ensurePermission()`
- `client.requestPermission()`
- `client.storage.kv.*`
- `client.storage.blob.*`
- `client.http.fetch()`
- `client.jobs.*`
- `client.events.subscribe()`
- `client.openSecurityCenter()`

## 测试覆盖

当前已落地的服务端测试包括：

- 权限状态流转
- 一次性授权消费
- 管理员策略覆盖用户授权
- KV 命名空间隔离
- Blob 读写与删除
- 内建 delay 任务创建 / 完成 / 取消

运行方式：

```bash
npm test
```

## 当前限制

这是 V1 基础版本，当前限制包括：

- 后台任务只实现了内建 `delay`
- SSE 只做每用户、每扩展独立流
- 不支持 WebSocket
- 不支持跨用户广播
- 不支持任意服务端代码托管
- 不支持直接把 REST 直连当 first-class 接入方式
- 安全中心 UI 以联调和验证为主，仍可继续打磨

## 当前状态

当前仓库已经完成：

- monorepo 初始化
- 服务端插件实现
- SDK 扩展实现
- 安全中心实现
- 统一权限弹窗实现
- 示例扩展实现
- 关键测试实现
- 本地 `dev:link` 联调脚本

并且已经验证通过：

```bash
npm run typecheck
npm run build
npm test
npm run dev:link
```

## 后续

- 更完整的安全中心交互优化
- 更细的管理员策略编辑体验
- 更多内建任务类型
- 更稳定的扩展接入文档
- API 文档与权限声明规范文档
- CI 工作流
