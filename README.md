# Excalink

基于 Excalidraw 的个人自托管白板，支持 AI 通过 MCP 操作、服务端自动保存、档案管理与分享协作。首页始终是当前画布；保存后的档案有固定地址；分享当前画布会建立独立副本，访客共同编辑这份副本。

## 部署前选择

Excalink 是单人管理的白板服务，不是多用户 SaaS；没有账号注册、用户管理后台或每人独立空间。目前只能选择一种登录模式。

| 使用方式 | `AUTH_MODE` | 谁能管理当前白板和档案 |
| --- | --- | --- |
| 不需要账号 | `public` | 所有能访问服务的人 |
| 使用本地用户名和密码 | `password` | 配置的唯一账号 |
| 使用已有统一身份认证 | `oidc` | 指定身份提供方、指定客户端下的唯一 `sub` |

仓库默认是 `public`，并且只映射本机回环端口。对外提供私人白板时，先选择 `password` 或 `oidc`，再开放域名。认证不会为不同登录者创建不同白板。

## Docker Compose 部署（推荐）

需要 Git、Docker Engine 和 Docker Compose v2。采用源码构建，无需在宿主机安装 Node.js。

```sh
git clone https://github.com/xiongwei-git/Excalink.git
cd Excalink
cp .env.example .env
chmod 600 .env
```

先按下方认证章节编辑 `.env`，再构建和启动：

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 whiteboard
```

默认访问 <http://127.0.0.1:4173>。镜像采用多阶段构建，仅保留生产依赖，以非 root 的 `node` 用户运行；Compose 启用 init 和自动重启。

### 端口、域名和数据

本机使用示例：

```dotenv
EXCALINK_PORT=4173
APP_ORIGIN=http://127.0.0.1:4173
AUTH_MODE=public
```

服务器经 HTTPS 反向代理访问的示例：

```dotenv
EXCALINK_PORT=14173
APP_ORIGIN=https://board.example.com
AUTH_MODE=oidc
# 还需要填写下方 OIDC 配置，不能仅设置 AUTH_MODE。
```

- `EXCALINK_PORT` 是宿主机端口；容器内仍为 `4173`。默认绑定 `127.0.0.1`，同机 Nginx 可转发到 `http://127.0.0.1:14173`。
- `APP_ORIGIN` 是浏览器实际访问的完整源地址（协议、域名、非默认端口），不含路径。它参与 Host、Origin 校验、Cookie 和 OIDC 回调构造。直接通过本机端口访问时，两项端口要一致；使用反代时，填写外部域名，不填内部上游地址。
- 使用专用域名部署在 `/`，当前未实现子路径部署配置。
- 画布、档案、图片保存在 `whiteboard` 命名卷的 `/data` 中。实际卷名通常为 `<Compose项目名>_whiteboard`。更新时保持项目名一致，否则可能创建新卷，看起来像数据丢失。
- 普通停止、重建容器不删除数据；**不要执行 `docker compose down -v`，它会删除数据卷。**

### 修改配置、更新和停止

修改 `.env` 后执行以下命令，使容器重新读取环境变量；仅运行 `docker compose restart` 不会应用新的环境变量。

```sh
docker compose up -d --force-recreate
```

更新代码前先备份数据，在原目录、原 Compose 项目名下执行：

```sh
git pull --ff-only
docker compose up --build -d
```

停止但保留数据：

```sh
docker compose down
```

## 不使用 Docker：Node.js 部署

需要 Node.js 22.12 或以上，以及 npm。

```sh
git clone https://github.com/xiongwei-git/Excalink.git
cd Excalink
npm ci
npm run build
cp .env.example .env
chmod 600 .env
# 编辑 .env 后启动：
node --env-file=.env src/server.js
```

`npm start` 也能启动服务，但不自动加载 `.env`；使用它时需要由进程管理器或 shell 注入环境变量。

