@tool
extends EditorPlugin

const SESSION_FILE := "editor-session.json"
const COMMAND_FILE := "command.json"
const RESPONSES_DIR := "responses"
const HEARTBEAT_INTERVAL_SECONDS := 0.5
const PLUGIN_VERSION := "0.1.2"

var _timer: Timer
var _last_handled_command_id: String = ""

func _enter_tree() -> void:
	_ensure_runtime_dirs()
	_timer = Timer.new()
	_timer.wait_time = HEARTBEAT_INTERVAL_SECONDS
	_timer.one_shot = false
	_timer.timeout.connect(_on_tick)
	add_child(_timer)
	_timer.start()
	_on_tick()

func _exit_tree() -> void:
	if _timer:
		_timer.stop()

func _on_tick() -> void:
	_write_session()
	_process_command()

func _ensure_runtime_dirs() -> void:
	DirAccess.make_dir_recursive_absolute(_runtime_dir())
	DirAccess.make_dir_recursive_absolute(_responses_dir())

func _runtime_dir() -> String:
	return ProjectSettings.globalize_path("res://.godot/godot-mcp")

func _session_path() -> String:
	return _runtime_dir().path_join(SESSION_FILE)

func _command_path() -> String:
	return _runtime_dir().path_join(COMMAND_FILE)

func _responses_dir() -> String:
	return _runtime_dir().path_join(RESPONSES_DIR)

func _write_session() -> void:
	var session := {
		"sessionId": str(OS.get_process_id()),
		"pluginVersion": PLUGIN_VERSION,
		"projectPath": ProjectSettings.globalize_path("res://").trim_suffix("/"),
		"editorPid": OS.get_process_id(),
		"updatedAt": Time.get_unix_time_from_system(),
		"isPlaying": get_editor_interface().is_playing_scene(),
		"playingScene": get_editor_interface().get_playing_scene(),
		"logPath": _resolve_log_path(),
		"commandPath": _command_path(),
		"responsesDir": _responses_dir(),
		"capabilities": {
			"playMainScene": true,
			"playCustomScene": true,
			"stopPlay": true
		}
	}
	var file := FileAccess.open(_session_path(), FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(session))

func _resolve_log_path() -> String:
	var configured := String(ProjectSettings.get_setting("debug/file_logging/log_path", ""))
	if configured.is_empty():
		return ""
	if configured.begins_with("user://") or configured.begins_with("res://"):
		return ProjectSettings.globalize_path(configured)
	return configured

func _process_command() -> void:
	if not FileAccess.file_exists(_command_path()):
		return

	var file := FileAccess.open(_command_path(), FileAccess.READ)
	if file == null:
		return

	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		return

	var command: Dictionary = parsed
	var command_id := String(command.get("id", ""))
	if command_id.is_empty() or command_id == _last_handled_command_id:
		return

	_last_handled_command_id = command_id
	var result := _execute_command(command)
	var response_path := _responses_dir().path_join("%s.json" % command_id)
	var response_file := FileAccess.open(response_path, FileAccess.WRITE)
	if response_file:
		response_file.store_string(JSON.stringify(result))

	DirAccess.remove_absolute(_command_path())

func _execute_command(command: Dictionary) -> Dictionary:
	var command_type := String(command.get("command", ""))
	var ok := true
	var error := ""

	match command_type:
		"play_main":
			get_editor_interface().play_main_scene()
		"play_scene":
			var scene_path := String(command.get("scene", ""))
			if scene_path.is_empty():
				ok = false
				error = "scene is required for play_scene"
			else:
				get_editor_interface().play_custom_scene(scene_path)
		"stop_play":
			get_editor_interface().stop_playing_scene()
		_:
			ok = false
			error = "unknown command: %s" % command_type

	return {
		"id": String(command.get("id", "")),
		"success": ok,
		"error": error,
		"handledAt": Time.get_unix_time_from_system(),
		"isPlaying": get_editor_interface().is_playing_scene(),
		"playingScene": get_editor_interface().get_playing_scene()
	}
