class_name Hud
extends CanvasLayer
## Round number, points, ammo, crosshair, damage tint and the game-over panel.

var _round := Label.new()
var _points := Label.new()
var _ammo := Label.new()
var _crosshair := Label.new()
var _hurt := ColorRect.new()
var _over := Label.new()
var _prompt := Label.new()
var _weapon := Label.new()
var player: Player


func _init() -> void:
	layer = 5
	_hurt.color = Color(0.6, 0.0, 0.0, 0.0)
	_hurt.set_anchors_preset(Control.PRESET_FULL_RECT)
	_hurt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_hurt)
	_style(_round, 96, Color(0.75, 0.05, 0.05))
	_round.position = Vector2(48, 1080 - 150)
	_style(_points, 44, Color(0.95, 0.85, 0.4))
	_points.position = Vector2(1920 - 300, 1080 - 260)
	_style(_ammo, 48, Color.WHITE)
	_ammo.position = Vector2(1920 - 300, 1080 - 130)
	_style(_crosshair, 40, Color(1, 1, 1, 0.8))
	_crosshair.text = "+"
	_crosshair.position = Vector2(960 - 12, 540 - 28)
	_style(_prompt, 40, Color.WHITE)
	_prompt.position = Vector2(560, 700)
	_prompt.size = Vector2(800, 60)
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_style(_weapon, 34, Color(0.85, 0.85, 0.85))
	_weapon.position = Vector2(1920 - 300, 1080 - 175)
	add_child(_prompt)
	add_child(_weapon)
	_style(_over, 64, Color(0.85, 0.1, 0.1))
	_over.position = Vector2(560, 440)
	_over.visible = false
	for l in [_round, _points, _ammo, _crosshair, _over]:
		add_child(l)
	GameState.round_changed.connect(func(n): _round.text = str(n))
	GameState.points_changed.connect(func(_id, p): _points.text = str(p))
	GameState.health_changed.connect(func(_id, h, m): _hurt.color.a = clampf(1.0 - h / m, 0.0, 1.0) * 0.45)
	GameState.game_over.connect(_on_game_over)
	# values set before the HUD existed
	if GameState.round_number > 0:
		_round.text = str(GameState.round_number)
	if not GameState.points.is_empty():
		_points.text = str(GameState.points.values()[0])


static func _style(label: Label, size: int, colour: Color) -> void:
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", colour)
	label.add_theme_color_override("font_outline_color", Color.BLACK)
	label.add_theme_constant_override("outline_size", 8)


func watch_weapon(weapon: Weapon) -> void:
	weapon.ammo_changed.connect(func(c, r): _ammo.text = "%d / %d" % [c, r])
	weapon.weapon_changed.connect(func(n): _weapon.text = n.to_upper())
	_ammo.text = "%d / %d" % [weapon.clip, weapon.reserve]
	_weapon.text = weapon.gun().name.to_upper() if weapon.gun() else ""


func _process(_delta: float) -> void:
	_prompt.text = player.focus.prompt(player) if player and player.focus and not GameState.is_over else ""


func _on_game_over(rounds: int) -> void:
	_over.text = "GAME OVER\nYou survived %d round%s\nStart to play again" % [rounds, "" if rounds == 1 else "s"]
	_over.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_over.visible = true
