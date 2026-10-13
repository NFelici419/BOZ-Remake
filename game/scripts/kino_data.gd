extends Node
## Autoload "KinoData": the converter's decoded gameplay data
## (assets/converted/kino/data/*.json) with lookups and unit conversion.

const DATA_DIR := "res://assets/converted/kino/data/"

var position_scale := 0.01
var mirror_x := false
var entities: Array = []
var resources: Dictionary = {}
var loaded := false


func _ready() -> void:
	var ents := _read(DATA_DIR + "entities.json")
	resources = _read(DATA_DIR + "resources.json")
	loaded = not ents.is_empty() and not resources.is_empty()
	if not loaded:
		push_warning("KinoData: converted gameplay data missing; run the converter's export-data.")
		return
	position_scale = ents.get("positionScale", 0.01)
	mirror_x = ents.get("mirrorX", false)
	entities = ents.get("entities", [])


static func _read(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed if parsed is Dictionary else {}


## Game-unit position (array of 3) to metres in Godot space.
func world(position: Array) -> Vector3:
	var v := Vector3(position[0], position[1], position[2]) * position_scale
	if mirror_x:
		v.x = -v.x
	return v


func entities_with(component: String, level_only := true) -> Array:
	return entities.filter(func(e): return e.components.has(component) and (not level_only or (e.group.begins_with("levels/kino/") and e.has("position"))))


func entity_named(name: String) -> Dictionary:
	for e in entities:
		if e.name == name:
			return e
	return {}


## First resource of a class (e.g. "CLevel"), or {}.
func first(resource_class: String) -> Dictionary:
	var all: Dictionary = resources.get(resource_class, {})
	return all.values()[0] if not all.is_empty() else {}


## A wave of any wave class by name.
func wave(name: String) -> Dictionary:
	for cls in ["CWave", "CWaveRepeatable", "CWaveSpeciality"]:
		var all: Dictionary = resources.get(cls, {})
		if all.has(name):
			return all[name]
	return {}


## Player weapon definition (CPlayerWeapon) by its m_name, e.g. "colt45".
func weapon(weapon_name: String) -> Dictionary:
	for e in entities:
		var w: Dictionary = e.components.get("CPlayerWeapon", {})
		if w.get("m_name", "") == weapon_name:
			return w
	return {}


## Points for a score subject such as "SUBJECT_ZOMBIE_SCORE_HIT" (CScoreConfig).
func score(subject: String) -> int:
	for pair in first("CScoreConfig").get("m_Scores", []):
		for key in pair:
			if pair[key] is String and pair[key] == subject:
				return int(pair.get("score", 0))
	return 0


## Per-round cap for a score subject (CScoreConfig.m_ScoreLimits), 0 if none.
func score_limit(subject: String) -> int:
	for pair in first("CScoreConfig").get("m_ScoreLimits", []):
		for key in pair:
			if pair[key] is String and pair[key] == subject:
				return int(pair.get("score", 0))
	return 0


## The zombie template's CAIControllerZombie / CHealth / CRigCollision data.
func zombie_template() -> Dictionary:
	for e in entities:
		if e.components.get("CIsEntityProperties", {}).get("m_name", "") == "zombie_kino" and e.components.has("CAIControllerZombie"):
			return e.components
	return {}


func player_template() -> Dictionary:
	for e in entities:
		if e.components.has("CPlayerController"):
			return e.components
	return {}
