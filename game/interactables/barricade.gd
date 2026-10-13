class_name Barricade
extends Interactable
## A boarded window (CBarricade, m_TotalLevels boards). Zombies from its
## window spawn tear boards off one at a time, then climb in. Holding West
## repairs a board at a time for points (SUBJECT_BARRICADE_FIX, capped per
## round by CScoreConfig.m_ScoreLimits). Boards are placeholders until the
## barricade board model and its animation states are decoded.

const BOARD_SIZE := Vector3(1.3, 0.14, 0.05)

var total := 5
var boards := 5
var _board_meshes: Array[MeshInstance3D] = []


func _init(source: Dictionary) -> void:
	super(source)
	var b: Dictionary = source.components.CBarricade
	total = int(b.get("m_TotalLevels", 5))
	boards = 0 if b.get("m_StartBroken", false) else total
	name = display_name()
	# Keeps players in; zombies are walked through by script.
	add_child(box_body([70, 100, 15], [0, 100, 0], Zombie.LAYER_BARRICADE))
	var wood := StandardMaterial3D.new()
	wood.albedo_color = Color(0.32, 0.22, 0.13)
	wood.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	for i in total:
		var m := MeshInstance3D.new()
		var mesh := BoxMesh.new()
		mesh.size = BOARD_SIZE
		mesh.material = wood
		m.mesh = mesh
		m.position = Vector3(0, 0.45 + i * 0.28, 0)
		m.rotation.z = (0.18 if i % 2 == 0 else -0.15)
		add_child(m)
		_board_meshes.append(m)
	_update()


func is_open() -> bool:
	return boards == 0


## A zombie pulls one board off. Returns true if one was there.
func tear() -> bool:
	if boards == 0:
		return false
	boards -= 1
	_update()
	return true


func prompt(_player: Player) -> String:
	return "Hold West to rebuild barrier" if boards < total else ""


func repeats() -> bool:
	return true


func use(player: Player) -> void:
	if boards >= total:
		return
	boards += 1
	_update()
	GameState.award_capped(player.player_id, "SUBJECT_BARRICADE_FIX")


func _update() -> void:
	for i in _board_meshes.size():
		_board_meshes[i].visible = i < boards
