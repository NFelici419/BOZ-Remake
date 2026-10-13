class_name Door
extends Interactable
## A buyable door or debris (CDoor): blocks everyone until bought for
## m_Cost, then opens its m_AreasUnlock areas. Doors without a cost
## (PowerOn_Door1, TheatreCurtains) wait for the power.

signal opened(door: Door)

var cost := 0
var areas: Array = []
var is_open := false
var _blocker: StaticBody3D
var _model: Node3D
var _box_half: Array
var _box_offset: Array


func _init(source: Dictionary) -> void:
	super(source)
	var door: Dictionary = source.components.CDoor
	cost = int(door.get("m_Cost", 0))
	areas = door.get("m_AreasUnlock", [])
	var box: Dictionary = source.components.get("CIsCollisionBox", {})
	_box_half = box.get("m_halfAxis", [150, 150, 5])
	_box_offset = box.get("m_Offset", [0, 150, 0])
	_blocker = box_body(_box_half, _box_offset, Zombie.LAYER_WORLD)
	add_child(_blocker)
	_model = prop_model(source)
	if _model:
		add_child(_model)
	name = display_name()


func needs_power() -> bool:
	return cost == 0


func prompt(player: Player) -> String:
	if is_open or needs_power():
		return "" if is_open else "Requires power"
	var points: int = GameState.points.get(player.player_id, 0)
	return "Hold West to open door [%d]%s" % [cost, "" if points >= cost else "  (not enough points)"]


func use(player: Player) -> void:
	if is_open or needs_power():
		return
	if GameState.spend(player.player_id, cost):
		open()


func open() -> void:
	if is_open:
		return
	is_open = true
	_blocker.queue_free()
	if _model:
		_model.queue_free()
	GameState.open_areas(areas)
	opened.emit(self)


## The door's footprint on the floor (world space) for carving the navmesh while closed.
func footprint() -> PackedVector3Array:
	var s := KinoData.position_scale
	var hx: float = _box_half[0] * s
	var hz: float = maxf(_box_half[2] * s, 0.15)
	var c := Vector3(_box_offset[0], 0.0, _box_offset[2]) * s
	var out := PackedVector3Array()
	for corner in [Vector3(-hx, 0, -hz), Vector3(hx, 0, -hz), Vector3(hx, 0, hz), Vector3(-hx, 0, hz)]:
		out.append(global_transform * (c + corner))
	return out
