extends Node

class ExampleActionAdapter:
	extends RefCounted

	func list_actions(_context: Dictionary) -> Dictionary:
		return {
			"revision": "example-1",
			"actions": [{
				"id": "example_wave",
				"label": "挥手",
				"description": "执行使用方提供的示例动作",
				"category": "example",
				"enabled": true,
			}],
		}

	func run_action(action_id: String, _arguments: Dictionary) -> Variant:
		if action_id != "example_wave":
			return {"ok": false, "error": "未知 action：%s" % action_id}
		return {"ok": true, "action_id": action_id}

var _adapter := ExampleActionAdapter.new()

func _ready() -> void:
	GodotMCPIngame.set_action_adapter(_adapter)

func _exit_tree() -> void:
	GodotMCPIngame.clear_action_adapter(_adapter)
