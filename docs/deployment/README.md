# 部署 Excalink

[项目首页](../../README.md) · 简体中文 · [English](README.en.md)

Excalink 每个实例有一个所有者工作区。以单实例运行，同一数据目录只允许一个应用进程写入。

## Docker Compose

需要 Git、Docker 和 Docker Compose v2。Compose 从源码构建镜像。

```sh
git clone https://github.com/xiongwei-git/Excalink.git
cd Excalink
cp .env.example .env
chmod 600 .env
```

本机试用可以保留默认配置，访问 `http://127.0.0.1:4173`。服务器部署请先选择下文的认证方式，并配置外部地址和宿主机端口。

```dotenv
APP_ORIGIN=https://board.example.com
EXCALINK_PORT=14173
```

`APP_ORIGIN` 填浏览器访问的源地址，包含协议、域名以及非默认端口。使用独立域名的根路径 `/`。Compose 将宿主机回环端口映射到容器内的 `4173`。

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 whiteboard
```

## 认证

在 `.env` 中选择一个 `AUTH_MODE`。保管好配置文件中的凭据。

| 模式 | 所有者权限 |
| --- | --- |
| `public`（默认） | 所有能访问服务的人均可编辑当前白板、访问档案和执行管理操作。 |
| `password` | 一个本地用户名与密码。 |
| `oidc` | 由身份提供方认证且 `sub` 匹配的一个账号。 |

密码和 OIDC 模式下，持分享链接的访客可以编辑对应白板。更换密码或认证方式后，已有分享链接继续有效。所有者可撤销链接，删除对应档案也会使链接失效。早期版本生成的共享副本仍是独立白板。

### 本地密码

在 `.env` 中设置 `AUTH_MODE=password` 和 `AUTH_USERNAME=admin`（用户名可自行选择）。以下命令需要 Python 3，会提示输入密码并输出 `PASSWORD_HASH`，将整行复制到 `.env`，替换原有空项。重置密码时重复此步骤。

```sh
docker compose build whiteboard
python3 - <<'PY'
import getpass
import subprocess

password = getpass.getpass("Password: ")
if not password or password != getpass.getpass("Repeat password: "):
    raise SystemExit("Empty or mismatched password")
code = """
const { randomBytes, scryptSync } = require('node:crypto');
const password = require('node:fs').readFileSync(0);
const salt = randomBytes(16);
console.log('PASSWORD_HASH=' + salt.toString('hex') + ':' +
  scryptSync(password, salt, 64).toString('hex'));
"""
subprocess.run(
    ["docker", "compose", "run", "--rm", "--no-deps", "-T",
     "--entrypoint", "node", "whiteboard", "-e", code],
    input=password.encode("utf-8"), check=True,
)
PY
```

直接使用 Node.js 部署时，跳过构建命令，并将 `subprocess.run` 的命令列表替换为 `["node", "-e", code]`。

### OpenID Connect

在身份提供方创建一个专用的 confidential Web 客户端，启用授权码流程、PKCE S256 和 `client_secret_post`，注册精确的回调地址 `https://board.example.com/auth/callback`。

```dotenv
AUTH_MODE=oidc
OIDC_ISSUER=https://auth.example.com
OIDC_CLIENT_ID=excalink
OIDC_CLIENT_SECRET='replace-with-client-secret'
OIDC_SUBJECT=replace-with-user-sub
```

`OIDC_ISSUER` 使用提供方公布的 issuer 原值，包含其路径（如有）。应用启动时会从容器内访问该 issuer 进行发现，并校验签名 ID Token。`OIDC_SUBJECT` 填目标用户在这个客户端下的 ID Token `sub`。

**Tinyauth v5.2.0** 已用隔离实例验证。将以下环境变量合并到 Tinyauth 服务中，保留原有客户端。把独立随机密钥挂载到指定路径，确保服务用户可读，并将同一密钥填入 Excalink 的 `OIDC_CLIENT_SECRET`。

