@tool
extends EditorPlugin

const AUTOLOAD_NAME := "GodotMCPIngame"
const AUTOLOAD_PATH := "res://addons/godot_mcp_ingame/godot_mcp_ingame.gd"

func _enable_plugin() -> void:
	if not ProjectSettings.has_setting("autoload/%s" % AUTOLOAD_NAME):
		add_autoload_singleton(AUTOLOAD_NAME, AUTOLOAD_PATH)

func _disable_plugin() -> void:
	if ProjectSettings.has_setting("autoload/%s" % AUTOLOAD_NAME):
		remove_autoload_singleton(AUTOLOAD_NAME)
