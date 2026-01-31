@tool
extends MCPBaseCommand
class_name MCPInputCommands

const INPUT_TIMEOUT := 30.0

var _input_map_result: Dictionary = {}
var _input_map_pending: bool = false

var _sequence_result: Dictionary = {}
var _sequence_pending: bool = false


var _type_text_result: Dictionary = {}
var _type_text_pending: bool = false

var _mouse_click_result: Dictionary = {}
var _mouse_click_pending: bool = false

var _mouse_move_result: Dictionary = {}
var _mouse_move_pending: bool = false

var _mouse_scroll_result: Dictionary = {}
var _mouse_scroll_pending: bool = false

var _mouse_drag_result: Dictionary = {}
var _mouse_drag_pending: bool = false


func get_commands() -> Dictionary:
	return {
		"get_input_map": get_input_map,
		"execute_input_sequence": execute_input_sequence,
		"type_text": type_text,
		"mouse_click": mouse_click,
		"mouse_move": mouse_move,
		"mouse_scroll": mouse_scroll,
		"mouse_drag": mouse_drag,
	}


func get_input_map(_params: Dictionary) -> Dictionary:
	if not EditorInterface.is_playing_scene():
		return _get_editor_input_map()

	var debugger_plugin = _plugin.get_debugger_plugin() if _plugin else null
	if debugger_plugin == null or not debugger_plugin.has_active_session():
		return _get_editor_input_map()

	_input_map_pending = true
	_input_map_result = {}

	debugger_plugin.input_map_received.connect(_on_input_map_received, CONNECT_ONE_SHOT)
	debugger_plugin.request_input_map()

	var start_time := Time.get_ticks_msec()
	while _input_map_pending:
		await Engine.get_main_loop().process_frame
		if (Time.get_ticks_msec() - start_time) / 1000.0 > INPUT_TIMEOUT:
			_input_map_pending = false
			if debugger_plugin.input_map_received.is_connected(_on_input_map_received):
				debugger_plugin.input_map_received.disconnect(_on_input_map_received)
			return _get_editor_input_map()

	return _success(_input_map_result)


func _get_editor_input_map() -> Dictionary:
	var actions: Array[Dictionary] = []
	for action_name in InputMap.get_actions():
		if action_name.begins_with("ui_"):
			continue
		var events := InputMap.action_get_events(action_name)
		var event_strings: Array[String] = []
		for event in events:
			event_strings.append(_event_to_string(event))
		actions.append({
			"name": action_name,
			"events": event_strings,
		})
	return _success({"actions": actions, "source": "editor"})


func _event_to_string(event: InputEvent) -> String:
	if event is InputEventKey:
		var key_event := event as InputEventKey
		var key_name := OS.get_keycode_string(key_event.keycode)
		if key_event.ctrl_pressed:
			key_name = "Ctrl+" + key_name
		if key_event.alt_pressed:
			key_name = "Alt+" + key_name
		if key_event.shift_pressed:
			key_name = "Shift+" + key_name
		return key_name
	elif event is InputEventMouseButton:
		var mouse_event := event as InputEventMouseButton
		match mouse_event.button_index:
			MOUSE_BUTTON_LEFT:
				return "Mouse Left"
			MOUSE_BUTTON_RIGHT:
				return "Mouse Right"
			MOUSE_BUTTON_MIDDLE:
				return "Mouse Middle"
			_:
				return "Mouse Button %d" % mouse_event.button_index
	elif event is InputEventJoypadButton:
		var joy_event := event as InputEventJoypadButton
		return "Joypad Button %d" % joy_event.button_index
	elif event is InputEventJoypadMotion:
		var joy_motion := event as InputEventJoypadMotion
		return "Joypad Axis %d" % joy_motion.axis
	return event.as_text()


func _on_input_map_received(actions: Array, error: String) -> void:
	_input_map_pending = false
	if error.is_empty():
		_input_map_result = {"actions": actions, "source": "game"}
	else:
		_input_map_result = {"error": error}


