@tool
extends EditorPlugin

const SESSION_FILE := "editor-session.json"
const COMMAND_FILE := "command.json"
const RESPONSES_DIR := "responses"
const HEARTBEAT_INTERVAL_SECONDS := 0.5
const PLUGIN_VERSION := "0.1.2"
const MAX_OUTPUT_LINES := 240

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
      "stopPlay": true,
      "readOutputSnapshot": true
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
  var output_lines: Array[String] = []
  var targets: Array[Dictionary] = []

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
    "get_output_snapshot":
      output_lines = _collect_output_lines()
    "inspect_output_targets":
      targets = _inspect_output_targets()
    _:
      ok = false
      error = "unknown command: %s" % command_type

  return {
    "id": String(command.get("id", "")),
    "success": ok,
    "error": error,
    "handledAt": Time.get_unix_time_from_system(),
    "isPlaying": get_editor_interface().is_playing_scene(),
    "playingScene": get_editor_interface().get_playing_scene(),
    "outputLines": output_lines,
    "targets": targets
  }

func _collect_output_lines() -> Array[String]:
  var candidates: Array[RichTextLabel] = []
  _collect_rich_text_candidates(get_editor_interface().get_base_control(), candidates)

  var script_error_lines: Array[String] = []
  var output_lines: Array[String] = []
  var seen := {}

  for candidate in candidates:
    var path_text := String(candidate.get_path())
    var parsed_text := candidate.get_parsed_text()
    if parsed_text.is_empty():
      continue

    if _is_script_error_candidate(path_text, parsed_text):
      _append_unique_lines(script_error_lines, seen, parsed_text)
      continue

    if _is_output_candidate(path_text):
      _append_unique_lines(output_lines, seen, parsed_text)

  var merged_lines := script_error_lines
  merged_lines.append_array(output_lines)

  if merged_lines.size() <= MAX_OUTPUT_LINES:
    return merged_lines
  return merged_lines.slice(0, MAX_OUTPUT_LINES)

func _find_best_output_rich_text(root: Node) -> RichTextLabel:
  if root == null:
    return null

  var candidates: Array[RichTextLabel] = []
  _collect_rich_text_candidates(root, candidates)
  if candidates.is_empty():
    return null

  var best_label: RichTextLabel = null
  var best_score := -1
  for candidate in candidates:
    var score := _score_output_candidate(candidate)
    if score > best_score:
      best_score = score
      best_label = candidate

  return best_label

func _collect_rich_text_candidates(node: Node, candidates: Array[RichTextLabel]) -> void:
  if node is RichTextLabel:
    candidates.append(node as RichTextLabel)

  for child in node.get_children():
    _collect_rich_text_candidates(child, candidates)

func _score_output_candidate(label: RichTextLabel) -> int:
  var score := 0
  var path_text := String(label.get_path())
  var name_text := String(label.name)
  var parsed_text := label.get_parsed_text()
  var line_count := parsed_text.count("\n") + (0 if parsed_text.is_empty() else 1)

  if path_text.contains("/Output/") or path_text.contains("EditorLog"):
    score += 10000
  if path_text.contains("EditorAbout") or path_text.contains("AssetManagerEditor") or path_text.contains("EditorHelpBit") or path_text.contains("SceneCreateDialog"):
    score -= 10000
  if name_text.contains("EditorLog") or name_text.contains("Output"):
    score += 120
  if parsed_text.contains("[MCP") or parsed_text.contains("SCRIPT ERROR") or parsed_text.contains("Parser Error") or parsed_text.contains("ERROR") or parsed_text.contains("WARNING"):
    score += 80
  if line_count >= 4:
    score += 40
  if parsed_text.length() > 0:
    score += mini(parsed_text.length(), 120)

  return score

func _is_output_candidate(path_text: String) -> bool:
  return path_text.contains("/Output/") or path_text.contains("EditorLog")

func _is_script_error_candidate(path_text: String, parsed_text: String) -> bool:
  if not (path_text.contains("ScriptEditor") or path_text.contains("ScriptTextEditor") or path_text.contains("CodeTextEditor")):
    return false

  return (
    parsed_text.contains("Unexpected identifier")
    or parsed_text.contains("Parse Error")
    or parsed_text.contains("Failed to load script")
    or parsed_text.contains("Could not parse")
    or parsed_text.contains("错误 (")
    or parsed_text.contains("第 ")
  )

func _append_unique_lines(target: Array[String], seen: Dictionary, parsed_text: String) -> void:
  for raw_line in parsed_text.split("\n"):
    var normalized_line := String(raw_line).strip_edges()
    if normalized_line.is_empty():
      continue
    if seen.has(normalized_line):
      continue
    seen[normalized_line] = true
    target.append(normalized_line)

func _inspect_output_targets() -> Array[Dictionary]:
  var candidates: Array[RichTextLabel] = []
  _collect_rich_text_candidates(get_editor_interface().get_base_control(), candidates)

  var rows: Array[Dictionary] = []
  for candidate in candidates:
    var parsed_text := candidate.get_parsed_text()
    var line_count := parsed_text.count("\n") + (0 if parsed_text.is_empty() else 1)
    rows.append({
      "path": String(candidate.get_path()),
      "name": String(candidate.name),
      "score": _score_output_candidate(candidate),
      "lineCount": line_count,
      "sample": parsed_text.substr(0, 160)
    })

  rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
    return int(a.get("score", 0)) > int(b.get("score", 0))
  )

  if rows.size() <= 8:
    return rows
  return rows.slice(0, 8)