| 变量 | Node.js 直接部署时的默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4173` | 应用监听端口；直接部署不用 `EXCALINK_PORT` |
| `BIND_HOST` | `127.0.0.1` | 默认仅本机访问；通过同机 Nginx 代理无需修改 |
| `BOARD_DATA_DIR` | 当前工作目录下的 `data` | 建议生产使用固定绝对路径，并授予运行用户写权限 |
| `APP_ORIGIN` | `http://127.0.0.1:<PORT>` | 对外地址，必须与实际访问入口一致 |

生产运行应通过 systemd 等进程管理器托管，并固定工作目录。仅支持单进程、单写者，同一数据目录不能交给多个实例同时使用。

## 配置账号与认证

所有示例都写入部署目录的 `.env`，不是修改源代码。切换模式后按前面的命令重建容器；Node.js 直接部署则重启应用进程。不要提交 `.env`、密码、客户端密钥或令牌到 Git。

### 方式一：不需要账号

```dotenv
AUTH_MODE=public
APP_ORIGIN=http://127.0.0.1:4173
```

不需要设置用户名、密码或 OIDC 参数。此模式没有登录保护：访问者可以读写当前白板、访问档案并执行管理操作，不是“仅公开查看”。公网启用此模式意味着向所有访问者开放这些能力。

### 方式二：用户名和密码

配置一个管理账号，不需要另建数据库或在页面注册：

```dotenv
AUTH_MODE=password
APP_ORIGIN=https://board.example.com
AUTH_USERNAME=admin
PASSWORD_HASH=替换为下方生成的完整哈希
```

`admin` 是示例用户名，可自行修改。**没有默认密码，不能把明文密码直接填入 `PASSWORD_HASH`。** 哈希格式为 `32位十六进制盐:128位十六进制派生值`，使用随机 16 字节盐、Node.js scrypt 默认参数及 64 字节输出。

在终端生成兼容哈希（需要 Python 3 和已构建的 Docker 镜像）：

```sh
docker compose build
python3 - <<'PYCODE'
import getpass
import subprocess

password = getpass.getpass("设置白板密码（输入不回显）: ")
confirmation = getpass.getpass("再次输入密码: ")
if not password or password != confirmation:
    raise SystemExit("密码为空或两次输入不一致，未生成哈希")
code = """
const { randomBytes, scryptSync } = require('node:crypto');
const password = require('node:fs').readFileSync(0, 'utf8');
const salt = randomBytes(16);
console.log('PASSWORD_HASH=' + salt.toString('hex') + ':' +
  scryptSync(password, salt, 64).toString('hex'));
"""
subprocess.run(
    ["docker", "run", "--rm", "-i", "--entrypoint", "node",
     "excalink:local", "-e", code],
    input=password.encode("utf-8"), check=True,
)
PYCODE
```

复制输出的整行 `PASSWORD_HASH=...`，替换 `.env` 中同名项，避免保留重复配置。此命令不把明文密码放进命令行参数或 shell 历史。纯 Node.js 部署时，将脚本中 `subprocess.run` 的命令列表替换为 `["node", "-e", code]`，其他部分保持不变。

重建容器后，用 `AUTH_USERNAME` 和刚才输入的明文密码登录。修改或忘记密码时重新生成哈希并替换配置，再重建容器；不需要重建数据卷。应用没有邮件找回密码功能。

### 方式三：OIDC / 统一身份认证

应用通过标准 OpenID Connect 授权码流程登录，使用 PKCE、state、nonce 与 ID Token 签名校验。只请求 `openid` scope，当前没有 SAML、LDAP、通用 OAuth2 或反代身份请求头直接登录适配。

对接 Tinyauth 或其他 OIDC 身份服务时：

