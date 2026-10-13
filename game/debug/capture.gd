class_name Capture
extends Node
## Developer screenshots from the command line (after "--"):
##   --at=x,y,z[,yaw_deg[,pitch_deg]]  place the player (metres, degrees)
##   --screenshot=path.png             save a frame after the scene settles, then quit
##   --wait=seconds                    wait this long before the screenshot (default: 30 frames)
##   --bot                             aim at the nearest zombie's head and fire (tests the combat loop)
##   --points=N / --open=DoorName / --give=weapon   economy test helpers

const SETTLE_FRAMES := 30

var player: Player
var _shot_path := ""
var _frames := 0
var _wait := -1.0
var _bot := false
var _bot_timer := 0.0
var _deferred: Array[String] = []


func _init(target: Player) -> void:
	player = target
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--at="):
			var v := arg.substr(5).split(",")
			player.position = Vector3(v[0].to_float(), v[1].to_float(), v[2].to_float())
			if v.size() > 3:
				player.rotation.y = deg_to_rad(v[3].to_float())
			if v.size() > 4:
				player.camera.rotation.x = deg_to_rad(v[4].to_float())
				player.set("_pitch", player.camera.rotation.x)
		elif arg.begins_with("--screenshot="):
			_shot_path = arg.substr(13)
		elif arg.begins_with("--wait="):
			_wait = arg.substr(7).to_float()
		elif arg == "--bot":
			_bot = true
		elif arg.begins_with("--points=") or arg.begins_with("--open=") or arg.begins_with("--give="):
			_deferred.append(arg)


func _process(delta: float) -> void:
	_frames += 1
	if _frames == 5:
		_run_deferred()
	if _bot:
		_run_bot(delta)
	if _shot_path.is_empty():
		return
	_wait -= delta
	if _frames < SETTLE_FRAMES or _wait > 0.0:
		return
	var err := get_viewport().get_texture().get_image().save_png(_shot_path)
	print("screenshot %s -> %s" % [_shot_path, error_string(err)])
	get_tree().quit()


func _run_bot(delta: float) -> void:
	_bot_timer -= delta
	if _bot_timer > 0.0 or GameState.is_over:
		return
	_bot_timer = 0.35
	var best: Zombie = null
	var space := player.get_world_3d().direct_space_state
	for z in player.get_tree().get_nodes_in_group("zombies"):
		var los := PhysicsRayQueryParameters3D.create(player.camera.global_position, z.global_position + Vector3.UP * 1.62, Zombie.LAYER_WORLD | Zombie.LAYER_ZOMBIE)
		if space.intersect_ray(los).get("collider") != z:
			continue
		if best == null or z.global_position.distance_to(player.global_position) < best.global_position.distance_to(player.global_position):
			best = z
	if best == null:
		return
	var head := best.global_position + Vector3.UP * 1.62
	var eye := player.camera.global_position
	var flat := Vector2(head.x - eye.x, head.z - eye.z)
	player.rotation.y = atan2(-flat.x, -flat.y)
	player.camera.rotation.x = atan2(head.y - eye.y, flat.length())
	player.set("_pitch", player.camera.rotation.x)
	var weapon: Weapon = player.camera.get_node_or_null("Weapon")
	if weapon:
		weapon.call("_fire")


func _run_deferred() -> void:
	for arg in _deferred:
		var value := arg.get_slice("=", 1)
		if arg.begins_with("--points="):
			GameState.add_points(player.player_id, value.to_int())
		elif arg.begins_with("--give="):
			player.weapon.give(value)
		elif arg.begins_with("--open="):
			for node in player.get_tree().get_nodes_in_group("interactables"):
				if node is Door and node.name == value:
					node.use(player)
					print("opened %s: open=%s areas=%s points=%s" % [value, node.is_open, GameState.open.keys(), GameState.points.values()])
