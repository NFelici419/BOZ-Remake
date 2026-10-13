class_name Zombie
extends CharacterBody3D
## A zombie with the original's numbers (health from the wave, 115 damage,
## head/torso hit zones from CRigCollision). The body is a placeholder until
## the skinned zombie model and its animations are decoded.

signal died(zombie: Zombie, killer_id: int, subject: String)

const LAYER_WORLD := 1
const LAYER_PLAYER := 2
const LAYER_ZOMBIE := 4
const LAYER_BARRICADE := 8 # stops players at windows; zombies are walked through by script
const REPATH_SECONDS := 0.25
const LIMB_HEIGHT := 0.8 # hits on the torso shape below this height count as limbs

enum Gait { WALK, WALK_FAST, RUN, SPRINT }

var health: float
var speed: float
var damage: float
var attack_radius: float
var attack_interval: float
var target: Node3D
var _agent := NavigationAgent3D.new()
var _repath := 0.0
var _attack_cooldown := 0.0
var _dead := false
## Window entry: walk to the outside of the barricade, tear the boards, climb in.
var barricade: Barricade
var outside_point: Vector3
var inside_point: Vector3
var tear_interval := 1.5
var _tear_timer := 0.0
enum State { OUTSIDE, TEARING, CLIMBING, CHASING }
var state := State.CHASING
var _climb := 0.0


## `template` is KinoData.zombie_template(); `tuning` is approximations.json.
func _init(template: Dictionary, wave_health: float, gait: Gait, tuning: Dictionary, scale: float) -> void:
	name = "Zombie"
	add_to_group("zombies")
	health = wave_health
	var ai: Dictionary = template.get("CAIControllerZombie", {})
	damage = ai.get("m_damage", 115.0)
	attack_radius = ai.get("attackingRadius", 220.0) * scale * tuning.zombie_attack_radius_factor
	attack_interval = tuning.zombie_attack_interval
	var key: String = ["m_walkingSpeedModifiers", "m_walkingFastSpeedModifiers", "m_runningSpeedModifiers", "m_sprintingSpeedModifiers"][gait]
	var range: Array = ai.get(key, [1.0, 1.0])
	var base: float = tuning.zombie_gait_speeds[gait]
	speed = base * randf_range(range[0], range[-1])
	collision_layer = LAYER_ZOMBIE
	collision_mask = LAYER_WORLD | LAYER_PLAYER
	_build_body(template, scale)
	_agent.radius = NavMeshSettings.AGENT_RADIUS
	_agent.height = NavMeshSettings.AGENT_HEIGHT
	_agent.path_desired_distance = 0.6
	_agent.target_desired_distance = 0.5
	add_child(_agent)


## Hit zones from CRigCollision (head sphere r30, torso capsule r26), placeholder meshes on top.
func _build_body(template: Dictionary, scale: float) -> void:
	var head_r := 0.3
	var torso_r := 0.26
	for shape in template.get("CRigCollision", {}).get("m_Shapes", []):
		if shape.get("m_name", "") == "head":
			head_r = shape.get("0x18df096d", 30.0) * scale
		elif shape.get("m_name", "") == "torso":
			torso_r = shape.get("0x18df096d", 26.0) * scale
	var torso := CollisionShape3D.new()
	torso.name = "torso"
	var capsule := CapsuleShape3D.new()
	capsule.radius = torso_r
	capsule.height = 1.5
	torso.shape = capsule
	torso.position.y = 0.75
	add_child(torso)
	var head := CollisionShape3D.new()
	head.name = "head"
	var sphere := SphereShape3D.new()
	sphere.radius = head_r * 0.6
	head.shape = sphere
	head.position.y = 1.62
	add_child(head)
	var skin := StandardMaterial3D.new()
	skin.albedo_color = Color(0.35, 0.38, 0.3)
	var body_mesh := MeshInstance3D.new()
	var cm := CapsuleMesh.new()
	cm.radius = torso_r
	cm.height = 1.5
	cm.material = skin
	body_mesh.mesh = cm
	body_mesh.position.y = 0.75
	add_child(body_mesh)
	var head_mesh := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = head_r * 0.6
	sm.height = head_r * 1.2
	var head_mat := StandardMaterial3D.new()
	head_mat.albedo_color = Color(0.45, 0.42, 0.35)
	sm.material = head_mat
	head_mesh.mesh = sm
	head_mesh.position.y = 1.62
	add_child(head_mesh)


