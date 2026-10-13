extends SceneTree
## Bakes the zombie navigation mesh from the imported Kino room collision and
## saves it next to the converted assets (generated, gitignored):
##   godot --headless --path game --script res://tools/bake_navmesh.gd
## Interim: the original CIsNavMesh is not decoded yet.

const KINO_SCENE := "res://assets/converted/kino/kino.gltf"
const OUT := "res://assets/converted/kino/navmesh.res"

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
	var mesh := NavigationMesh.new()
	mesh.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	mesh.cell_size = NavMeshSettings.CELL_SIZE
	mesh.cell_height = NavMeshSettings.CELL_HEIGHT
	mesh.agent_radius = NavMeshSettings.AGENT_RADIUS
	mesh.agent_height = NavMeshSettings.AGENT_HEIGHT
	mesh.agent_max_climb = NavMeshSettings.AGENT_MAX_CLIMB
	mesh.agent_max_slope = NavMeshSettings.AGENT_MAX_SLOPE
	var source := NavigationMeshSourceGeometryData3D.new()
	NavigationServer3D.parse_source_geometry_data(mesh, source, _scene)
	NavigationServer3D.bake_from_source_geometry_data(mesh, source)
	var err := ResourceSaver.save(mesh, OUT)
	print("navmesh: %d polygons, %d vertices in %d ms -> %s (%s)" % [mesh.get_polygon_count(), mesh.get_vertices().size(), Time.get_ticks_msec() - started, OUT, error_string(err)])
	quit(0 if err == OK and mesh.get_polygon_count() > 0 else 1)
	return true
