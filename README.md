# Godot MCP CLI

`godot-mcp` 是面向 Godot 4 项目的命令行自动化工具。CLI 是唯一公开入口，用于启动和停止项目、读取诊断、编辑资源与场景，以及通过游戏内 addon 执行通用 actions。

项目不再提供面向 Claude、Cursor 或其他客户端的 stdio MCP server。名称中的 `MCP` 作为项目和协议兼容标识保留；Godot addon 内部仍使用 JSON-RPC 2.0 与 MCP `tools/list` / `tools/call`，使用 CLI 的调用方不需要适配 MCP 客户端。

## 环境要求

- Godot 4
- Node.js 18 或更高版本
- npm

可通过 `GODOT_PATH` 指定 Godot 可执行文件；未指定时 CLI 会尝试自动发现。

## 安装

```bash
npm install -g .
godot-mcp --help
```

开发态也可以直接运行构建产物：

```bash
npm install
npm run build
node build/cli.js --help
```

## 公共 CLI

常用项目命令：

```bash
godot-mcp editor --path /path/to/project
godot-mcp run --path /path/to/project
godot-mcp stop --path /path/to/project
godot-mcp debug --filter "ERROR|WARNING"
godot-mcp version
godot-mcp info --path /path/to/project
godot-mcp list --dir /path/to/projects --recursive
```

资源、场景和 UID 操作：

```bash
godot-mcp resource read --project . --path res://data/item.tres
godot-mcp resource edit --project . --path res://data/item.tres --props '[{"path":"damage","value":10}]'
godot-mcp scene create --project . --path scenes/demo.tscn --root Node2D
godot-mcp scene add-node --project . --scene scenes/demo.tscn --type Sprite2D --name Icon
godot-mcp scene load-sprite --project . --scene scenes/demo.tscn --node Icon --texture assets/icon.png
godot-mcp scene save --project . --scene scenes/demo.tscn --new-path scenes/demo_variant.tscn
godot-mcp scene export-mesh-library --project . --scene scenes/tiles.tscn --output assets/tiles.res
godot-mcp uid get --project . --path assets/icon.png
godot-mcp uid update --project .
```

所有命令向 stdout 输出 JSON，并通过退出码表达成功或失败。具体参数以对应命令的 `--help` 为准。

## Ingame Addon

CLI 自带项目无关的 Godot addon。安装命令会复制 `addons/godot_mcp_ingame`，并注册 `GodotMCPIngame` autoload：

```bash
godot-mcp ingame install --path /path/to/project
```

默认内部端点为 `ws://127.0.0.1:9090`，项目可以通过 `godot_mcp/ingame/port` ProjectSetting 修改端口。

CLI 通过以下命令访问 addon：

```bash
godot-mcp ingame status
godot-mcp ingame list
godot-mcp ingame exec --tool <tool-name> --args '{}'
godot-mcp actions list
godot-mcp actions run <action-id> --args '{}'
```

## 通用 Actions 协议

addon 固定提供两个内部工具：

- `godot_mcp_actions_list`
- `godot_mcp_actions_run`

使用方只需要实现 adapter，不依赖特定游戏的 singleton 或命令名称：

```gdscript
class MyActionsAdapter:
	extends RefCounted

	func list_actions(_context: Dictionary) -> Dictionary:
		return {
			"revision": "menu-1",
			"actions": [{
				"id": "open_menu",
				"label": "打开菜单",
				"category": "menu",
				"enabled": true,
			}]
		}

	func run_action(action_id: String, arguments: Dictionary) -> Variant:
		return {"ok": true, "action_id": action_id, "arguments": arguments}

var actions_adapter := MyActionsAdapter.new()

func _ready() -> void:
	GodotMCPIngame.set_action_adapter(actions_adapter)
```

`list_actions(context)` 必须返回包含 `actions` 数组的对象。每个 action 必须有唯一且非空的 `id` 与 `label`；可选通用字段为 `description`、`category`、`enabled`、`argumentsSchema` 和 `metadata`。`run_action(action_id, arguments)` 可以返回任意可 JSON 序列化的结果。

`actions run` 会依次执行：读取执行前快照、执行 action、轮询更新后的 action envelope，最后返回 `{ execution, actions, revision, changed }`。瞬时轮询失败会按统一策略重试。

完整生命周期示例位于安装后的 `addons/godot_mcp_ingame/examples/action_adapter_example.gd`。

## Web 控制器

```bash
godot-mcp web --port 8080 --game-port 9090
```

Web 控制器通过同一个 addon actions 协议提供局域网按钮界面。

## 验证

```bash
npm test
npm run test:ingame-addon -- /path/to/godot
```

## License

MIT
