# pi-weixin MVP

通过腾讯 iLink 把一个微信账号绑定到一个由 pi-web 托管的 Pi session。微信和 Web 写入同一份 Pi session 文件。

## 安装

开发态可从 pi-web 的插件设置安装本地目录：

```text
/Users/yansir/code/52/pi-weixin
```

安装后 reload 当前 session，然后执行：

```text
/weixin login
```

扫描二维码后，当前 Pi session 会成为微信消息的目标。默认连接本机 `http://127.0.0.1:30141`；可用 `PI_WEB_BASE_URL` 改为其他 loopback 地址。

## 开发

仓库使用 pnpm、Vite+、TypeScript 和 Effect v4：

```bash
pnpm install
pnpm test
pnpm verify
pnpm build
```

`pnpm verify` 依次执行格式与 lint、Effect language service 类型检查、测试、Effect scanner、自包含构建、tarball 内容检查，以及零安装目录中的 Pi extension loader 验收。Pi 加载的唯一构建入口是 `dist/pi/extension.js`。

## 分发

生成可直接交付的压缩包：

```bash
pnpm pack:plugin
```

产物为 `pi-weixin-<version>.tgz`。`effect`、`@effect/platform-node`、`qrcode` 和项目源码均已收进单文件 bundle；发布包没有普通 `dependencies`，运行时只允许依赖 Node 内建模块和 Pi 宿主 API。

接收方不需要执行 `npm install` 或 `pnpm install`：

```bash
mkdir -p "$HOME/pi-plugins/pi-weixin"
tar -xzf pi-weixin-0.0.1.tgz \
  -C "$HOME/pi-plugins/pi-weixin" \
  --strip-components=1
```

然后在 pi-web 插件设置中填入：

```text
~/pi-plugins/pi-weixin
```

发布包只包含 `package.json`、`README.md` 和 `dist/pi/extension.js`。

## 命令

- `/weixin login`：扫码登录，并绑定当前 session。
- `/weixin bind`：把已登录的微信账号改绑到当前 session。
- `/weixin start`：启动已配置的桥接。
- `/weixin stop`：停止桥接，保留登录和绑定。
- `/weixin status`：显示脱敏状态。
- `/weixin logout`：停止并清除 token、cursor 和绑定。

状态保存在 `~/.pi/agent/pi-weixin/state.json`，文件权限为 `0600`。入站消息以规范化消息哈希去重，回复使用确定性的 iLink `client_id`。

## MVP 边界

- 仅处理绑定微信用户发来的文本消息。
- pi-web 进程必须运行；服务重启后，需要任意 Pi session 加载该 extension 才会自动恢复轮询。
- 一个微信账号只绑定一个 Pi session。
- 还没有图片、文件、回复分片、微信侧交互审批和独立 daemon。
- 在支持多个写入宿主前，必须把 session registry 抽成唯一 `PiSessionHost`；不得让 extension 自行创建第二个 `AgentSession`。