func execute_input_sequence(params: Dictionary) -> Dictionary:
	var inputs: Array = params.get("inputs", [])
	if inputs.is_empty():
		return _error("INVALID_PARAMS", "inputs array is required and must not be empty")

	if not EditorInterface.is_playing_scene():
		return _error("NOT_RUNNING", "No game is currently running")

	var debugger_plugin = _plugin.get_debugger_plugin() if _plugin else null
	if debugger_plugin == null or not debugger_plugin.has_active_session():
		return _error("NO_SESSION", "No active debug session")

	var max_end_time: float = 0.0
	for input in inputs:
		var start_ms: float = input.get("start_ms", 0.0)
		var duration_ms: float = input.get("duration_ms", 0.0)
		max_end_time = max(max_end_time, start_ms + duration_ms)

	var timeout := max(INPUT_TIMEOUT, (max_end_time / 1000.0) + 5.0)

	_sequence_pending = true
	_sequence_result = {}

	debugger_plugin.input_sequence_completed.connect(_on_sequence_completed, CONNECT_ONE_SHOT)
	debugger_plugin.request_input_sequence(inputs)

	var start_time := Time.get_ticks_msec()
	while _sequence_pending:
		await Engine.get_main_loop().process_frame
		if (Time.get_ticks_msec() - start_time) / 1000.0 > timeout:
			_sequence_pending = false
			if debugger_plugin.input_sequence_completed.is_connected(_on_sequence_completed):
				debugger_plugin.input_sequence_completed.disconnect(_on_sequence_completed)
			return _error("TIMEOUT", "Timed out waiting for input sequence to complete")

	if _sequence_result.has("error"):
		return _error("SEQUENCE_ERROR", _sequence_result.get("error", "Unknown error"))

	return _success(_sequence_result)


func _on_sequence_completed(result: Dictionary) -> void:
	_sequence_pending = false
	_sequence_result = result


func type_text(params: Dictionary) -> Dictionary:
	var text: String = params.get("text", "")
	var delay_ms: int = int(params.get("delay_ms", 50))
	var submit: bool = params.get("submit", false)

	if text.is_empty():
		return _error("INVALID_PARAMS", "text is required and must not be empty")

	if not EditorInterface.is_playing_scene():
		return _error("NOT_RUNNING", "No game is currently running")

	var debugger_plugin = _plugin.get_debugger_plugin() if _plugin else null
	if debugger_plugin == null or not debugger_plugin.has_active_session():
		return _error("NO_SESSION", "No active debug session")

	var timeout := max(INPUT_TIMEOUT, (text.length() * delay_ms / 1000.0) + 5.0)

	_type_text_pending = true
	_type_text_result = {}

	debugger_plugin.type_text_completed.connect(_on_type_text_completed, CONNECT_ONE_SHOT)
	debugger_plugin.request_type_text(text, delay_ms, submit)

	var start_time := Time.get_ticks_msec()
	while _type_text_pending:
		await Engine.get_main_loop().process_frame
		if (Time.get_ticks_msec() - start_time) / 1000.0 > timeout:
			_type_text_pending = false
			if debugger_plugin.type_text_completed.is_connected(_on_type_text_completed):
				debugger_plugin.type_text_completed.disconnect(_on_type_text_completed)
			return _error("TIMEOUT", "Timed out waiting for text input to complete")

	if _type_text_result.has("error"):
		return _error("TYPE_TEXT_ERROR", _type_text_result.get("error", "Unknown error"))

	return _success(_type_text_result)


func _on_type_text_completed(result: Dictionary) -> void:
	_type_text_pending = false
	_type_text_result = result


func mouse_click(params: Dictionary) -> Dictionary:
	var x: float = params.get("x", 0.0)
	var y: float = params.get("y", 0.0)
	var button: String = params.get("button", "left")

	if not EditorInterface.is_playing_scene():
		return _error("NOT_RUNNING", "No game is currently running")

	var debugger_plugin = _plugin.get_debugger_plugin() if _plugin else null
	if debugger_plugin == null or not debugger_plugin.has_active_session():
		return _error("NO_SESSION", "No active debug session")

	_mouse_click_pending = true
	_mouse_click_result = {}

	debugger_plugin.mouse_click_completed.connect(_on_mouse_click_completed, CONNECT_ONE_SHOT)
	debugger_plugin.request_mouse_click(x, y, button)

	var start_time := Time.get_ticks_msec()
	while _mouse_click_pending:
		await Engine.get_main_loop().process_frame
		if (Time.get_ticks_msec() - start_time) / 1000.0 > INPUT_TIMEOUT:
			_mouse_click_pending = false
			if debugger_plugin.mouse_click_completed.is_connected(_on_mouse_click_completed):
				debugger_plugin.mouse_click_completed.disconnect(_on_mouse_click_completed)
			return _error("TIMEOUT", "Timed out waiting for mouse click")

	if _mouse_click_result.has("error"):
		return _error("MOUSE_ERROR", _mouse_click_result.get("error", "Unknown error"))

	return _success(_mouse_click_result)


func _on_mouse_click_completed(result: Dictionary) -> void:
	_mouse_click_pending = false
	_mouse_click_result = result