```yaml
environment:
  TINYAUTH_OIDC_CLIENTS_EXCALINK_CLIENTID: excalink
  TINYAUTH_OIDC_CLIENTS_EXCALINK_CLIENTSECRETFILE: /run/secrets/excalink-client-secret
  TINYAUTH_OIDC_CLIENTS_EXCALINK_TRUSTEDREDIRECTURIS: https://board.example.com/auth/callback
  TINYAUTH_OIDC_CLIENTS_EXCALINK_NAME: Excalink
volumes:
  - ./secrets/excalink-client-secret:/run/secrets/excalink-client-secret:ro
```

对该版本的本地用户名账号，可用 Python 表达式计算 `sub`，即 `uuid.uuid5(uuid.NAMESPACE_URL, username + ":" + client_id)`。其他版本或登录方式以提供方实际签发的 `sub` 为准。

## HTTPS 与反向代理

以下示例假设 Nginx 与 Docker 在同一台宿主机上。让域名指向服务器，在 Nginx 配置证书并启用 HTTP 到 HTTPS 跳转。使用宝塔时，创建反向代理站点，填写同一上游并在面板启用 SSL 和强制 HTTPS。将下列指令合并到现有的 HTTPS `server` 与 `location /`，避免重复定义。

```nginx
client_max_body_size 22m;
access_log off;
error_log /var/log/nginx/excalink.error.log crit;

location / {
    proxy_pass http://127.0.0.1:14173;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_buffering off;
}
```

将日志路径改为 Nginx 可写的位置。分享 URL 和 OIDC 回调含敏感参数，避免代理或上游日志记录完整请求 URL。让 Excalink 处理应用登录、分享链接和 MCP 认证，确保额外的代理登录规则允许这些入口按预期工作。

通过配置好的域名检查未登录状态。

```sh
curl -fsS https://board.example.com/auth/session
curl -sS -o /dev/null -w '%{http_code}\n' https://board.example.com/api/current
```

`password` / `oidc` 预期得到 `owner: false` 和 HTTP `401`，`public` 预期得到 `owner: true` 和 HTTP `200`。随后用浏览器完成登录、绘图后刷新、保存档案，并用另一浏览器验证当前白板可以双向编辑、旧链接在新建后仍访问归档白板，以及撤销后访客无法继续访问。

## 更新与备份

画布、档案、图片和 MCP 凭据记录保存在 `whiteboard` 命名卷中，挂载到容器的 `/data`。更新时保持同一 Compose 项目名。以下命令暂停应用并备份整个卷，然后拉取更新并重建。建议同时保留更新前的提交号和受保护的 `.env` 副本。

```sh
docker compose stop whiteboard
docker compose run --rm --no-deps -T --entrypoint tar whiteboard \
  -C /data -czf - . > "excalink-data-$(date +%Y%m%d-%H%M%S).tar.gz"
```

确认备份命令成功并用 `tar -tzf` 检查归档后，再执行更新。

```sh
git pull --ff-only && docker compose up -d --build
```

恢复时停止应用，将完整归档解包到空的数据卷或目录，并确保应用用户可写。仅更新 `.env` 时运行 `docker compose up -d --force-recreate`。普通 `docker compose down` 保留数据卷，`docker compose down -v` 会删除它。

## 直接使用 Node.js

需要 Node.js 22.12 或更高版本及 npm。在仓库根目录执行以下命令。

```sh
npm ci
npm run build
cp .env.example .env
chmod 600 .env
node --env-file=.env src/server.js
```

需要自定义配置时，在启动前编辑 `.env`。进程默认绑定 `127.0.0.1:4173`，直接部署时使用 `PORT` 改端口、`BIND_HOST` 改监听地址。数据默认保存在工作目录的 `data/`，可用 `BOARD_DATA_DIR` 指定固定的可写目录。保留示例 `APP_ORIGIN` 时，访问地址为 `http://127.0.0.1:4173`。改端口或使用反代时，同步填写实际访问源地址。

