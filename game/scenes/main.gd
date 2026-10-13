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
	"sprint": JOY_BUTTON_LEFT_STICK,
	"debug_overlay": JOY_BUTTON_BACK,
	"quit": JOY_BUTTON_START,
}


func _ready() -> void:
	register_input()
	if ResourceLoader.exists(KINO_SCENE):
		add_child(load(KINO_SCENE).instantiate())
	else:
		push_warning("Converted Kino not found at %s; run the converter's export-kino. Showing a placeholder." % KINO_SCENE)
		add_child(placeholder_floor())
	add_child(world_environment())
	var tuning := read_json("res://data/approximations.json", {})
	var dims := read_json(CONVERTED + "player.json", Player.STAND_FALLBACK)
	var player := Player.new(dims, tuning, read_json("res://data/settings.json", {}))
	var start: Array = tuning.get("start_position", [0.0, 2.0, 0.0])
	player.position = Vector3(start[0], start[1], start[2])
	add_child(player)
	add_child(DebugOverlay.new(player))
	add_child(Capture.new(player))


func _process(_delta: float) -> void:
	if Input.is_action_just_pressed("quit"):
		get_tree().quit()


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
