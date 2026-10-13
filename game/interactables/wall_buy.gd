class_name WallBuy
extends Interactable
## A chalk-outline weapon on the wall (CWeaponChalkOutline). Buying gives the
## gun for m_Cost; buying again when owned refills its ammo for half (the
## original rule). Grenades, claymores and the Bowie knife come later.

## CIsNamed prefix ("M16_WallWeapon") to CPlayerWeapon m_name.
const WEAPONS := {
	"Olympia": "olympia", "M16": "m16", "M14": "m14", "PM63": "pm63", "Stakeout": "stakeout",
	"MP40": "mp40", "MP5K": "mp5k", "AK47U": "ak74u", "MPL": "mpl",
}

var cost := 0
var weapon_name := ""


func _init(source: Dictionary) -> void:
	super(source)
	cost = int(source.components.CWeaponChalkOutline.get("m_Cost", 1000))
	var prefix := display_name().get_slice("_", 0)
	weapon_name = WEAPONS.get(prefix, "")
	name = display_name()
	if weapon_name.is_empty():
		return
	var label := Label3D.new()
	label.text = prefix
	label.font_size = 64
	label.pixel_size = 0.004
	label.modulate = Color(0.9, 0.9, 0.85, 0.85)
	label.billboard = BaseMaterial3D.BILLBOARD_DISABLED
	label.position = Vector3(0, 0, 0.05)
	add_child(label)


func available() -> bool:
	return not weapon_name.is_empty()


func prompt(player: Player) -> String:
	if not available():
		return ""
	var owned := player.weapon.has(weapon_name)
	var price := cost / 2 if owned else cost
	return "Hold West to %s %s [%d]" % ["buy ammo for" if owned else "buy", weapon_name.to_upper(), price]


func use(player: Player) -> void:
	if not available():
		return
	var owned := player.weapon.has(weapon_name)
	if not GameState.spend(player.player_id, cost / 2 if owned else cost):
		return
	if owned:
		player.weapon.refill(weapon_name)
	else:
		player.weapon.give(weapon_name)
