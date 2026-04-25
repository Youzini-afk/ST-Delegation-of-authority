# ST-Delegation-of-authority

ST-Delegation-of-authority 是一个面向 SillyTavern 的基石型权限治理项目。

它提供一个可被 SillyTavern 原生加载的服务端插件 `authority`，并在启动时自动部署前端扩展 `third-party/st-authority-sdk`，让后续第三方扩展在不重复安装复杂服务端能力的前提下，也能获得受治理的服务端权限、能力和审计能力。

## 快速安装

最终用户安装不需要执行 `npm install` 或 `npm run build`。

当前可直装产物内置 Windows x64 版 `authority-core` 预编译二进制。其他平台需要后续补充对应平台产物后再作为免编译安装目标。

### 方式一：直接克隆到服务端插件目录

```bash
git clone https://github.com/Youzini-afk/ST-Delegation-of-authority.git SillyTavern/plugins/authority
```

### 方式二：用 SillyTavern 自带安装命令

```bash
cd SillyTavern
node plugins.js install https://github.com/Youzini-afk/ST-Delegation-of-authority.git
```

说明：

- 目录名不必等于插件 ID，`authority` 会按模块自身的 `info.id` 被加载。
- 两种方式都不会自动修改你的 SillyTavern 配置文件。

## 启用步骤

1. 打开 SillyTavern 配置文件，确认 `enableServerPlugins: true`。
2. 建议把 `enableServerPluginsAutoUpdate` 也一起确认好。
3. 启动 SillyTavern。
4. 首次启动后，`authority` 会自动把 `st-authority-sdk` 部署到 `public/scripts/extensions/third-party/st-authority-sdk`。
5. 打开扩展菜单，确认能看到 `Authority Security Center`。

## 升级

如果你是直接克隆到 `plugins/authority`：

```bash
cd SillyTavern/plugins/authority
git pull
```

如果你开启了 `enableServerPluginsAutoUpdate: true`，SillyTavern 启动时也会尝试拉取插件更新。

更新完成后，`authority` 会在下次启动时自动检查内置的 SDK 与 `authority-core` 产物，完成 SDK 同步、core 平台匹配、版本一致性与哈希校验。

## 卸载

删除服务端插件目录 `SillyTavern/plugins/authority`。

如果你希望连同自动部署的前端 SDK 一起移除，再删除：

```text
SillyTavern/public/scripts/extensions/third-party/st-authority-sdk
```

`authority` 只会管理它自己部署的 `st-authority-sdk`，不会接管其他扩展目录。

## 冲突处理

如果 `public/scripts/extensions/third-party/st-authority-sdk` 已经存在，但不是 `authority` 管理的目录，插件会进入 `conflict` 状态并拒绝覆盖。

这时请按下面的方式处理：

1. 备份现有 `st-authority-sdk` 目录。
2. 删除或改名旧目录。
3. 重启 SillyTavern，让 `authority` 重新自动部署。

你也可以调用 `POST /api/plugins/authority/probe` 查看安装状态：

- `pluginVersion`
- `sdkBundledVersion`
- `sdkDeployedVersion`
- `coreBundledVersion`
- `coreArtifactPlatform`
- `coreArtifactHash`
- `coreBinarySha256`
- `coreVerified`
- `installStatus`
- `installMessage`

`installStatus` 的取值为：

- `ready`
- `installed`
- `updated`
- `conflict`
- `error`
- `missing`

## V1 能力范围

当前已实现的可治理能力：

- `storage.kv`
- `storage.blob`
- `http.fetch`
- `jobs.background`
- `events.stream`

当前已实现的治理能力：

- 扩展注册与会话初始化
- 会话级授权与持久授权
- `granted / denied / prompt / blocked` 授权状态
- `allow-once / allow-session / allow-always / deny` 用户选择
- HTTP 按 `hostname` 粒度授权
- 管理员全局策略与扩展覆盖策略
- 权限审计、调用审计、错误审计
- 安全中心 UI
- 统一权限请求弹窗

