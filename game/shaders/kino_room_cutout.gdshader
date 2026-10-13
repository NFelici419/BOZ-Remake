shader_type spatial;
render_mode unshaded, cull_back;

#include "res://shaders/kino_room.gdshaderinc"

void fragment() {
	vec4 colour = room_colour(UV, UV2, COLOR);
	ALBEDO = colour.rgb;
	ALPHA = colour.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
}
