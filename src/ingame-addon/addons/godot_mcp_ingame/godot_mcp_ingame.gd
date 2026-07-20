extends Node

const CommandRegistryClass = preload("res://addons/godot_mcp_ingame/command_registry.gd")

const PROTOCOL_VERSION := "2024-11-05"
const SERVER_NAME := "godot-mcp-ingame"
const SERVER_VERSION := "0.1.2"
const ACTIONS_LIST_TOOL := "godot_mcp_actions_list"
const ACTIONS_RUN_TOOL := "godot_mcp_actions_run"
const DEFAULT_PORT := 9090
const BIND_ADDRESS := "127.0.0.1"

const JSONRPC_PARSE_ERROR := -32700
const JSONRPC_INVALID_REQUEST := -32600
const JSONRPC_METHOD_NOT_FOUND := -32601
const JSONRPC_INVALID_PARAMS := -32602
const JSONRPC_INTERNAL_ERROR := -32603

signal server_started(port: int)
signal server_stopped()
signal client_connected(client_id: int)
signal client_disconnected(client_id: int)

var _tcp_server := TCPServer.new()
var _peers: Dictionary = {}
var _next_peer_id := 1
var _registry = CommandRegistryClass.new()
var _action_adapter: Object
var _port := DEFAULT_PORT
var _running := false

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_register_action_protocol()
	_port = int(ProjectSettings.get_setting("godot_mcp/ingame/port", DEFAULT_PORT))
	_start_server()

func _process(_delta: float) -> void:
	if _running:
		_poll_server()

func _exit_tree() -> void:
	_stop_server()

## 注册项目自有 MCP tool。handler 签名：func(arguments: Dictionary) -> Variant。
func register_tool(tool_name: String, description: String, input_schema: Dictionary, handler: Callable) -> void:
	_registry.register_tool(tool_name, description, input_schema, handler)

func unregister_tool(tool_name: String) -> void:
	if tool_name == ACTIONS_LIST_TOOL or tool_name == ACTIONS_RUN_TOOL:
		push_error("[GodotMCPIngame] 不能注销 actions 协议内置工具")
		return
	_registry.unregister_tool(tool_name)

## adapter 必须实现 list_actions(context) 和 run_action(action_id, arguments)。
func set_action_adapter(adapter: Object) -> void:
	if adapter == null:
		_action_adapter = null
		return
	if not adapter.has_method("list_actions") or not adapter.has_method("run_action"):
		push_error("[GodotMCPIngame] actions adapter 必须实现 list_actions 和 run_action")
		return
	_action_adapter = adapter

func clear_action_adapter(adapter: Object = null) -> void:
	if adapter == null or adapter == _action_adapter:
		_action_adapter = null

func is_server_running() -> bool:
	return _running

func get_server_port() -> int:
	return _port

func _register_action_protocol() -> void:
	register_tool(
		ACTIONS_LIST_TOOL,
		"列出使用方 action adapter 当前公开的通用 actions。",
		{
			"type": "object",
			"properties": {"context": {"type": "object"}},
			"required": [],
		},
		_list_actions,
	)
	register_tool(
		ACTIONS_RUN_TOOL,
		"执行 action adapter 公开的 action。",
		{
			"type": "object",
			"properties": {
				"action_id": {"type": "string"},
				"arguments": {"type": "object"},
			},
			"required": ["action_id"],
		},
		_run_action,
	)

func _list_actions(arguments: Dictionary) -> Variant:
	if _action_adapter == null:
		return _protocol_error("尚未注册 actions adapter")
	var context: Variant = arguments.get("context", {})
	if typeof(context) != TYPE_DICTIONARY:
		return _protocol_error("context 必须是对象")
	var result: Variant = await _action_adapter.call("list_actions", context)
	return _validate_action_list(result)

func _run_action(arguments: Dictionary) -> Variant:
	if _action_adapter == null:
		return _protocol_error("尚未注册 actions adapter")
	var action_id := String(arguments.get("action_id", "")).strip_edges()
	if action_id.is_empty():
		return _protocol_error("action_id 不能为空")
	var action_arguments: Variant = arguments.get("arguments", {})
	if typeof(action_arguments) != TYPE_DICTIONARY:
		return _protocol_error("arguments 必须是对象")
	return await _action_adapter.call("run_action", action_id, action_arguments)

func _validate_action_list(value: Variant) -> Variant:
	if typeof(value) != TYPE_DICTIONARY:
		return _protocol_error("list_actions 必须返回包含 actions 数组的对象")
	var envelope: Dictionary = value
	if not envelope.has("actions") or typeof(envelope["actions"]) != TYPE_ARRAY:
		return _protocol_error("list_actions 返回值缺少 actions 数组")
	var seen := {}
	for index in range(envelope["actions"].size()):
		var candidate: Variant = envelope["actions"][index]
		if typeof(candidate) != TYPE_DICTIONARY:
			return _protocol_error("actions[%d] 必须是对象" % index)
		var action: Dictionary = candidate
		var action_id := String(action.get("id", "")).strip_edges()
		var label := String(action.get("label", "")).strip_edges()
		if action_id.is_empty() or label.is_empty():
			return _protocol_error("actions[%d] 必须包含非空 id 和 label" % index)
		if seen.has(action_id):
			return _protocol_error("action id '%s' 重复" % action_id)
		for field in ["description", "category"]:
			if action.has(field) and typeof(action[field]) != TYPE_STRING:
				return _protocol_error("action '%s' 的 %s 必须是字符串" % [action_id, field])
		if action.has("enabled") and typeof(action["enabled"]) != TYPE_BOOL:
			return _protocol_error("action '%s' 的 enabled 必须是布尔值" % action_id)
		for field in ["argumentsSchema", "metadata"]:
			if action.has(field) and typeof(action[field]) != TYPE_DICTIONARY:
				return _protocol_error("action '%s' 的 %s 必须是对象" % [action_id, field])
		seen[action_id] = true
	if envelope.has("revision") and typeof(envelope["revision"]) != TYPE_STRING:
		return _protocol_error("revision 必须是字符串")
	return envelope

