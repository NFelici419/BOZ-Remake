class_name Capture
extends Node
## Developer screenshots from the command line (after "--"):
##   --at=x,y,z[,yaw_deg[,pitch_deg]]  place the player (metres, degrees)
##   --screenshot=path.png             save a frame after the scene settles, then quit

const SETTLE_FRAMES := 30

var player: Player
var _shot_path := ""
var _frames := 0


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


func _process(_delta: float) -> void:
	if _shot_path.is_empty():
		return
	_frames += 1
	if _frames < SETTLE_FRAMES:
		return
	var err := get_viewport().get_texture().get_image().save_png(_shot_path)
	print("screenshot %s -> %s" % [_shot_path, error_string(err)])
	get_tree().quit()
