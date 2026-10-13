extends Node
## Autoload "GameState": rules state shared by every system, separate from
## input. Players are identified by id so co-op can be added later.

signal points_changed(player_id: int, points: int)
signal health_changed(player_id: int, health: float, max_health: float)
signal round_changed(round_number: int)
signal game_over(rounds_survived: int)
signal areas_opened(areas: Array)


var points := {}
var round_number := 0
var is_over := false
var open: Dictionary = {} # area name -> true
var _capped_this_round: Dictionary = {} # "player:subject" -> points earned this round


func reset() -> void:
	points.clear()
	round_number = 0
	is_over = false
	open.clear()
	_capped_this_round.clear()


func register_player(player_id: int, start_points: int) -> void:
	points[player_id] = start_points
	points_changed.emit(player_id, start_points)


func award(player_id: int, subject: String) -> void:
	add_points(player_id, KinoData.score(subject))


func add_points(player_id: int, amount: int) -> void:
	if amount == 0 or not points.has(player_id):
		return
	points[player_id] += amount
	points_changed.emit(player_id, points[player_id])


## Takes points if the player has enough.
func spend(player_id: int, amount: int) -> bool:
	if points.get(player_id, 0) < amount:
		return false
	add_points(player_id, -amount)
	return true


## Points for a subject limited per round by CScoreConfig.m_ScoreLimits (e.g. barricade repairs).
func award_capped(player_id: int, subject: String) -> void:
	var limit := KinoData.score_limit(subject)
	var key := "%d:%s" % [player_id, subject]
	var earned: int = _capped_this_round.get(key, 0)
	var amount := KinoData.score(subject)
	if limit > 0:
		amount = clampi(limit - earned, 0, amount)
	_capped_this_round[key] = earned + amount
	add_points(player_id, amount)


func open_areas(areas: Array) -> void:
	var fresh := areas.filter(func(a): return not open.has(a))
	for a in fresh:
		open[a] = true
	if not fresh.is_empty():
		areas_opened.emit(fresh)


func start_round(n: int) -> void:
	_capped_this_round.clear()
	round_number = n
	round_changed.emit(n)


func player_died(_player_id: int) -> void:
	if is_over:
		return
	is_over = true
	game_over.emit(maxi(round_number - 1, 0))
