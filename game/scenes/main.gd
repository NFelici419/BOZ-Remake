extends Node3D
## Builds the walk-around: converted Kino, the sky, the player and the debug
## overlay. Missing converted files give a magenta placeholder, never a crash.

const CONVERTED := "res://assets/converted/kino/"
const KINO_SCENE := CONVERTED + "kino.gltf"
const SKY_SHADER := preload("res://shaders/kino_sky.gdshader")

## Gamepad buttons per action (Godot's standard layout: A = South, B = East).
const ACTIONS := {
	"jump": JOY_BUTTON_A,
	"crouch": JOY_BUTTON_B,
	"reload": JOY_BUTTON_X,
	"sprint": JOY_BUTTON_LEFT_STICK,
	"melee": JOY_BUTTON_RIGHT_STICK,
	"debug_overlay": JOY_BUTTON_BACK,
	"pause": JOY_BUTTON_START,
}
const NAVMESH := CONVERTED + "navmesh.res"

var _paused_label := Label.new()


func _ready() -> void:
	register_input()
	if ResourceLoader.exists(KINO_SCENE):
		add_child(load(KINO_SCENE).instantiate())
	else:
		push_warning("Converted Kino not found at %s; run the converter's export-kino. Showing a placeholder." % KINO_SCENE)
		add_child(placeholder_floor())
	add_child(world_environment())
	add_navigation()
	var tuning := read_json("res://data/approximations.json", {})
	var settings := read_json("res://data/settings.json", {})
	var dims := read_json(CONVERTED + "player.json", Player.STAND_FALLBACK)
	GameState.reset()
	var player := Player.new(dims, tuning, settings)
	var start: Array = tuning.get("start_position", [0.0, 2.0, 0.0])
	player.position = Vector3(start[0], start[1], start[2])
	player.spawn_point = player.position
	add_child(player)
	GameState.register_player(player.player_id, tuning.get("start_points", 500))
	var hud := Hud.new()
	add_child(hud)
	var weapon := Weapon.new("colt45", tuning)
	player.camera.add_child(weapon)
	weapon.owner = player
	hud.watch_weapon(weapon)
	if KinoData.loaded:
		add_child(RoundDirector.new(player, self, tuning, settings.get("difficulty", "normal")))
	add_child(DebugOverlay.new(player))
	add_child(Capture.new(player))
	process_mode = Node.PROCESS_MODE_ALWAYS
	_paused_label.text = "PAUSED\nStart: resume   Select: quit"
	Hud._style(_paused_label, 56, Color.WHITE)
	_paused_label.position = Vector2(620, 460)
	_paused_label.visible = false
	hud.add_child(_paused_label)


func _process(_delta: float) -> void:
	if GameState.is_over:
		if Input.is_action_just_pressed("pause"):
			get_tree().reload_current_scene()
		return
	if Input.is_action_just_pressed("pause"):
		get_tree().paused = not get_tree().paused
		_paused_label.visible = get_tree().paused
	elif get_tree().paused and Input.is_action_just_pressed("debug_overlay"):
		get_tree().quit()


## Zombie navigation from the baked navmesh (tools/bake_navmesh.gd).
func add_navigation() -> void:
	if not ResourceLoader.exists(NAVMESH):
		push_warning("No navmesh at %s; zombies cannot path. Run tools/bake_navmesh.gd." % NAVMESH)
		return
	var region := NavigationRegion3D.new()
	region.navigation_mesh = load(NAVMESH)
	add_child(region)


static func register_input() -> void:
	for action in ACTIONS:
		if InputMap.has_action(action):
			continue
		InputMap.add_action(action)
		var event := InputEventJoypadButton.new()
		event.button_index = ACTIONS[action]
		event.device = -1
		InputMap.action_add_event(action, event)


static func read_json(path: String, fallback: Dictionary) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_warning("Missing %s; using defaults." % path)
		return fallback
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if parsed is Dictionary:
		return parsed
	push_warning("Could not parse %s; using defaults." % path)
	return fallback


## Sky from the converted cubemap faces; a flat colour when they are missing.
static func world_environment() -> WorldEnvironment:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.08, 0.08, 0.1)
	var sky_info := read_json(CONVERTED + "sky/sky.json", {})
	var faces: Array[Image] = []
	for file in sky_info.get("faces", []):
		var path: String = CONVERTED + "sky/" + file
		if ResourceLoader.exists(path):
			var image: Image = load(path).get_image()
			image.decompress()
			faces.append(image)
	if faces.size() == 6:
		var cube := Cubemap.new()
		cube.create_from_images(faces)
		var material := ShaderMaterial.new()
		material.shader = SKY_SHADER
		material.set_shader_parameter("sky_cube", cube)
		var sky := Sky.new()
		sky.sky_material = material
		env.background_mode = Environment.BG_SKY
		env.sky = sky
	var world := WorldEnvironment.new()
	world.environment = env
	return world


static func placeholder_floor() -> StaticBody3D:
	var body := StaticBody3D.new()
	var mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(40, 40)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color.MAGENTA
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	plane.material = material
	mesh.mesh = plane
	body.add_child(mesh)
	var shape := CollisionShape3D.new()
	shape.shape = WorldBoundaryShape3D.new()
	body.add_child(shape)
	return body
