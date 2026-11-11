# 项目进度
home: macmini
category: personal-service
runtime: Node.js loopback preview
repository_model: single-repo
source_of_truth: GitHub xiongwei-git/Excalink
git_platform: github
git_visibility: public
origin_role: authoritative
sync: git
status: active
last_reviewed: 2026-11-11

已在小咪工作区新建独立项目，需求见 docs/REQUIREMENTS.md。用户授权开始一期实现，未授权公开发布或修改生产服务。
当前已打通 Excalidraw 本机预览与单进程存储，具体限制见验收记录。

## 2026-11-11 本机画布
- GitHub 已恢复可读。实测克隆 yctimlin/mcp_excalidraw，HEAD 为 `81720ac819d2325177cd6137c6ad41d52d0f5374`，读取 LICENSE 为 MIT。上游元素 REST API 与本站 scene API 不兼容，MCP 接续需要适配 revision/generation 和限定工具范围。
- 使用 Excalidraw npm 包 0.18.1，添加浏览器画布和回环 HTTP 服务。支持当前白板自动保存、重开、复制、先归档再新建、文件地址和重命名、已保存白板手动保存。
- 本机构建、7 项核心测试、Chrome 画布闭环通过。可访问性与部署仍有待验收，详见 docs/ACCEPTANCE.md。
- 后续接入当前白板专用 MCP、分享与实时同步、密码/OIDC、Docker。存储仍集中在单一 JSON。生产依赖审计报告 12 项发现，发布前评估处理。
## 2026-11-10 初始实施
- 已创建独立 Git 仓库，未创建远端或发布。
- src/store.js：原子状态文件替换、单进程串行事务、revision 乐观并发控制、generation 切换防迟到写、当前白板与归档隔离。
- src/current-board-service.js：当前白板专用内部门面，拒绝指定保存文件。它不是完整 MCP 传输或鉴权实现。
- npm test：7项通过。无 UI、Docker、真实 MCP 或 OIDC 端到端测试，不能称为产品完成。
- 存储第一版将归档集中于 state.json；后续需完成独立 scene 文件导出/存储模型、备份、断电耐久性和跨进程锁。当前只支持单服务进程。
- 阻碍：git ls-remote 的 github.com:443 访问被环境策略拒绝，没有绕过或反复重试。需恢复授权的工程网络访问，才能核实上游与安装集成依赖。

## 2026-11-11 一期整合预览
- 重做工作台顶栏、档案侧栏和分享弹窗，保持原生画布。完成共享副本、连接撤销、WebSocket 推送、密码与 OIDC 认证、本机 Docker 构建、独立 scene 文件和当前白板 MCP。
- 已有内嵌归档仍可读取，首次有写入时转换为独立文件。以整个数据目录为备份单位，单进程，历史 scene 文件暂保留。
- MCP 目前暴露 12 个工具，其中基础读写、分组、锁定、清空、批量创建和导出 JSON 已实现。上游全部工具及参数兼容未完成。
- 核心测试、Chrome、测试 OIDC、Docker 持久化和三档首页 axe 通过，生产依赖审计 0 项发现。真实 Tinyauth、完整视觉及无障碍、生产部署与授权发布未验收。

## 2026-11-11 一期收尾
- 新增上游 MCP 参数适配、选择与视口、检查点、Mermaid、本机 PNG/SVG，27 个工具名称均经 stdio 测试。任意文件路径、外部上传及非当前画板目标保持拒绝。其他差异见 docs/MCP_COMPATIBILITY.md。
- Tinyauth v5.2.0 官方镜像实测通过，采用隔离服务和临时账号。真实部署配置仍由将来的部署方提供。
- 主工作流原生 Chrome 200% 缩放、键盘焦点、320 CSS px 重排及分享弹窗 axe 已验证。新增可重复联调脚本。
- 第三方归属见 notices/README.md，旧版 Liberation Sans 1.05 精确许可待补证，项目源码许可证尚未选择。

## 2026-11-11 整体 UI 重设计
- 工作台换为浅石色边框与钴蓝主操作，独立文档栏，桌面档案并排、窄屏档案浮层，重命名按需打开，重新设计分享和登录。
- 验证桌面及窄屏截图、原生 200% 缩放和键盘、主要状态 axe、保存和协作浏览器回归。详见 docs/DESIGN.md 和 docs/ACCEPTANCE.md。

## 2026-11-11 工作流修订
- 使用本机 ui-ux-pro-max 和 frontend-design。调整档案搜索与响应布局，加入归档确认、保存回执、分享副本确认和就地反馈，覆盖忙碌、取消与重试。小咪 4175 本机预览使用更新后的前端。
- 关键交互使用隔离测试数据验证，另检查真实桌面和手机截图、原生 200% 缩放、键盘和主要状态 axe。详见 docs/ACCEPTANCE.md。

## 全窗口画布调整
- 参考 Excalicord 的画布优先布局。撤掉常驻应用顶栏和底栏，将文档命令并入 Excalidraw 白板菜单。档案改为按需浮层，画布始终占满视口。


## 2026-11-11 Ink 全站重设计
- 用户明确选择 Hallmark Ink / paper 并授权整体Web重设计。统一中性黑灰与青绿状态色，新增单点tokens/base样式；保留中文系统字阶、全窗口画布及业务处理器。深色是项目扩展，危险色保留。
- 重排登录、档案索引、分享等浮层，统一原生菜单/属性/素材库/帮助，修复深色继承文字和原生可访问名称。
- 构建、9项核心测试、28状态浏览器验收、原生200%缩放与320px重排通过；独立设计审查指出的问题修复并复核。详情见docs/ACCEPTANCE.md及.hallmark/verification/。
- 已有4175回环预览使用新构建。未对外发布、未提交Git；原有未跟踪文件保留，局部备份在.hallmark/backups/。
- 用户指出右下角“已载入”青绿胶囊与全局不符，已改为14px中性次要文字，保存回执同样去除彩底。1181/320px浅深色检查通过，新构建已更新本机预览。

## 原生白板边界与外围精简
- 用户明确要求原生Excalidraw不定制，仅外围UI采用Ink。已撤销原生主题CSS并限制基础样式作用域；原生字体/字号/颜色/圆角等保持上游。此前统一原生14px等要求被本次用户指令覆盖。
- 用户要求隐藏素材库入口，已精确隐藏入口label（包括键盘焦点），未禁用所有内部素材库能力。
- 用户要求右下角名称/已载入/已保存等全部移除；已删除常驻文字和保存回执，只在实际处理或保存时出现加载图标。错误与重命名操作保留。
- 构建、4组上游计算样式对比、1181/320px截图/axe、加载图标请求生命周期与分享弹窗检查通过。

## 2026-11-11 Excalink Docker 与 GitHub 交付
- 用户明确授权将当前代码 Docker 化并上传到 git@github.com:xiongwei-git/Excalink.git；远端检查为空的公开仓库。此次授权覆盖代码上传，不包含生产服务部署或镜像仓库发布。
- 产品 README、npm 包名与 MCP 服务名采用 Excalink；保留本机工作区路径和原有数据卷命名。
- 沿用多阶段非 root Dockerfile；Compose 增加 init、自动重启和可配置回环端口，Docker 构建上下文采用源码白名单。新增隔离容器持久化验证脚本。
- 项目源码许可证仍待选择，Liberation Sans 精确二进制许可待补证；此次不上传构建产物或字体二进制。

- 本次 MCP 回归27个工具名称全部通过，含 Mermaid、PNG/SVG、视口和边界拒绝；修正验证脚本对已移除“已载入”文字的过时等待。Docker 持久化验证和9项核心测试通过。
