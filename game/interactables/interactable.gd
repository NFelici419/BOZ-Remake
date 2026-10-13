class_name Interactable
extends Node3D
## Something the player uses by holding West nearby: a door, barricade or
## wall-buy. Reach comes from the entity's CPOI m_MaxDistance.

var reach := 2.0 # metres
var entity: Dictionary


func _init(source: Dictionary) -> void:
	entity = source
	if source.has("position"):
		position = KinoData.world(source.position)
	if source.has("rotation"):
		var r: Array = source.rotation
		quaternion = Quaternion(r[0], -r[1] if KinoData.mirror_x else r[1], -r[2] if KinoData.mirror_x else r[2], r[3]).normalized()
	reach = source.get("components", {}).get("CPOI", {}).get("m_MaxDistance", 200.0) * KinoData.position_scale
	add_to_group("interactables")


## The entity name from CIsNamed, e.g. "Lobby_To_Atrium".
func display_name() -> String:
	return str(entity.get("components", {}).get("CIsNamed", {}).get("0x7c9b0c46", ""))


## Text shown while the player is in reach, or "" when there is nothing to do.
func prompt(_player: Player) -> String:
	return ""


## Called once per completed hold of West.
func use(_player: Player) -> void:
	pass


## Barricade repair repeats while West is held; others act once per hold.
func repeats() -> bool:
	return false


func in_reach(player: Player) -> bool:
	return global_position.distance_to(player.global_position) <= reach + 0.5


## A box of game-unit half extents at an offset, in this node's space.
static func box_body(half_axis: Array, offset: Array, layer: int) -> StaticBody3D:
	var s := KinoData.position_scale
	var body := StaticBody3D.new()
	body.collision_layer = layer
	body.collision_mask = 0
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(half_axis[0], half_axis[1], half_axis[2]) * 2.0 * s
	shape.shape = box
	shape.position = Vector3(offset[0], offset[1], offset[2]) * s
	body.add_child(shape)
	return body


## The prop model an entity renders (from dynamics.gltf), or null.
static func prop_model(source: Dictionary) -> Node3D:
	var assets: Array = source.get("components", {}).get("CIsRenderableModel", {}).get("assets", [])
	if assets.is_empty():
		return null
	return Props.instance(str(assets[0].get("0x0ff203f6", "")))
