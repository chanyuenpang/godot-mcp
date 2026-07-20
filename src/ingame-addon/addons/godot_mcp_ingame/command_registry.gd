extends RefCounted

class ToolEntry:
	var name: String
	var description: String
	var input_schema: Dictionary
	var handler: Callable

	func _init(p_name: String, p_description: String, p_input_schema: Dictionary, p_handler: Callable) -> void:
		name = p_name
		description = p_description
		input_schema = p_input_schema
		handler = p_handler

var _tools: Dictionary = {}
var _executing := false

func register_tool(tool_name: String, description: String, input_schema: Dictionary, handler: Callable) -> void:
	if tool_name.strip_edges().is_empty():
		push_error("[GodotMCPIngame] 工具名称不能为空")
		return
	if not handler.is_valid():
		push_error("[GodotMCPIngame] 工具 '%s' 的 handler 无效" % tool_name)
		return
	_tools[tool_name] = ToolEntry.new(tool_name, description, input_schema.duplicate(true), handler)

func unregister_tool(tool_name: String) -> void:
	_tools.erase(tool_name)

func has_tool(tool_name: String) -> bool:
	return _tools.has(tool_name)

func list_tools() -> Array:
	var result: Array = []
	var names: Array = _tools.keys()
	names.sort()
	for tool_name in names:
		var entry: ToolEntry = _tools[tool_name]
		result.append({
			"name": entry.name,
			"description": entry.description,
			"inputSchema": entry.input_schema.duplicate(true),
		})
	return result

func call_tool(tool_name: String, arguments: Dictionary) -> Dictionary:
	if not _tools.has(tool_name):
		return {"success": false, "error": "工具 '%s' 不存在" % tool_name}
	if _executing:
		return {"success": false, "error": "上一个游戏内工具仍在执行"}

	_executing = true
	var entry: ToolEntry = _tools[tool_name]
	var result: Variant = await entry.handler.call(arguments)
	_executing = false
	return {"success": true, "result": result}
