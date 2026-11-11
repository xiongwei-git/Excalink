# Excalink 宝塔部署

## 生产布局

- 域名：`https://excalink.tedxiong.com`
- 应用：独立 Docker Compose 项目 `excalink`
- 服务目录：`/www/services/excalink`
- 代码版本：`releases/db63434`，对应 GitHub 提交 `db6343497dd27fb7c677c6dc2fb0a132f9d52a59`
- 镜像：`excalink:db63434`，服务器原生构建 linux/amd64
- 回环上游：`http://127.0.0.1:14173`
- 数据：`excalink_whiteboard` 命名卷，容器内 `/data`
- 认证：原生 OIDC 对接 Tinyauth，仅允许已有个人账号对应的 subject
- 凭据：服务器 `.env` 权限 0600，不进入版本控制；MCP 使用独立随机令牌

## 运维

在服务目录运行 `docker compose ps` 和 `docker compose logs --tail=100` 检查应用。更新先备份数据卷，再创建独立 release 和镜像标签，修改 Compose 的镜像标签并重建。回滚恢复前一镜像标签并重建，数据迁移须另行评估。禁止 `down -v`。

Nginx 需要保留 Host、传递 WebSocket Upgrade，允许约 22 MB 请求体，关闭代理缓冲。分享令牌及 OIDC 回调参数不得写入访问日志；本站关闭访问日志、错误日志使用 crit 级别。TLS 证书复用服务器现有通配符证书，不复制私钥到仓库。

Tinyauth 新增独立 `excalink` 客户端，回调为 `https://excalink.tedxiong.com/auth/callback`。此次变更前的认证 Compose 备份保存在服务器服务目录；恢复备份会移除该客户端，应先停用本站登录并核查之后是否有其他认证配置变更。

## 验收状态

2026-11-11 已上线，部署代码为 `db63434`。

- 服务器 linux/amd64 镜像构建成功；容器以 node 用户运行，自动重启，仅监听回环 14173。
- 宝塔反代通过面板原生模块创建和保存（由已验证的 SSH 调用与 MCP 工具相同的操作函数），未直接覆盖 Nginx 配置或手写面板数据库。
- Nginx 语法通过；HTTP 301 转 HTTPS；证书匹配域名，有效期至 2027-01-21。
- 匿名读取当前画布、档案和 MCP 接口均返回 401；HTTPS 下合法 MCP 令牌可读回当前画布。
- 使用唯一测试元素验证 MCP 写入及强制重建容器后的持久化，之后已通过版本校验恢复原始空白画布。
- 浏览器首页可加载，登录按钮进入 Tinyauth 登录页。真实账号登录回调、登录后保存/分享及跨浏览器 WebSocket 协作尚待实际账号验收；此前本机测试不替代本次生产验收。
- SSL 与强制 HTTPS 在面板反代 JSON 中均已复核为启用。证书后续续期是否自动覆盖新站点尚未验收。