V1 明确不做：

- 任意服务端代码托管
- shell 执行
- vm 执行
- 任意文件系统访问

## 仓库结构

这个仓库现在同时承担两种角色：

- 仓库根目录：可直接被 SillyTavern 当作 `authority` 服务端插件加载
- `packages/`：monorepo 源码、测试和开发脚本

```text
ST-Delegation-of-authority/
├─ runtime/                # 受管服务端运行时产物
├─ managed/
│  ├─ sdk-extension/       # 受管前端 SDK 运行时产物
│  └─ core/                # 受管 authority-core 预编译二进制与元数据
├─ packages/
│  ├─ server-plugin/
│  ├─ sdk-extension/
│  ├─ example-extension/
│  └─ shared-types/
├─ scripts/
├─ .authority-release.json
└─ package.json
```

固定命名如下：

- 服务端插件 ID: `authority`
- SDK 扩展目录/ID: `third-party/st-authority-sdk`
- 示例扩展目录/ID: `third-party/st-authority-example`
- 安全中心显示名: `Authority Security Center`

## 开发命令

开发者常用命令：

```bash
npm install
npm run typecheck
npm run build
npm test
npm run sync:installable
npm run check:installable
npm run dev:link
npm run dev:unlink
```

这些命令分别用于：

- `npm install`: 安装 workspace 依赖
- `npm run typecheck`: 全仓类型检查
- `npm run build`: 构建四个 package
- `npm test`: 运行 Vitest 测试
- `npm run sync:installable`: 重新生成根目录可直装产物，包括 runtime、managed SDK、managed core 和 release 元数据
- `npm run check:installable`: 校验根目录可直装产物是否与源码、managed core 元数据一致
- `npm run dev:link`: 构建并把开发产物链接进本地 SillyTavern
- `npm run dev:unlink`: 清理本地联调链接

## 本地联调

当前 `dev:link` 脚本假设你的目录结构是：

```text
E:\cursor_project\ST-Delegation of authority\
├─ SillyTavern
└─ ST-Delegation-of-authority
```

联调步骤：

1. `npm install`
2. `npm run build`
3. `npm run dev:link`
4. 确认 SillyTavern 配置里已启用 `enableServerPlugins: true`
5. 建议本地联调时把 `enableServerPluginsAutoUpdate` 设为 `false`，避免 SillyTavern 启动时自动拉取开发仓库

`dev:link` 会自动创建以下联调链接：

- `SillyTavern/plugins/authority`
- `SillyTavern/public/scripts/extensions/third-party/st-authority-sdk`
- `SillyTavern/public/scripts/extensions/third-party/st-authority-example`

## 运行时入口

当前前端接入入口：

- `window.STAuthority`
- `window.STAuthority.AuthoritySDK`
- `window.STAuthority.openSecurityCenter()`

服务端公开接口：

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
- `POST /extensions/:id/grants/reset`

## 在其他扩展中接入

接入方扩展建议声明：

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

## 测试覆盖

当前测试覆盖包括：

- 权限状态流转
- 一次性授权消费
- 管理员策略覆盖用户授权
- KV 命名空间隔离
- Blob 读写与删除
- 内建 delay 任务创建 / 完成 / 取消
- Managed SDK 首装、幂等、升级、冲突保护、漂移修复
- Managed core 平台匹配、版本一致性与哈希校验
- 根目录可直装产物一致性检查

CI 当前会运行：

- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run check:installable`

## 当前限制

这是 V1 基础版本，当前限制包括：

- 后台任务只实现了内建 `delay`
- SSE 只做每用户、每扩展独立流
- 不支持 WebSocket
- 不支持跨用户广播
- 不支持任意服务端代码托管
- 不支持直接把 REST 直连当 first-class 接入方式