## Sends this zombie in through a barricaded window.
func enter_through(window: Barricade, outside: Vector3, inside: Vector3, seconds_per_board: float) -> void:
	barricade = window
	outside_point = outside
	inside_point = inside
	tear_interval = seconds_per_board
	state = State.OUTSIDE
	collision_mask = LAYER_WORLD
	_agent.target_position = outside


## Follows the navmesh path without physics: the routes outside the windows
## have no floor collision in the room geometry, only navmesh.
func _walk_towards(point: Vector3, delta: float) -> void:
	var next := _agent.get_next_path_position() if not _agent.is_navigation_finished() else point
	var to := next - global_position
	var step := speed * delta
	global_position = next if to.length() <= step else global_position + to.normalized() * step
	to.y = 0.0
	if to.length() > 0.01:
		look_at(global_position + to, Vector3.UP)


func _window_step(delta: float) -> void:
	match state:
		State.OUTSIDE:
			var to := outside_point - global_position
			to.y = 0.0
			if to.length() < 0.45:
				state = State.TEARING
				_tear_timer = tear_interval
				var face := barricade.global_position - global_position
				face.y = 0.0
				if face.length() > 0.01:
					look_at(global_position + face, Vector3.UP)
			else:
				_walk_towards(outside_point, delta)
		State.TEARING:
			if barricade.is_open():
				state = State.CLIMBING
				_climb = 0.0
				return
			_tear_timer -= delta
			if _tear_timer <= 0.0:
				_tear_timer = tear_interval
				barricade.tear()
		State.CLIMBING:
			collision_mask = 0
			_climb += delta
			global_position = outside_point.lerp(inside_point, clampf(_climb / 1.2, 0.0, 1.0)) + Vector3.UP * sin(clampf(_climb / 1.2, 0.0, 1.0) * PI) * 0.8
			if _climb >= 1.2:
				state = State.CHASING
				collision_mask = LAYER_WORLD | LAYER_PLAYER


func _physics_process(delta: float) -> void:
	if _dead or target == null:
		return
	if state != State.CHASING:
		_window_step(delta)
		return
	_repath -= delta
	if _repath <= 0.0:
		_repath = REPATH_SECONDS
		_agent.target_position = target.global_position
	var to_target := target.global_position - global_position
	to_target.y = 0.0
	var close := to_target.length() <= attack_radius
	var move := Vector3.ZERO
	if not close and not _agent.is_navigation_finished():
		var next := _agent.get_next_path_position() - global_position
		next.y = 0.0
		if next.length() > 0.01:
			move = next.normalized() * speed
	if to_target.length() > 0.01:
		look_at(global_position + to_target, Vector3.UP)
	velocity.x = move.x
	velocity.z = move.z
	velocity.y = 0.0 if is_on_floor() else velocity.y - 9.8 * delta
	move_and_slide()
	_attack_cooldown -= delta
	if close and _attack_cooldown <= 0.0 and target.has_method("take_damage"):
		_attack_cooldown = attack_interval
		target.take_damage(damage)


## Applies a hit. `zone` is "head", "torso" or "limb". Returns true if it killed.
func hit(amount: float, zone: String, attacker_id: int, kill_subject := "") -> bool:
	if _dead:
		return false
	health -= amount
	if health > 0.0:
		GameState.award(attacker_id, "SUBJECT_ZOMBIE_SCORE_HIT")
		return false
	_dead = true
	var subject := kill_subject
	if subject.is_empty():
		subject = {"head": "SUBJECT_ZOMBIE_SCORE_KILL_HEAD", "limb": "SUBJECT_ZOMBIE_SCORE_KILL_LIMB"}.get(zone, "SUBJECT_ZOMBIE_SCORE_KILL_TORSO")
	died.emit(self, attacker_id, subject)
	queue_free()
	return true


## Which hit zone a ray hit, from the collision shape it struck.
func zone_for(shape_index: int, hit_position: Vector3) -> String:
	var owner_id := shape_find_owner(shape_index)
	var shape_node := shape_owner_get_owner(owner_id) as Node
	if shape_node and shape_node.name == "head":
		return "head"
	return "limb" if hit_position.y - global_position.y < LIMB_HEIGHT else "torso"