## 连接 MCP

在「MCP 服务」里管理接入。两种传输方式都需要密码或 OIDC 登录，以及 HTTPS 的 `APP_ORIGIN`。本机可使用 HTTP 回环地址。远程 HTTP 支持 OAuth 或 API Key，本地 stdio 使用独立令牌。

### 远程接入（Streamable HTTP）

客户端统一连接 `https://board.example.com/mcp`，请替换为你的白板地址。反向代理应保留 Host、Authorization、MCP-Session-Id 和 MCP-Protocol-Version 请求头。上文的 `location /` 会将 MCP 与 OAuth 路由转发给 Excalink。如果代理按路径选择上游，也要转发 `/.well-known/oauth-protected-resource/mcp`、`/.well-known/oauth-authorization-server`、`/authorize`、`/register`、`/token` 及 `/mcp/` 下的授权页面。发现和令牌请求应直接到达应用，浏览器登录由 Excalink 处理。

#### OAuth 登录

在支持 OAuth 发现、动态注册和 PKCE S256 的客户端中添加上面的 MCP 地址。连接后按客户端提示在浏览器登录 Excalink，确认只读或读写权限，再返回客户端。可在「远程 HTTP → 安全授权」撤销授权。OAuth 授权有效期为 90 天，访问令牌有效期为 1 小时，由支持刷新流程的客户端续期。

#### API Key

在「远程 HTTP → 安全授权」创建命名 API Key，选择只读或读写，以及 30、90 或 365 天有效期。Key 仅在签发时显示。将它填入客户端的凭据设置，以 `Authorization: Bearer <API Key>` 发送。面板复制的配置示例中，`${EXCALINK_API_KEY}` 是占位符，按客户端支持的方式配置实际凭据。可在同一面板撤销 Key。

两种远程认证方式都可通过列出工具并调用 `describe_scene` 检查连接。任务记录在内存中保留最近 200 条远程工具调用，重启后清空。OAuth 授权与 API Key 的记录随数据目录备份。Mermaid 转换需要读写权限，PNG/SVG 导出与截图支持只读权限。

Docker 镜像自带 Chromium。直接用 Node.js 部署时，在白板服务所在机器运行 `node node_modules/playwright/cli.js install --with-deps --only-shell chromium`（Linux），并确保服务账号能读取安装目录。macOS 可使用 `node node_modules/playwright/cli.js install --only-shell chromium`，或在服务进程中设置 `MCP_CHROME_CHANNEL=chrome` 使用已安装的 Chrome。

### 本地接入（stdio）

登录白板，在「MCP 服务」左侧切换到「本地 stdio」，然后打开「安全授权」生成独立访问令牌。选择只读或读写和有效期，复制令牌后即可使用。本地 stdio 同时只允许一个有效令牌。轮换时先撤销旧令牌，再签发新令牌并更新客户端。由旧版本升级时，原服务端 `.env` 中的 `MCP_TOKEN` 已失效，客户端需换成页面签发的令牌。

在运行 MCP 客户端的机器上检出同版本源码并运行 `npm ci`。将 stdio 启动命令设为 `node /absolute/path/to/Excalink/src/mcp.js`，设置客户端环境变量 `MCP_BOARD_ORIGIN` 为白板根地址、`MCP_TOKEN` 为刚生成的令牌。调用 `describe_scene` 后，可以在「本地 stdio → 任务记录」查看白板服务收到的请求。这里独立保留最近 200 条服务端请求，重启后清空。

Mermaid 转换、PNG/SVG 导出和截图在 stdio 客户端机器渲染。在该机器运行 `npx playwright install --only-shell chromium`（Linux 加 `--with-deps`），或设置 `MCP_CHROME_CHANNEL=chrome` 使用已安装的 Chrome。工具范围见 [MCP 兼容表](../MCP_COMPATIBILITY.zh-CN.md)。
