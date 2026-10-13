extends SceneTree
## Headless checks, no GUT (deferred to milestone 3):
##   godot --headless --path game --script res://tests/run.gd
## Exits non-zero on failure. Scene checks are skipped when the converted
## Kino files are not present.

const KINO_SCENE := "res://assets/converted/kino/kino.gltf"
const ROOM_SHADER := "res://shaders/kino_room.gdshader"
const CUTOUT_SHADER := "res://shaders/kino_room_cutout.gdshader"
const PLACED_ROOMS := 349

var failures := 0


func _initialize() -> void:
	test_stick()
	test_kino_scene()
	print("%d failure(s)" % failures)
	quit(1 if failures > 0 else 0)


func check(condition: bool, message: String) -> void:
	if condition:
		print("ok   ", message)
	else:
		failures += 1
		printerr("FAIL ", message)


func test_stick() -> void:
	check(Stick.shape(Vector2(0.1, 0.1), 0.2, 2.0) == Vector2.ZERO, "stick: inside dead zone is zero")
	check(Stick.shape(Vector2(1, 0), 0.2, 2.0).is_equal_approx(Vector2(1, 0)), "stick: full deflection stays full")
	var mid := Stick.shape(Vector2(0, 0.6), 0.2, 2.0)
	check(is_equal_approx(mid.y, 0.25) and mid.x == 0.0, "stick: (0.6-0.2)/0.8 = 0.5, squared = 0.25, direction kept")
	check(Stick.shape(Vector2(0.9, 0.9), 0.2, 1.0).length() <= 1.0001, "stick: diagonal clamps to length 1")


func test_kino_scene() -> void:
	if not ResourceLoader.exists(KINO_SCENE):
		print("skip scene checks: %s not imported (run export-kino, then godot --import)" % KINO_SCENE)
		return
	var scene: Node = load(KINO_SCENE).instantiate()
	var meshes := scene.find_children("*", "MeshInstance3D", true, false)
	check(meshes.size() == PLACED_ROOMS, "scene: %d room meshes (expected %d)" % [meshes.size(), PLACED_ROOMS])
	var with_collision := 0
	var room := 0
	var cutout := 0
	var other := 0
	var colours := 0
	var raw_bytes := 0
	for node in meshes:
		var mi := node as MeshInstance3D
		if mi.get_node_or_null("collision") is StaticBody3D:
			with_collision += 1
		for s in mi.mesh.get_surface_count():
			var material := mi.mesh.surface_get_material(s) as ShaderMaterial
			var path := material.shader.resource_path if material and material.shader else ""
			if path == ROOM_SHADER:
				room += 1
			elif path == CUTOUT_SHADER:
				cutout += 1
			else:
				other += 1
			var arrays := mi.mesh.surface_get_arrays(s)
			var cols = arrays[Mesh.ARRAY_COLOR]
			if cols is PackedColorArray:
				for c in cols:
					for v in [c.r, c.g, c.b]:
						colours += 1
						if absf(v * 255.0 - roundf(v * 255.0)) < 0.001:
							raw_bytes += 1
	check(with_collision == meshes.size(), "scene: every room mesh has collision (%d)" % with_collision)
	check(other == 0, "scene: every surface uses a room shader (room %d, cutout %d, other %d)" % [room, cutout, other])
	check(cutout > 0, "scene: alpha cut-out surfaces present (%d)" % cutout)
	check(colours > 0, "scene: vertex colours imported (%d components)" % colours)
	print("info vertex colours stored as raw bytes: %.1f%%" % (100.0 * raw_bytes / maxi(colours, 1)))
	scene.free()