1. 在身份服务中创建 Excalink 专用的服务端 Web / confidential 客户端，启用授权码流程，并获取 Client ID、Client Secret。当前客户端默认采用 `client_secret_post` 客户端认证方式，提供方需允许此方式。
2. 精确登记回调地址 `https://board.example.com/auth/callback`，其中源地址必须与 `APP_ORIGIN` 一致。不要填首页，也不要随意增加末尾斜杠。
3. 获取提供方的 **issuer** 和允许登录用户在此客户端下的 **subject（ID Token 中的 `sub`）**。
4. 填写 `.env`，重建应用后点击“使用身份服务登录”。

```dotenv
AUTH_MODE=oidc
APP_ORIGIN=https://board.example.com
OIDC_ISSUER=https://auth.example.com
OIDC_CLIENT_ID=替换为客户端ID
OIDC_CLIENT_SECRET='替换为客户端密钥'
OIDC_SUBJECT=替换为允许用户的sub
```

变量的具体含义：

| 变量 | 如何填写 |
| --- | --- |
| `OIDC_ISSUER` | 身份服务公布的 issuer 原值；可能包含租户或 realm 路径。不是登录页、授权端点或 discovery 文档 URL。应用通过它执行 discovery。 |
| `OIDC_CLIENT_ID` | 新建客户端的 ID，不是用户 ID。 |
| `OIDC_CLIENT_SECRET` | 同一客户端的密钥，支持用 `.env` 单引号避免 Compose 对 `$` 等字符插值；不要暴露或提交。 |
| `OIDC_SUBJECT` | 目标用户通过这个客户端认证后，由提供方签发的 ID Token 中的 `sub`，精确匹配。不是默认等于邮箱、用户名或客户端 ID。 |

**如何确定 `sub`：** 优先使用身份服务管理员界面或该提供方支持的身份调试方式核实。提供方可能对不同客户端生成不同的 `sub`，不能直接照搬另一个应用中的值。若需查看 Token，请仅在可信本地环境处理，不上传到在线解码网站。不要通过临时取消用户校验来获取它。

身份服务必须能从应用容器访问，并使用容器信任的 HTTPS 证书。`localhost` 在容器内指容器本身，不是宿主机。OIDC discovery 在应用启动时执行；配置缺失、issuer 不可达或证书不受信任会导致启动失败。

#### Tinyauth 配置示例

本项目已用 Tinyauth v5.2.0 完成隔离登录测试。以下片段添加到**现有 Tinyauth 服务**的 Compose 中，不是 Excalink 的 Compose；保留其他客户端和原有配置：

```yaml
services:
  tinyauth:
    environment:
      TINYAUTH_OIDC_CLIENTS_EXCALINK_CLIENTID: excalink
      TINYAUTH_OIDC_CLIENTS_EXCALINK_CLIENTSECRETFILE: /run/secrets/excalink-client-secret
      TINYAUTH_OIDC_CLIENTS_EXCALINK_TRUSTEDREDIRECTURIS: https://board.example.com/auth/callback
      TINYAUTH_OIDC_CLIENTS_EXCALINK_NAME: Excalink
    volumes:
      - ./secrets/excalink-client-secret:/run/secrets/excalink-client-secret:ro
```

在 Tinyauth 的部署目录生成独立客户端密钥（需要 OpenSSL，目标文件已存在则不要覆盖）：

```sh
mkdir -p secrets
(umask 077; set -C; openssl rand -hex 32 > secrets/excalink-client-secret)
```

确保文件归属允许 Tinyauth 容器运行用户读取，保持受限权限，不要为了可读而改成全员可读。将同一密钥通过私密配置流程填入 Excalink 的 `OIDC_CLIENT_SECRET`，不要粘贴到聊天或 Git。此示例中的文件是普通只读挂载，不会由 Compose 自动生成。重新应用 Tinyauth 的 Compose，再启动或重建 Excalink。

本项目测试的 Tinyauth v5.2.0 本地用户名账号采用 `UUIDv5(URL namespace, 用户名 + ":" + Client ID)` 作为 subject，可按以下方式计算（用户名和 Client ID 均不是密码）：

