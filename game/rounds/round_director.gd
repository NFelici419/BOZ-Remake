class_name RoundDirector
extends Node
## Runs rounds from the original wave chain (CLevel.m_StartingWavesSP by
## difficulty, then CWave.m_NextWave, then CWaveRepeatable with its
## multipliers). Spawns at the active area's spawn points; window spawns enter
## at their barricade. Special (hellhound) waves are not in yet.

const DIFFICULTIES := ["easy", "normal", "hard"]

var player: Player
var world: Node3D
var tuning: Dictionary
var _wave: Dictionary
var _wave_name := ""
var _round := 0
var _repeat := 0
var _to_spawn := 0
var _alive := 0
var _timer := 0.0
var _spawning := false
var _spawns: Array = [] # {position: Vector3}
var _template: Dictionary


func _init(target: Player, parent: Node3D, approximations: Dictionary, difficulty: String) -> void:
	name = "RoundDirector"
	player = target
	world = parent
	tuning = approximations
	var starts: Array = KinoData.first("CLevel").get("m_StartingWavesSP", [])
	var index := clampi(DIFFICULTIES.find(difficulty), 0, maxi(starts.size() - 1, 0))
	_wave_name = starts[index] if starts.size() > 0 else ""
	_template = KinoData.zombie_template()


func _ready() -> void:
	_begin_round()


func _begin_round() -> void:
	var w := KinoData.wave(_wave_name)
	if w.is_empty():
		push_warning("RoundDirector: wave %s not found" % _wave_name)
		return
	_round += 1
	if w._class == "CWaveRepeatable" and _wave.get("_class", "") == "CWaveRepeatable":
		_repeat += 1
	_wave = w
	_to_spawn = int(round(w.m_ZombieCount * pow(w.get("m_ZombieCountMultiplier", 1.0), _repeat)))
	_timer = w.get("m_StartingTimer", 1000) / 1000.0
	_spawning = false
	GameState.start_round(_round)
	print("round %d: %s, %d zombies, %d hp" % [_round, _wave_name, _to_spawn, _wave.m_ZombieHealth])


func _process(delta: float) -> void:
	if GameState.is_over or _wave.is_empty():
		return
	_timer -= delta
	if not _spawning:
		if _timer > 0.0:
			return
		_spawning = true
		for i in mini(int(_wave.get("m_StartingZombies", 1)), _to_spawn):
			_spawn_one()
		_timer = _timeout()
		return
	if _to_spawn > 0 and _timer <= 0.0:
		_timer = _timeout()
		if _alive < _max_active():
			_spawn_one()
	if _to_spawn == 0 and _alive == 0:
		_next_wave()


func _timeout() -> float:
	return _wave.get("m_TimeOut", 4000) * pow(_wave.get("m_TimeOutMultiplier", 1.0), _repeat) / 1000.0


func _max_active() -> int:
	return int(round(_wave.get("m_MaxActive", 6) * pow(_wave.get("m_MaxActiveMultiplier", 1.0), _repeat)))


func _next_wave() -> void:
	if _wave._class != "CWaveRepeatable":
		_wave_name = _wave.get("m_NextWave", _wave_name)
	_wave = {}
	await get_tree().create_timer(4.0).timeout
	_begin_round()


func _spawn_one() -> void:
	if _spawns.is_empty():
		_spawns = _spawn_entries()
		if _spawns.is_empty():
			push_warning("RoundDirector: no usable spawn points")
			_to_spawn = 0
			return
	var health: float = _wave.m_ZombieHealth * pow(_wave.get("m_ZombieHealthMultiplier", 1.0), _repeat)
	var zombie := Zombie.new(_template, health, _pick_gait(), tuning, KinoData.position_scale)
	zombie.target = player
	zombie.died.connect(_on_zombie_died)
	world.add_child(zombie)
	zombie.global_position = _spawns.pick_random().position
	_to_spawn -= 1
	_alive += 1


func _pick_gait() -> Zombie.Gait:
	var weights := [_wave.get("m_ZombieWalk", 1.0), _wave.get("m_ZombieWalkFast", 0.0), _wave.get("m_ZombieRun", 0.0), _wave.get("m_ZombieSprint", 0.0)]
	var total := 0.0
	for w in weights:
		total += w
	var roll := randf() * maxf(total, 0.0001)
	for i in weights.size():
		roll -= weights[i]
		if roll <= 0.0:
			return i as Zombie.Gait
	return Zombie.Gait.WALK


func _on_zombie_died(_zombie: Zombie, killer_id: int, subject: String) -> void:
	_alive -= 1
	GameState.award(killer_id, subject)
	print("kill %s; %d left to spawn, %d alive, points %s" % [subject.trim_prefix("SUBJECT_ZOMBIE_SCORE_"), _to_spawn, _alive, GameState.points.values()])


## Entry points on the navmesh for the starting area's spawn points.
func _spawn_entries() -> Array:
	var map := world.get_world_3d().navigation_map
	var area_name: String = str(KinoData.first("CLevel").get("m_StartingArea", ""))
	var spawn_names: Array = KinoData.resources.get("CArea", {}).get(area_name, {}).get("m_SpawnPoints", [])
	var barricades := KinoData.entities_with("CBarricade").map(func(e): return KinoData.world(e.position))
	var out := []
	for spawn_name in spawn_names:
		var e := KinoData.entity_named(spawn_name)
		if e.is_empty() or not e.has("position"):
			continue
		var p := KinoData.world(e.position)
		if str(e.components.CSpawnPoint.get("spawnType", "")) == "windows":
			var nearest: Variant = _nearest(barricades, p, 6.0)
			if nearest != null:
				p = nearest + (nearest - p).normalized() * 1.0
		var on_mesh := NavigationServer3D.map_get_closest_point(map, p)
		if on_mesh.distance_to(p) < 3.0:
			out.append({"position": on_mesh + Vector3.UP * 0.1})
	print("RoundDirector: %d of %d spawn points usable in %s" % [out.size(), spawn_names.size(), area_name])
	return out


static func _nearest(points: Array, p: Vector3, max_distance: float) -> Variant:
	var best: Variant = null
	var best_d := max_distance
	for q in points:
		var d: float = q.distance_to(p)
		if d < best_d:
			best_d = d
			best = q
	return best
