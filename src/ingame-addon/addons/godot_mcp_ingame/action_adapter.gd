class_name GodotMCPActionAdapter
extends RefCounted

## 使用方可继承本类，也可以用实现同名方法的普通 Object 进行鸭子类型适配。
## 返回结构：{"actions": [{"id": String, "label": String, ...}], "revision": String?}
func list_actions(_context: Dictionary) -> Dictionary:
	return {"actions": []}

## arguments 是 action 自己声明的参数，不包含 action_id。
func run_action(_action_id: String, _arguments: Dictionary) -> Variant:
	return null