```sh
python3 - <<'PYCODE'
import uuid
username = input("Tinyauth 本地用户名: ")
client_id = input("Excalink Client ID: ")
print("OIDC_SUBJECT=" + str(uuid.uuid5(uuid.NAMESPACE_URL, username + ":" + client_id)))
PYCODE
```

该计算方式仅对应已测试的 Tinyauth 版本和本地账号方式；其他版本、外部登录来源或其他身份服务应以实际签发的 `sub` 为准。修改统一认证配置前先备份，重建 Tinyauth 会短暂影响依赖它登录的其他应用。

#### 其他身份服务

其他提供标准 OIDC 的服务可按上面的通用流程配置，无需使用 Tinyauth 专有变量。应逐项确认 discovery、授权码、PKCE S256、`client_secret_post` 和签名 ID Token 的支持情况。当前没有逐个验收其他提供方，不能仅凭配置项存在就认为兼容已验证。

如果组织账号原本来自 LDAP、SAML 等体系，可以由支持它们的身份网关向 Excalink 提供 OIDC；Excalink 本身不直接连接这些协议。仅在 Nginx 外面加认证代理并不等于应用启用了 OIDC：设置 `AUTH_MODE=public` 时，应用仍会把任何到达后端的请求视为管理者。

### 登录会话与切换行为

- 登录会话保存在应用内存中，有效期为 8 小时；服务重启或重建后需要重新登录。
- 修改认证模式不会删除白板或档案。切换为 `public` 会取消它们的登录保护，原本私有的内容将可由访问者访问。
- OIDC 只允许配置的一个 `sub`；其他在身份服务中有效的账号也不能管理此白板。
- 已有分享链接是独立的访问凭据，修改密码、切换登录方式或退出登录不等于撤销分享；要停用分享，应在白板中明确撤销。

## 域名、HTTPS 与宝塔反向代理

先启动并验证应用，再在宝塔创建反代站点：域名指向服务器，上游使用实际回环端口，例如 `http://127.0.0.1:14173`，部署域名证书并开启强制 HTTPS。

反代需保留 Host、传递 WebSocket Upgrade，允许 22 MB 请求体并关闭缓冲。以下为 **HTTPS server 块中的关键配置**，不是可直接覆盖整份宝塔站点配置的文件：

```nginx
client_max_body_size 22m;
# 分享路径和 OIDC 回调含访问凭据，本站默认不记录访问日志。
access_log off;
error_log /www/wwwlogs/excalink.error.log crit;
location / {
    proxy_pass http://127.0.0.1:14173;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}
```

反代后不要再用 IP 或另一个域名访问应用，除非同时调整 `APP_ORIGIN`。Nginx 若也运行在容器中，`127.0.0.1` 不指向宿主机，应按实际网络配置上游。

不要对整个站点追加统一强制登录而忽略分享路径：`/share/…`、`/api/share/…` 及其 WebSocket 连接需要按分享令牌访问，MCP 接口则使用自己的 Bearer 令牌。推荐使用应用原生认证，让应用负责这些边界。

本项目现有宝塔部署及验收范围见 [部署记录](docs/deployment/BAOTA.md)。这是一份具体环境记录，通用部署不要求复用其中的域名或服务路径。

## 分享权限

在 `password` / `oidc` 模式下，当前白板和档案默认要求管理者登录；主动创建的分享链接允许持链接者免登录编辑对应文档。目前没有只读分享、分享过期或访客账号管理。

分享当前画布会创建独立文档，所有协作者进入同一份共享文档；首页当前画布仍独立。撤销分享会拒绝该链接的后续读写并断开已连接访客。在 `public` 模式下，撤销仅停用分享地址，不能阻止访问原文档地址。

若本地草稿与服务端版本冲突，可先导出本地草稿，再重新打开服务端最新版本，避免覆盖他人修改。

