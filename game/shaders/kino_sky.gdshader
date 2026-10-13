shader_type sky;

uniform samplerCube sky_cube : source_color, filter_linear;

void sky() {
	COLOR = texture(sky_cube, EYEDIR).rgb;
}
