extends SceneTree
## Bakes the zombie navigation mesh (all doors open) from the imported Kino
## room collision and saves it, plus the parsed geometry, next to the converted assets (generated, gitignored):
##   godot --headless --path game --script res://tools/bake_navmesh.gd
## Interim: the original CIsNavMesh is not decoded yet.

const KINO_SCENE := "res://assets/converted/kino/kino.gltf"
const OUT := "res://assets/converted/kino/navmesh.res"
const SOURCE_OUT := "res://assets/converted/kino/navsource.res" # parsed room geometry, for runtime re-bakes

var _scene: Node


func _initialize() -> void:
	if not ResourceLoader.exists(KINO_SCENE):
		printerr("navmesh: %s missing" % KINO_SCENE)
		quit(1)
		return
	_scene = load(KINO_SCENE).instantiate()
	root.add_child(_scene)


func _process(_delta: float) -> bool:
	var started := Time.get_ticks_msec()
	var mesh := NavMeshSettings.new_mesh()
	var source := NavigationMeshSourceGeometryData3D.new()
	NavigationServer3D.parse_source_geometry_data(mesh, source, _scene)
	NavigationServer3D.bake_from_source_geometry_data(mesh, source)
	var err := ResourceSaver.save(mesh, OUT)
	if err == OK:
		err = ResourceSaver.save(source, SOURCE_OUT)
	print("navmesh: %d polygons, %d vertices in %d ms -> %s (%s)" % [mesh.get_polygon_count(), mesh.get_vertices().size(), Time.get_ticks_msec() - started, OUT, error_string(err)])
	quit(0 if err == OK and mesh.get_polygon_count() > 0 else 1)
	return true
