class_name Props
## Prop models from the converter's dynamics.gltf (doors, boards, the box,
## perk machines ...), looked up by the model name hash entities reference.

const DYNAMICS := "res://assets/converted/kino/dynamics.gltf"

static var _scene: Node


## A copy of the prop mesh named `hash` (e.g. "0xdfbe538c"), or null.
static func instance(hash: String) -> Node3D:
	if _scene == null:
		if not ResourceLoader.exists(DYNAMICS):
			return null
		_scene = load(DYNAMICS).instantiate()
	var found := _scene.find_child(hash, true, false) as Node3D
	return found.duplicate() as Node3D if found else null


## Frees the cached prop scene (call when leaving the map).
static func release() -> void:
	if _scene:
		_scene.free()
		_scene = null
