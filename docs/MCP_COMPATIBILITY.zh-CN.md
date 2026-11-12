# MCP 兼容性

简体中文 · [English](MCP_COMPATIBILITY.md) · [MCP 接入指南](deployment/README.md#连接-mcp)

上游参考为 yctimlin/mcp_excalidraw 的提交 `81720ac819d2325177cd6137c6ad41d52d0f5374`。Excalink 声明全部 27 个工具名称，并在当前白板操作中支持上游参数形式。每个会话记录最后观察到的白板代次。其他客户端切换白板后，未携带版本的修改会被拒绝，直到客户端显式读取当前白板。携带版本的修改还可校验修订号。每次持久化写入都在服务端比较版本后提交。

| 工具 | 参数与行为 |
| --- | --- |
| `create_element`、`batch_create_elements`、`update_element`、`delete_element` | 支持扁平 Excalidraw 参数、上游批量字段 `elements`、常用样式和字体别名、带标签图形及箭头端点绑定。仍支持嵌套的 `shape` / `element`、`shapes`、`changes` 和显式版本参数。已有元素的类型不可修改。 |
| `query_elements`、`get_element`、`describe_scene` | 支持类型、属性和坐标范围筛选，以及元素查找和场景摘要。查询结果使用 Excalink 自己的带版本响应结构。 |
| `group_elements`、`ungroup_elements`、`lock_elements`、`unlock_elements`、`align_elements`、`distribute_elements`、`duplicate_elements` | 支持 `elementIds`、`groupId`、对齐、分布方向和复制偏移。几何计算使用场景坐标，复杂选区或旋转元素的计算结果可能与上游不同。 |
| `get_resource`、`get_selection`、`set_viewport`、`read_diagram_guide` | 支持场景、元素和主题资源，当前白板选区、视口模式及上游绘图指南。`library` 资源与上游一样返回当前场景元素。控制视口需要打开当前白板窗口。 |
| `export_scene`、`import_scene` | 通过内联 Excalidraw JSON 传输场景及文件数据。导入支持合并和替换，任意 `filePath` 会被拒绝。 |
| `snapshot_scene`、`restore_snapshot`、`clear_canvas` | 每个连接最多保留四个内存检查点。仅能恢复到检查点对应的白板代次。清空需传入 `confirm: true`。 |
| `create_from_mermaid`、`export_to_image`、`get_canvas_screenshot` | 使用 Chromium 转换与生成 PNG/SVG，支持 `auto` 或 `browser`。上游 `node` 渲染器和本地文件输出不可用。浏览器渲染结果可能与上游无头渲染器不同。 |
| `export_to_excalidraw_url` | 客户端可发现此工具，调用会返回明确的限制错误。可通过内联导出或在白板界面创建分享链接。 |

Streamable HTTP 和 stdio 提供同一套工具。HTTP 模式由白板服务器运行 Chromium，仅加载构建内的渲染资源。Docker 镜像自带 Chromium。stdio 模式由客户端机器运行浏览器，加载配置好的白板渲染页和资源。使用 stdio 或直接以 Node.js 部署时，在运行渲染的一端执行 `npx playwright install --only-shell chromium`（Linux 加 `--with-deps`），或设置 `MCP_CHROME_CHANNEL=chrome` 使用已安装的 Chrome。远程 HTTP 支持 OAuth 授权或 API Key，工具权限规则相同。Mermaid 转换需要读写权限，PNG/SVG 导出和截图可用只读权限。

运行 `npm run build && npm run verify:mcp` 可在隔离的回环服务上测试完整工具目录，测试使用本机 Chrome。
