# Excalink

个人自托管白板。首页是当前画布，编辑后自动保存。档案有固定地址，可以编辑、改名和导出。分享当前画布会建立独立副本，访客在同一画布上协作。

## 本机启动

需要 Node.js 22.12 或以上。

```sh
npm ci
npm run build
npm start
```

在服务所在电脑打开 http://127.0.0.1:4173。用 `PORT` 改端口，用 `BOARD_DATA_DIR` 改存储目录。默认只监听回环地址。

## Docker 部署

```sh
git clone git@github.com:xiongwei-git/Excalink.git
cd Excalink
cp .env.example .env
docker compose up --build -d
```

默认访问 http://127.0.0.1:4173。修改 `.env` 中的 `EXCALINK_PORT` 时，也要同步修改 `APP_ORIGIN` 中的访问端口。经反向代理访问时，`APP_ORIGIN` 应填写实际的 HTTPS 站点地址。

镜像使用多阶段构建，只保留生产依赖，以非 root 的 `node` 用户运行。Compose 默认仅映射回环地址，启用 init 和自动重启。默认 `public` 模式适合本机使用；需要私有访问时配置下方的密码或 OIDC 认证。

```sh
docker compose logs --tail=100 whiteboard
docker compose down
docker compose up --build -d
```

画布、档案和图片保存在 Compose 的 `whiteboard` 命名卷（容器内 `/data`），普通停止、重建容器不会删除数据。不要运行 `docker compose down -v`，它会删除数据卷。应用按单进程和单写者设计，同一数据目录只交给一个实例。备份前停写，并完整备份数据卷；恢复时保留 `node` 用户的写权限。

服务容器不包含 Chromium。MCP 的图像导出和 Mermaid 转换在 MCP 客户端所在机器运行，安装要求见下方 MCP 说明。

## 认证和分享

| `AUTH_MODE` | 使用方式 |
| --- | --- |
| `public` | 无登录，能访问服务的人也能访问白板原地址。撤销只停用分享地址。 |
| `password` | 设置 `AUTH_USERNAME` 和 `PASSWORD_HASH`。使用随机 16 字节盐及 Node scrypt 默认参数派生 64 字节，格式为 `hex(salt):hex(hash)`。 |
| `oidc` | 设置 `OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_SUBJECT`。回调注册为 `${APP_ORIGIN}/auth/callback`。仅该发行方的指定 subject 可以管理白板。 |

Compose 环境变量参考 `.env.example`。Node 直接启动时，由进程环境提供变量，或使用 `node --env-file=.env src/server.js`。反向代理需提供 HTTPS、保留原 Host 并支持 WebSocket Upgrade。将 `APP_ORIGIN` 设置成实际访问地址，代理日志需隐藏 `/share/` 和 `/api/share/` 路径中的令牌。登录会话保存在内存中，服务重启后需重新登录。

访客通过分享链接进入同一画布，修改保存后推送给其他窗口。若本地草稿与服务端版本冲突，可导出本地草稿后重开最新版本。已撤销的链接会拒绝读写并关闭当前访客连接。

## MCP

服务端与本地 MCP 客户端使用同一个随机令牌 `MCP_TOKEN`，至少 32 字符。未设置时 MCP HTTP 路由关闭。MCP 客户端使用 stdio，启动命令为 `node /absolute/path/to/Excalink/src/mcp.js`。在客户端环境设置 `MCP_BOARD_ORIGIN` 和 `MCP_TOKEN`。

MCP 工具和参数见 [兼容表](docs/MCP_COMPATIBILITY.md)。工具仅作用于当前画布。图片导出与 Mermaid 转换需要在启动 MCP 的机器安装 Playwright Chromium，也可用 `MCP_CHROME_CHANNEL=chrome` 选择本机 Chrome。

## 数据与验证

`data/state.json` 记录当前画布及档案索引，`data/scenes/` 保存含图片数据的独立 `.excalidraw` 文件。备份和恢复时以整个数据目录为单位，推荐停写后操作。新建和归档通过一次索引替换提交。历史 scene 文件暂保留，部署时需监测卷大小。

运行 `npm test` 检查存储、并发和归档。运行 `docker compose build && npm run verify:docker` 验证容器启动、非 root 用户以及重建后的当前画布和档案持久化；验证使用独立临时项目及合成数据，结束后仅清理该临时项目。项目范围见 [需求](docs/REQUIREMENTS.md)、[设计](docs/DESIGN.md) 和 [验收](docs/ACCEPTANCE.md)。第三方依赖及字体来源见 [归属清单](notices/README.md)。项目发布许可证待定。

可重复联调命令包括 `npm run verify:mcp`、`npm run verify:tinyauth` 和 `npm run verify:zoom`。Tinyauth 测试需要 Docker、Chrome、OpenSSL 和 curl，使用隔离实例和一次性账号。缩放验收使用支持加载本地测试扩展的 Chromium，可用 `PWB_CHROMIUM` 指定可执行文件。
