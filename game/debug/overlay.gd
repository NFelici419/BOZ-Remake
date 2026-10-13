class_name DebugOverlay
extends CanvasLayer
## FPS and player position, toggled with a short press of Select (holding it is the rescue teleport).

var player: Node3D
var _label := Label.new()
var _held := 0.0


func _init(target: Node3D) -> void:
	player = target
	layer = 10
	_label.position = Vector2(24, 24)
	_label.add_theme_font_size_override("font_size", 28)
	_label.add_theme_color_override("font_outline_color", Color.BLACK)
	_label.add_theme_constant_override("outline_size", 6)
	add_child(_label)


func _process(delta: float) -> void:
	if Input.is_action_pressed("debug_overlay"):
		_held += delta
	elif _held > 0.0:
		if _held < 0.5:
			visible = not visible
		_held = 0.0
	if not visible:
		return
	var p := player.global_position
	var pad := "pad: none" if Input.get_connected_joypads().is_empty() else "pad: " + Input.get_joy_name(Input.get_connected_joypads()[0])
	_label.text = "%d fps\npos %.2f, %.2f, %.2f\n%s" % [Engine.get_frames_per_second(), p.x, p.y, p.z, pad]
