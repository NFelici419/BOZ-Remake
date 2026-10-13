class_name RoundDirector
extends Node
## Runs rounds from the original wave chain (CLevel.m_StartingWavesSP by
## difficulty, then CWave.m_NextWave, then CWaveRepeatable with its
## multipliers). Spawns at the spawn points of every open area (CArea);
## window spawns walk to their barricade, tear it down and climb in.
## Special (hellhound) waves are not in yet.

## Zombie spawn types (CSpawnPoint.spawnType); the remaining type is hellhounds.
const ZOMBIE_SPAWN_TYPES := ["windows", "ground", "hole"]

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
var _spawns: Array = [] # {position: Vector3, barricade: Barricade, outside: Vector3, inside: Vector3}
var _spawns_dirty := true
var _template: Dictionary
var barricades: Array[Barricade] = []


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
	GameState.areas_opened.connect(func(_areas): _spawns_dirty = true)
	var start: String = str(KinoData.first("CLevel").get("m_StartingArea", ""))
	GameState.open_areas([start])
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
	if _spawns_dirty:
		_spawns = _spawn_entries()
		_spawns_dirty = false
		if _spawns.is_empty():
			push_warning("RoundDirector: no usable spawn points")
			_to_spawn = 0
			return
	var health: float = _wave.m_ZombieHealth * pow(_wave.get("m_ZombieHealthMultiplier", 1.0), _repeat)
	var zombie := Zombie.new(_template, health, _pick_gait(), tuning, KinoData.position_scale)
	zombie.target = player
	zombie.died.connect(_on_zombie_died)
	world.add_child(zombie)
	var spawn: Dictionary = _spawns.pick_random()
	zombie.global_position = spawn.position
	if spawn.barricade:
		zombie.enter_through(spawn.barricade, spawn.outside, spawn.inside, tuning.zombie_seconds_per_board)
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


## Where zombies appear: every zombie spawn point of the open areas. Window
## spawns get their barricade (same name prefix, else the nearest) and walk in.
func _spawn_entries() -> Array:
	var map := world.get_world_3d().navigation_map
	var out := []
	for area in GameState.open:
		for spawn_name in KinoData.resources.get("CArea", {}).get(area, {}).get("m_SpawnPoints", []):
			var e := KinoData.entity_named(spawn_name)
			if e.is_empty() or not e.has("position"):
				continue
			var kind := str(e.components.CSpawnPoint.get("spawnType", ""))
			if kind not in ZOMBIE_SPAWN_TYPES:
				continue
			var p := KinoData.world(e.position)
			var entry := {"position": p, "barricade": null, "outside": p, "inside": p}
			if kind == "windows":
				var window := _barricade_for(str(e.components.get("CIsNamed", {}).get("0x7c9b0c46", "")), p)
				if window == null:
					continue
				# The window normal; the outside face is the one on the spawn side.
				var normal := window.global_basis.z
				normal.y = 0.0
				normal = normal.normalized()
				if normal.dot(p - window.global_position) < 0.0:
					normal = -normal
				var base := window.global_position
				entry.barricade = window
				entry.outside = NavigationServer3D.map_get_closest_point(map, base + normal * 0.7)
				entry.inside = NavigationServer3D.map_get_closest_point(map, base - normal * 0.9)
				var start := NavigationServer3D.map_get_closest_point(map, p)
				if start.distance_to(p) > 6.0:
					continue
				entry.position = start
			elif kind == "hole":
				entry.position = p # crawlers drop from the ceiling
			else:
				var on_mesh := NavigationServer3D.map_get_closest_point(map, p)
				if on_mesh.distance_to(p) > 3.0:
					continue
				entry.position = on_mesh + Vector3.UP * 0.1
			out.append(entry)
	print("RoundDirector: %d zombie spawn points in %d open areas" % [out.size(), GameState.open.size()])
	return out


## The barricade a window spawn belongs to: matching name prefix, else nearest within 6 m (3D).
func _barricade_for(spawn_name: String, p: Vector3) -> Barricade:
	var prefix := spawn_name.get_slice("_", 0).to_lower()
	var best: Barricade = null
	var best_d := 6.0
	for window in barricades:
		var d := window.global_position.distance_to(p)
		if window.name.to_lower().begins_with(prefix):
			return window
		if d < best_d:
			best_d = d
			best = window
	return best


static func _nearest(points: Array, p: Vector3, max_distance: float) -> Variant:
	var best: Variant = null
	var best_d := max_distance
	for q in points:
		var d: float = q.distance_to(p)
		if d < best_d:
			best_d = d
			best = q
	return best