func _protocol_error(message: String) -> Dictionary:
	return {"__godot_mcp_error": message}

func _start_server() -> void:
	if _tcp_server.is_listening():
		_tcp_server.stop()
	var error := _tcp_server.listen(_port, BIND_ADDRESS)
	if error != OK:
		push_error("[GodotMCPIngame] 无法监听 %s:%d，错误码=%d" % [BIND_ADDRESS, _port, error])
		return
	_running = true
	server_started.emit(_port)
	print("[GodotMCPIngame] 已监听 %s:%d" % [BIND_ADDRESS, _port])

func _stop_server() -> void:
	if not _running:
		return
	for peer_id in _peers.keys():
		var peer: WebSocketPeer = _peers[peer_id]
		peer.close(1000, "server shutdown")
	_peers.clear()
	_tcp_server.stop()
	_running = false
	server_stopped.emit()

func _poll_server() -> void:
	while _tcp_server.is_connection_available():
		var peer_id := _next_peer_id
		_next_peer_id += 1
		var peer := WebSocketPeer.new()
		var stream := _tcp_server.take_connection()
		var error := peer.accept_stream(stream)
		if error != OK:
			push_error("[GodotMCPIngame] WebSocket 握手失败，错误码=%d" % error)
			continue
		_peers[peer_id] = peer
		client_connected.emit(peer_id)

	for peer_id in _peers.keys():
		var peer: WebSocketPeer = _peers[peer_id]
		peer.poll()
		if peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
			while peer.get_available_packet_count() > 0:
				_handle_packet(peer)
		elif peer.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			_peers.erase(peer_id)
			client_disconnected.emit(peer_id)

func _handle_packet(peer: WebSocketPeer) -> void:
	var text := peer.get_packet().get_string_from_utf8()
	var json := JSON.new()
	if json.parse(text) != OK:
		_send_error(peer, null, JSONRPC_PARSE_ERROR, "JSON 解析失败：%s" % json.get_error_message())
		return
	var request: Variant = json.get_data()
	if typeof(request) != TYPE_DICTIONARY or request.get("jsonrpc", "") != "2.0":
		_send_error(peer, request.get("id") if typeof(request) == TYPE_DICTIONARY else null, JSONRPC_INVALID_REQUEST, "无效的 JSON-RPC 请求")
		return
	var request_id: Variant = request.get("id")
	var params: Variant = request.get("params", {})
	match String(request.get("method", "")):
		"initialize":
			_send_result(peer, request_id, {
				"protocolVersion": PROTOCOL_VERSION,
				"serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
				"capabilities": {"tools": {}},
			})
		"tools/list":
			_send_result(peer, request_id, {"tools": _registry.list_tools()})
		"tools/call":
			await _handle_tool_call(peer, request_id, params)
		"ping":
			_send_result(peer, request_id, {})
		_:
			_send_error(peer, request_id, JSONRPC_METHOD_NOT_FOUND, "未知方法")

func _handle_tool_call(peer: WebSocketPeer, request_id: Variant, params: Variant) -> void:
	if typeof(params) != TYPE_DICTIONARY:
		_send_error(peer, request_id, JSONRPC_INVALID_PARAMS, "params 必须是对象")
		return
	var tool_name := String(params.get("name", ""))
	var arguments: Variant = params.get("arguments", {})
	if tool_name.is_empty() or typeof(arguments) != TYPE_DICTIONARY:
		_send_error(peer, request_id, JSONRPC_INVALID_PARAMS, "name 和 arguments 无效")
		return
	var execution: Dictionary = await _registry.call_tool(tool_name, arguments)
	if not execution.get("success", false):
		_send_error(peer, request_id, JSONRPC_INTERNAL_ERROR, String(execution.get("error", "工具执行失败")))
		return
	var result: Variant = execution.get("result")
	if typeof(result) == TYPE_DICTIONARY and result.has("__godot_mcp_error"):
		_send_error(peer, request_id, JSONRPC_INVALID_PARAMS, String(result["__godot_mcp_error"]))
		return
	_send_result(peer, request_id, {
		"content": [{"type": "text", "text": JSON.stringify(result)}],
	})

func _send_result(peer: WebSocketPeer, request_id: Variant, result: Variant) -> void:
	_send_json(peer, {"jsonrpc": "2.0", "id": request_id, "result": result})

func _send_error(peer: WebSocketPeer, request_id: Variant, code: int, message: String) -> void:
	_send_json(peer, {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})

func _send_json(peer: WebSocketPeer, value: Dictionary) -> void:
	if peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
		peer.send_text(JSON.stringify(value))