## 配置自检与常见问题

在部署机器执行以下检查。将域名替换为实际地址：

```sh
docker compose ps
docker compose logs --tail=100 whiteboard
curl -sS https://board.example.com/auth/session
curl -sS -o /dev/null -w '%{http_code}\n' https://board.example.com/api/current
```

未登录时，`password` / `oidc` 的 session 应显示 `owner: false`，当前画布接口应返回 `401`；`public` 则会显示 `owner: true` 并允许读写。这是模式行为，不是登录异常。

| 现象 | 优先检查 |
| --- | --- |
| 修改 `.env` 后不生效 | 是否在正确部署目录修改、是否运行 `up -d --force-recreate`；检查 shell 同名变量是否覆盖 Compose `.env`。 |
| 访问返回 `403` | `APP_ORIGIN` 是否与浏览器地址一致，反代是否保留 Host；不要用内部 IP 代替配置域名。 |
| 密码模式启动失败 | `AUTH_USERNAME` 是否非空，`PASSWORD_HASH` 是否为完整 scrypt 格式。 |
| 登录后仍回到登录页 | HTTPS 地址和 Cookie 是否匹配；是否在登录过程中重启了应用。 |
| OIDC 服务启动失败 | issuer、网络、容器 CA 信任、Client ID 和 Client Secret 是否正确。 |
| OIDC 回跳显示失败 | 回调地址是否精确一致、`sub` 是否匹配当前客户端、流程是否超过 5 分钟或被重启中断。 |
| 分享协作不能实时更新 | Nginx WebSocket Upgrade 是否启用，是否被额外登录代理拦截。 |
| 密码登录返回 `429` | 等待一分钟后重试；当前按连接 IP 限流，同机反代下可能共用额度。 |

配置生效不代表完整验收：还应实际完成登录、画图、刷新恢复、保存档案、分享协作和撤销分享。不要将带 Cookie、Token 或 OIDC 回调参数的日志粘贴到公开问题中。

## MCP

服务端与本地 MCP 客户端使用同一个随机令牌 `MCP_TOKEN`，至少 32 字符。未设置或少于 32 字符时，MCP HTTP 接口拒绝认证。MCP 客户端使用 stdio，启动命令为 `node /absolute/path/to/Excalink/src/mcp.js`。在客户端环境设置 `MCP_BOARD_ORIGIN` 和 `MCP_TOKEN`。

MCP 工具和参数见 [兼容表](docs/MCP_COMPATIBILITY.md)。工具仅作用于当前画布。图片导出与 Mermaid 转换需要在启动 MCP 的机器安装 Playwright Chromium，也可用 `MCP_CHROME_CHANNEL=chrome` 选择本机 Chrome。

## 数据与验证

`data/state.json` 记录当前画布及档案索引，`data/scenes/` 保存含图片数据的独立 `.excalidraw` 文件。备份和恢复时以整个数据目录为单位，推荐停写后操作。新建和归档通过一次索引替换提交。历史 scene 文件暂保留，部署时需监测卷大小。

运行 `npm test` 检查存储、并发和归档。运行 `docker compose build && npm run verify:docker` 验证容器启动、非 root 用户以及重建后的当前画布和档案持久化；验证使用独立临时项目及合成数据，结束后仅清理该临时项目。项目范围见 [需求](docs/REQUIREMENTS.md)、[设计](docs/DESIGN.md) 和 [验收](docs/ACCEPTANCE.md)。第三方依赖及字体来源见 [归属清单](notices/README.md)。项目发布许可证待定。

可重复联调命令包括 `npm run verify:mcp`、`npm run verify:tinyauth` 和 `npm run verify:zoom`。Tinyauth 测试需要 Docker、Chrome、OpenSSL 和 curl，使用隔离实例和一次性账号。缩放验收使用支持加载本地测试扩展的 Chromium，可用 `PWB_CHROMIUM` 指定可执行文件。
