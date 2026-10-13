class_name Weapon
extends Node3D
## The player's guns: two slots (North switches) plus the knife (R3), each gun
## driven by its CPlayerWeapon definition: clip/ammo, damage per hit zone,
## fire mode from `behaviour` (1 semi, 2 auto, 3 burst, 4 shotgun), fire rate
## from the RPM field where the data has one, shotgun damage falloff. Values
## the data lacks (semi-auto rate, reload time, pellets) come from
## approximations.json. The gun on screen is a placeholder until weapon
## models and animations are decoded.

signal ammo_changed(clip: int, reserve: int)
signal weapon_changed(weapon_name: String)

const RANGE := 100.0
const TRIGGER_THRESHOLD := 0.5
const RPM_FIELD := "0x47ee2045" # rounds per minute (m16 937, mp40 535)
const MAX_SLOTS := 2

enum Mode { SEMI = 1, AUTO = 2, BURST = 3, SHOTGUN = 4 }

## One owned gun: its definition and ammo.
class Gun:
	var name: String
	var def: Dictionary
	var clip: int
	var reserve: int

	func _init(weapon_name: String, definition: Dictionary) -> void:
		name = weapon_name
		def = definition
		clip = int(def.get("m_clipSize", 8))
		reserve = int(def.get("m_ammoSize", 80)) - clip

	func max_reserve() -> int:
		return int(def.get("m_ammoSize", 80)) - int(def.get("m_clipSize", 8))


var player_id := 0
var tuning: Dictionary
var guns: Array[Gun] = []
var current := 0
var knife: Dictionary
var _cooldown := 0.0
var _reloading := 0.0
var _burst_left := 0
var _trigger_was_down := false
var _model := Node3D.new()
var _flash := MeshInstance3D.new()
var _kick := 0.0


func _init(start_weapon: String, approximations: Dictionary) -> void:
	name = "Weapon"
	tuning = approximations
	knife = KinoData.weapon("knife")
	give(start_weapon)
	_build_placeholder()


func _ready() -> void:
	_announce()


var clip: int:
	get:
		return gun().clip if gun() else 0

var reserve: int:
	get:
		return gun().reserve if gun() else 0


func gun() -> Gun:
	return guns[current] if current < guns.size() else null


func has(weapon_name: String) -> bool:
	return guns.any(func(g): return g.name == weapon_name)


## Gives a gun; with both slots full it replaces the one in hand (original rule).
func give(weapon_name: String) -> void:
	var def := KinoData.weapon(weapon_name)
	if def.is_empty():
		push_warning("Weapon: no definition for %s" % weapon_name)
		return
	var new_gun := Gun.new(weapon_name, def)
	if guns.size() < MAX_SLOTS:
		guns.append(new_gun)
		current = guns.size() - 1
	else:
		guns[current] = new_gun
	_reloading = 0.0
	_announce()


func refill(weapon_name: String) -> void:
	for g in guns:
		if g.name == weapon_name:
			g.clip = int(g.def.get("m_clipSize", 8))
			g.reserve = g.max_reserve()
	_announce()


func refill_all() -> void:
	for g in guns:
		refill(g.name)


func _announce() -> void:
	if gun():
		ammo_changed.emit(gun().clip, gun().reserve)
		weapon_changed.emit(gun().name)


func _mode() -> Mode:
	return int(gun().def.get("behaviour", 1)) as Mode if gun() else Mode.SEMI


func _fire_interval() -> float:
	var rpm: float = gun().def.get(RPM_FIELD, 0.0)
	if rpm > 0.0:
		return 60.0 / rpm
	return tuning.shotgun_fire_interval if _mode() == Mode.SHOTGUN else tuning.weapon_fire_interval


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
	if GameState.is_over or gun() == null:
		return
	_cooldown -= delta
	_kick = maxf(_kick - delta * 6.0, 0.0)
	_model.rotation.x = _kick * 0.5
	_flash.visible = _kick > 0.75
	if Input.is_action_just_pressed("switch_weapon") and guns.size() > 1:
		current = (current + 1) % guns.size()
		_reloading = 0.0
		_burst_left = 0
		_cooldown = 0.4
		_announce()
	if _reloading > 0.0:
		_reloading -= delta
		_model.position.y = -0.23
		if _reloading <= 0.0:
			_finish_reload()
		return
	_model.position.y = -0.13
	var pads := Input.get_connected_joypads()
	var trigger := Input.get_joy_axis(pads[0], JOY_AXIS_TRIGGER_RIGHT) if pads.size() > 0 else 0.0
	var down := trigger > TRIGGER_THRESHOLD
	var pressed := down and not _trigger_was_down
	_trigger_was_down = down
	if _cooldown <= 0.0:
		if _burst_left > 0:
			_burst_left -= 1
			_fire()
		elif pressed or (down and _mode() == Mode.AUTO):
			if _mode() == Mode.BURST:
				_burst_left = int(gun().def.get("semiBurst", 3)) - 1
			_fire()
	if Input.is_action_just_pressed("melee") and _cooldown <= 0.0:
		_melee()


