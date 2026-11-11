# MCP compatibility

The reference is yctimlin/mcp_excalidraw commit `81720ac819d2325177cd6137c6ad41d52d0f5374`. PersonalWhiteboard advertises all 27 tool names and supports upstream argument forms for current-canvas operations. The session pins the observed current generation. An unversioned mutation after another client switches boards is rejected until an explicit read, while versioned mutations can also guard the revision. Every persisted mutation performs a server-side compare-and-set.

| Tools | Arguments and behavior |
| --- | --- |
| `create_element`, `batch_create_elements`, `update_element`, `delete_element` | Flat Excalidraw arguments, upstream `elements` batch field, common styles and font aliases, labeled shapes and arrow endpoint bindings. Existing nested `shape` / `element`, `shapes`, `changes` and explicit version arguments remain supported. Updating an existing element's type is rejected. |
| `query_elements`, `get_element`, `describe_scene` | Type, property filter and origin bounding box, plus lookup and scene summary. Queries retain PersonalWhiteboard's versioned response envelope rather than adopting the upstream output shape. |
| `group_elements`, `ungroup_elements`, `lock_elements`, `unlock_elements`, `align_elements`, `distribute_elements`, `duplicate_elements` | `elementIds`, `groupId`, alignment, direction and duplicate offsets. Geometry operates on scene coordinates and may differ from the upstream implementation for complex or rotated selections. |
| `get_resource`, `get_selection`, `set_viewport`, `read_diagram_guide` | Scene, element and theme resources, live current-board selection, viewport modes and upstream guide. As upstream, the `library` resource returns current scene elements. Viewport control requires an open current-board window. |
| `export_scene`, `import_scene` | Inline Excalidraw JSON, including files. Import supports merge and replace. Arbitrary `filePath` is rejected. |
| `snapshot_scene`, `restore_snapshot`, `clear_canvas` | Up to four in-memory checkpoints per MCP connection. Restore is restricted to the original current-board generation. Clear requires `confirm: true`. |
| `create_from_mermaid`, `export_to_image`, `get_canvas_screenshot` | Local Chromium conversion and PNG/SVG output. Supports `auto` or `browser`; the upstream `node` renderer and local file output are unavailable. Browser rendering can differ from the upstream headless renderer. |
| `export_to_excalidraw_url` | Recognized with an explicit policy error. The board stays local. Use inline export or create a link through the whiteboard UI. |

Install browser tooling on the machine that launches MCP with `npm ci && npx playwright install chromium`. Set `MCP_CHROME_CHANNEL=chrome` to use a local Chrome installation. The browser runs on the MCP client host and uses the whiteboard's static renderer page. The Docker server image does not need a browser installed. The rendering path allows only the configured server's renderer and assets to load.

Run `npm run build && npm run verify:mcp` to exercise the entire tool catalog on an isolated loopback service. The test uses local Chrome.