func mouse_move(params: Dictionary) -> Dictionary:
	var x: float = params.get("x", 0.0)
	var y: float = params.get("y", 0.0)

	if not EditorInterface.is_playing_scene():
		return _error("NOT_RUNNING", "No game is currently running")

	var debugger_plugin = _plugin.get_debugger_plugin() if _plugin else null
	if debugger_plugin == null or not debugger_plugin.has_active_session():
		return _error("NO_SESSION", "No active debug session")

	_mouse_move_pending = true
	_mouse_move_result = {}

	debugger_plugin.mouse_move_completed.connect(_on_mouse_move_completed, CONNECT_ONE_SHOT)
	debugger_plugin.request_mouse_move(x, y)

	var start_time := Time.get_ticks_msec()
	while _mouse_move_pending:
		await Engine.get_main_loop().process_frame
		if (Time.get_ticks_msec() - start_time) / 1000.0 > INPUT_TIMEOUT:
			_mouse_move_pending = false
			if debugger_plugin.mouse_move_completed.is_connected(_on_mouse_move_completed):
				debugger_plugin.mouse_move_completed.disconnect(_on_mouse_move_completed)
			return _error("TIMEOUT", "Timed out waiting for mouse move")

	if _mouse_move_result.has("error"):
		return _error("MOUSE_ERROR", _mouse_move_result.get("error", "Unknown error"))

	return _success(_mouse_move_result)


func _on_mouse_move_completed(result: Dictionary) -> void:
	_mouse_move_pending = false
	_mouse_move_result = result


func mouse_scroll(params: Dictionary) -> Dictionary:
	var x: float = params.get("x", 0.0)
	var y: float = params.get("y", 0.0)
	var direction: String = params.get("direction", "up")
	var clicks: int = int(params.get("clicks", 1))

	if not EditorInterface.is_playing_scene():
		return _error("NOT_RUNNING", "No game is currently running")

	var debugger_plugin = _plugin.get_debugger_plugin() if _plugin else null
	if debugger_plugin == null or not debugger_plugin.has_active_session():
		return _error("NO_SESSION", "No active debug session")

	_mouse_scroll_pending = true
	_mouse_scroll_result = {}

	debugger_plugin.mouse_scroll_completed.connect(_on_mouse_scroll_completed, CONNECT_ONE_SHOT)
	debugger_plugin.request_mouse_scroll(x, y, direction, clicks)

	var start_time := Time.get_ticks_msec()
	while _mouse_scroll_pending:
		await Engine.get_main_loop().process_frame
		if (Time.get_ticks_msec() - start_time) / 1000.0 > INPUT_TIMEOUT:
			_mouse_scroll_pending = false
			if debugger_plugin.mouse_scroll_completed.is_connected(_on_mouse_scroll_completed):
				debugger_plugin.mouse_scroll_completed.disconnect(_on_mouse_scroll_completed)
			return _error("TIMEOUT", "Timed out waiting for mouse scroll")

	if _mouse_scroll_result.has("error"):
		return _error("MOUSE_ERROR", _mouse_scroll_result.get("error", "Unknown error"))

	return _success(_mouse_scroll_result)


func _on_mouse_scroll_completed(result: Dictionary) -> void:
	_mouse_scroll_pending = false
	_mouse_scroll_result = result


func mouse_drag(params: Dictionary) -> Dictionary:
	var from_x: float = params.get("from_x", 0.0)
	var from_y: float = params.get("from_y", 0.0)
	var to_x: float = params.get("to_x", 0.0)
	var to_y: float = params.get("to_y", 0.0)
	var button: String = params.get("button", "left")
	var duration_ms: int = int(params.get("duration_ms", 100))
	var steps: int = int(params.get("steps", 10))

	if not EditorInterface.is_playing_scene():
		return _error("NOT_RUNNING", "No game is currently running")

	var debugger_plugin = _plugin.get_debugger_plugin() if _plugin else null
	if debugger_plugin == null or not debugger_plugin.has_active_session():
		return _error("NO_SESSION", "No active debug session")

	var timeout: float = max(INPUT_TIMEOUT, (duration_ms / 1000.0) + 5.0)

	_mouse_drag_pending = true
	_mouse_drag_result = {}

	debugger_plugin.mouse_drag_completed.connect(_on_mouse_drag_completed, CONNECT_ONE_SHOT)
	debugger_plugin.request_mouse_drag(from_x, from_y, to_x, to_y, button, duration_ms, steps)

	var start_time := Time.get_ticks_msec()
	while _mouse_drag_pending:
		await Engine.get_main_loop().process_frame
		if (Time.get_ticks_msec() - start_time) / 1000.0 > timeout:
			_mouse_drag_pending = false
			if debugger_plugin.mouse_drag_completed.is_connected(_on_mouse_drag_completed):
				debugger_plugin.mouse_drag_completed.disconnect(_on_mouse_drag_completed)
			return _error("TIMEOUT", "Timed out waiting for mouse drag")

	if _mouse_drag_result.has("error"):
		return _error("MOUSE_ERROR", _mouse_drag_result.get("error", "Unknown error"))

	return _success(_mouse_drag_result)


func _on_mouse_drag_completed(result: Dictionary) -> void:
	_mouse_drag_pending = false
	_mouse_drag_result = result