## A tap of West (the use/buy hold is handled by the player).
func request_reload() -> void:
	_start_reload()


func _fire() -> void:
	var g := gun()
	if g.clip == 0:
		_burst_left = 0
		_start_reload()
		return
	g.clip -= 1
	_cooldown = _fire_interval()
	_kick = 1.0
	ammo_changed.emit(g.clip, g.reserve)
	var dmg: Dictionary = g.def.get("m_damage", {})
	var zones := {"head": dmg.get("m_headDamage", 70), "torso": dmg.get("m_torsoDamage", 25), "limb": dmg.get("m_limbDamage", 20)}
	if _mode() == Mode.SHOTGUN:
		var spread: float = g.def.get("m_accuracy", {}).get("m_spreadMax", 0.6) * tuning.shotgun_spread_degrees_per_unit
		for i in int(tuning.shotgun_pellets):
			_hit_scan(RANGE, zones, "", deg_to_rad(spread), g.def.get("m_falloff", {}))
	else:
		_hit_scan(RANGE, zones, "", 0.0, {})
	if g.clip == 0:
		_burst_left = 0
		_start_reload()


func _melee() -> void:
	_cooldown = tuning.knife_cooldown
	var dmg: float = knife.get("m_damage", {}).get("m_torsoDamage", 200)
	_hit_scan(knife.get("m_meleeRange", 1.5), {"head": dmg, "torso": dmg, "limb": dmg}, "SUBJECT_ZOMBIE_SCORE_KILL_KNIFE", 0.0, {})


func _hit_scan(distance: float, damage_by_zone: Dictionary, kill_subject: String, spread: float, falloff: Dictionary) -> void:
	var camera := get_viewport().get_camera_3d()
	var from := camera.global_position
	var direction := -camera.global_basis.z
	if spread > 0.0:
		direction = direction.rotated(camera.global_basis.x, randf_range(-spread, spread)).rotated(camera.global_basis.y, randf_range(-spread, spread))
	var query := PhysicsRayQueryParameters3D.create(from, from + direction * distance, Zombie.LAYER_WORLD | Zombie.LAYER_ZOMBIE)
	query.exclude = [owner.get_rid()] if owner is CollisionObject3D else []
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty() or not (hit.collider is Zombie):
		return
	var zombie: Zombie = hit.collider
	var zone := zombie.zone_for(hit.shape, hit.position)
	var amount: float = damage_by_zone[zone]
	if not falloff.is_empty():
		# CWeaponFalloff: full damage to m_startDistance, m_damageMod percent from m_endDistance (game units)
		var d: float = from.distance_to(hit.position) / KinoData.position_scale
		var t := clampf(inverse_lerp(falloff.get("m_startDistance", 400.0), falloff.get("m_endDistance", 800.0), d), 0.0, 1.0)
		amount *= lerpf(1.0, falloff.get("m_damageMod", 50.0) / 100.0, t)
	zombie.hit(amount, zone, player_id, kill_subject)


func _start_reload() -> void:
	var g := gun()
	if g == null or _reloading > 0.0 or g.clip == int(g.def.get("m_clipSize", 8)) or g.reserve == 0:
		return
	_reloading = tuning.weapon_reload_seconds


func _finish_reload() -> void:
	var g := gun()
	var take := mini(int(g.def.get("m_clipSize", 8)) - g.clip, g.reserve)
	g.clip += take
	g.reserve -= take
	ammo_changed.emit(g.clip, g.reserve)
