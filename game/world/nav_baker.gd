class_name NavBaker
extends NavigationRegion3D
## Zombie navigation. Starts from the pre-baked navmesh; closed doors are
## carved out of it and it re-bakes in the background whenever a door opens.
## Interim until the original CIsNavMesh is decoded.

const NAVMESH := "res://assets/converted/kino/navmesh.res"
const SOURCE := "res://assets/converted/kino/navsource.res"

var doors: Array[Door] = []
var _source: NavigationMeshSourceGeometryData3D
var _baking := false
var _dirty := false


func _init() -> void:
	name = "Navigation"
	if ResourceLoader.exists(NAVMESH):
		navigation_mesh = load(NAVMESH)
	else:
		push_warning("No navmesh at %s; zombies cannot path. Run tools/bake_navmesh.gd." % NAVMESH)
	if ResourceLoader.exists(SOURCE):
		_source = load(SOURCE)


func watch(door: Door) -> void:
	doors.append(door)
	door.opened.connect(func(_d): rebake())


func rebake() -> void:
	if _source == null:
		return
	if _baking:
		_dirty = true
		return
	_baking = true
	_source.clear_projected_obstructions()
	for door in doors:
		if not door.is_open:
			var outline := door.footprint()
			_source.add_projected_obstruction(outline, outline[0].y - 0.5, 3.5, true)
	var mesh := NavMeshSettings.new_mesh()
	NavigationServer3D.bake_from_source_geometry_data_async(mesh, _source, _on_baked.bind(mesh))


func _on_baked(mesh: NavigationMesh) -> void:
	navigation_mesh = mesh
	_baking = false
	if _dirty:
		_dirty = false
		rebake()
