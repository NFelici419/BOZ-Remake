class_name Player
extends CharacterBody3D
## First-person gamepad controller. Dimensions come from the converter's
## player.json (original CPlayerController data); speeds from
## data/approximations.json until they are found in the original data.

const STAND_FALLBACK := {"standHeight": 1.5, "crouchHeight": 0.75, "capsuleRadius": 0.3, "capsuleHeight": 2.0}

var dims: Dictionary
var tuning: Dictionary
var feel: Dictionary
var camera: Camera3D
var player_id := 0
var max_health := 230.0
var health := 230.0
var _heal_delay := 1.0
var _heal_time := 7.0
var _since_hit := 0.0
var _pitch := 0.0
var spawn_point := Vector3.ZERO
var _select_held := 0.0

const RESCUE_HOLD_SECONDS := 1.5
const FALL_LIMIT := -30.0


func _init(player_dims: Dictionary, approximations: Dictionary, settings: Dictionary) -> void:
	dims = player_dims
	tuning = approximations
	feel = settings
	name = "Player"
	collision_layer = Zombie.LAYER_PLAYER
	collision_mask = Zombie.LAYER_WORLD | Zombie.LAYER_ZOMBIE
	var template: Dictionary = KinoData.player_template().get("CHealth", {})
	max_health = template.get("m_MaxHealth", 230.0)
	health = max_health
	_heal_delay = template.get("m_HealDelay", 1000.0) / 1000.0
	_heal_time = template.get("m_MaxHealingTime", 7000.0) / 1000.0
	var step: float = tuning.step_height
	# Capsule rides step_height above the feet; a separation ray below it
	# acts as legs, so the body glides up stairs instead of catching on them.
	var capsule := CapsuleShape3D.new()
	capsule.radius = dims.capsuleRadius
	capsule.height = maxf(dims.standHeight - step, capsule.radius * 2.0)
	var body := CollisionShape3D.new()
	body.shape = capsule
	body.position.y = step + capsule.height / 2.0
	add_child(body)
	var ray := SeparationRayShape3D.new()
	ray.length = step + capsule.height / 2.0
	ray.slide_on_slope = true
	var legs := CollisionShape3D.new()
	legs.shape = ray
	legs.position.y = ray.length
	legs.rotation.x = -PI / 2.0
	add_child(legs)
	camera = Camera3D.new()
	camera.position.y = dims.standHeight
	camera.near = 0.05
	camera.far = 500.0
	add_child(camera)


func respawn() -> void:
	global_position = spawn_point
	velocity = Vector3.ZERO
	print("player respawned at start")


## Zombie hits; health regenerates fully m_MaxHealingTime after m_HealDelay (original CHealth).
func take_damage(amount: float) -> void:
	if GameState.is_over:
		return
	health = maxf(health - amount, 0.0)
	_since_hit = 0.0
	GameState.health_changed.emit(player_id, health, max_health)
	if health <= 0.0:
		GameState.player_died(player_id)


func _process(delta: float) -> void:
	# Way out of collision snags: hold Select to return to the start; falling out of the map does it automatically.
	if Input.is_action_pressed("debug_overlay"):
		_select_held += delta
		if _select_held >= RESCUE_HOLD_SECONDS:
			_select_held = -INF
			respawn()
	else:
		_select_held = 0.0
	if global_position.y < FALL_LIMIT:
		respawn()
	_since_hit += delta
	if health < max_health and health > 0.0 and _since_hit >= _heal_delay:
		health = minf(health + max_health / _heal_time * delta, max_health)
		GameState.health_changed.emit(player_id, health, max_health)


func _physics_process(delta: float) -> void:
	if GameState.is_over:
		return
	var pad := _pad()
	var move := Stick.shape(_axes(pad, JOY_AXIS_LEFT_X, JOY_AXIS_LEFT_Y), feel.move_deadzone, feel.response_exponent)
	var look := Stick.shape(_axes(pad, JOY_AXIS_RIGHT_X, JOY_AXIS_RIGHT_Y), feel.look_deadzone, feel.response_exponent)
	var turn := deg_to_rad(feel.look_speed_degrees) * delta
	rotate_y(-look.x * turn)
	_pitch = clampf(_pitch - look.y * turn, -PI * 0.47, PI * 0.47)
	camera.rotation.x = _pitch

	var crouching := Input.is_action_pressed("crouch")
	camera.position.y = lerpf(camera.position.y, dims.crouchHeight if crouching else dims.standHeight, minf(1.0, delta * 12.0))
	var speed: float = tuning.walk_speed
	if crouching:
		speed *= tuning.crouch_multiplier
	elif Input.is_action_pressed("sprint"):
		speed *= tuning.sprint_multiplier
	var direction := transform.basis * Vector3(move.x, 0.0, move.y)
	velocity.x = direction.x * speed
	velocity.z = direction.z * speed
	if is_on_floor():
		if Input.is_action_just_pressed("jump"):
			velocity.y = tuning.jump_velocity
	else:
		velocity.y -= tuning.gravity * delta
	move_and_slide()


## First connected gamepad, or -1.
static func _pad() -> int:
	var pads := Input.get_connected_joypads()
	return pads[0] if pads.size() > 0 else -1


static func _axes(pad: int, x: JoyAxis, y: JoyAxis) -> Vector2:
	if pad < 0:
		return Vector2.ZERO
	return Vector2(Input.get_joy_axis(pad, x), Input.get_joy_axis(pad, y))
