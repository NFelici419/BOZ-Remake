extends Node
## Autoload "GameState": rules state shared by every system, separate from
## input. Players are identified by id so co-op can be added later.

signal points_changed(player_id: int, points: int)
signal health_changed(player_id: int, health: float, max_health: float)
signal round_changed(round_number: int)
signal game_over(rounds_survived: int)


var points := {}
var round_number := 0
var is_over := false


func reset() -> void:
	points.clear()
	round_number = 0
	is_over = false


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


func start_round(n: int) -> void:
	round_number = n
	round_changed.emit(n)


func player_died(_player_id: int) -> void:
	if is_over:
		return
	is_over = true
	game_over.emit(maxi(round_number - 1, 0))
