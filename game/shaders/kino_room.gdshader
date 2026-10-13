shader_type spatial;
render_mode unshaded, cull_back;

#include "res://shaders/kino_room.gdshaderinc"

void fragment() {
	ALBEDO = room_colour(UV, UV2, COLOR).rgb;
}
