class_name Weapon
extends Node3D
## Hitscan player weapon from a CPlayerWeapon definition (clip, ammo, damage
## per hit zone) plus the knife (R3). Fire rate and reload time are not in the
## weapon data, so they come from approximations.json. The gun on screen is a
## placeholder until weapon models and animations are decoded.

signal ammo_changed(clip: int, reserve: int)

const RANGE := 100.0
const TRIGGER_THRESHOLD := 0.5

var player_id := 0
var def: Dictionary
var knife: Dictionary
var clip := 0
var reserve := 0
var fire_interval: float
var reload_seconds: float
var knife_cooldown: float
var _cooldown := 0.0
var _reloading := 0.0
var _trigger_was_down := false
var _model := Node3D.new()
var _flash := MeshInstance3D.new()
var _kick := 0.0


func _init(weapon_name: String, tuning: Dictionary) -> void:
	name = "Weapon"
	def = KinoData.weapon(weapon_name)
	knife = KinoData.weapon("knife")
	clip = int(def.get("m_clipSize", 8))
	reserve = int(def.get("m_ammoSize", 80)) - clip
	fire_interval = tuning.weapon_fire_interval
	reload_seconds = tuning.weapon_reload_seconds
	knife_cooldown = tuning.knife_cooldown
	_build_placeholder()


func _ready() -> void:
	ammo_changed.emit(clip, reserve)


func _build_placeholder() -> void:
	var metal := StandardMaterial3D.new()
	metal.albedo_color = Color(0.12, 0.12, 0.13)
	metal.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var slide := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.035, 0.045, 0.2)
	box.material = metal
	slide.mesh = box
	var grip := MeshInstance3D.new()
	var gbox := BoxMesh.new()
	gbox.size = Vector3(0.03, 0.1, 0.045)
	gbox.material = metal
	grip.mesh = gbox
	grip.position = Vector3(0, -0.06, 0.07)
	grip.rotation.x = -0.25
	_model.add_child(slide)
	_model.add_child(grip)
	_model.position = Vector3(0.14, -0.13, -0.32)
	add_child(_model)
	var flash_mat := StandardMaterial3D.new()
	flash_mat.albedo_color = Color(1.0, 0.85, 0.4)
	flash_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var q := QuadMesh.new()
	q.size = Vector2(0.08, 0.08)
	q.material = flash_mat
	_flash.mesh = q
	_flash.position = Vector3(0.14, -0.11, -0.45)
	_flash.visible = false
	add_child(_flash)


func _process(delta: float) -> void:
	if GameState.is_over:
		return
	_cooldown -= delta
	_kick = maxf(_kick - delta * 6.0, 0.0)
	_model.rotation.x = _kick * 0.5
	_flash.visible = _kick > 0.75
	if _reloading > 0.0:
		_reloading -= delta
		_model.position.y = -0.13 - 0.1 * signf(_reloading)
		if _reloading <= 0.0:
			_finish_reload()
		return
	_model.position.y = -0.13
	var pads := Input.get_connected_joypads()
	var trigger := Input.get_joy_axis(pads[0], JOY_AXIS_TRIGGER_RIGHT) if pads.size() > 0 else 0.0
	var down := trigger > TRIGGER_THRESHOLD
	if down and not _trigger_was_down and _cooldown <= 0.0:
		_fire()
	_trigger_was_down = down
	if Input.is_action_just_pressed("reload"):
		_start_reload()
	if Input.is_action_just_pressed("melee") and _cooldown <= 0.0:
		_melee()


func _fire() -> void:
	if clip == 0:
		_start_reload()
		return
	clip -= 1
	_cooldown = fire_interval
	_kick = 1.0
	ammo_changed.emit(clip, reserve)
	var dmg: Dictionary = def.get("m_damage", {})
	_hit_scan(RANGE, {"head": dmg.get("m_headDamage", 70), "torso": dmg.get("m_torsoDamage", 25), "limb": dmg.get("m_limbDamage", 20)}, "")
	if clip == 0:
		_start_reload()


func _melee() -> void:
	_cooldown = knife_cooldown
	var dmg: float = knife.get("m_damage", {}).get("m_torsoDamage", 200)
	_hit_scan(knife.get("m_meleeRange", 1.5), {"head": dmg, "torso": dmg, "limb": dmg}, "SUBJECT_ZOMBIE_SCORE_KILL_KNIFE")


func _hit_scan(distance: float, damage_by_zone: Dictionary, kill_subject: String) -> void:
	var camera := get_viewport().get_camera_3d()
	var from := camera.global_position
	var to := from - camera.global_basis.z * distance
	var query := PhysicsRayQueryParameters3D.create(from, to, Zombie.LAYER_WORLD | Zombie.LAYER_ZOMBIE)
	query.exclude = [owner.get_rid()] if owner is CollisionObject3D else []
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty() or not (hit.collider is Zombie):
		return
	var zombie: Zombie = hit.collider
	var zone := zombie.zone_for(hit.shape, hit.position)
	zombie.hit(damage_by_zone[zone], zone, player_id, kill_subject)


func _start_reload() -> void:
	var clip_size := int(def.get("m_clipSize", 8))
	if _reloading > 0.0 or clip == clip_size or reserve == 0:
		return
	_reloading = reload_seconds


func _finish_reload() -> void:
	var take := mini(int(def.get("m_clipSize", 8)) - clip, reserve)
	clip += take
	reserve -= take
	ammo_changed.emit(clip, reserve)
