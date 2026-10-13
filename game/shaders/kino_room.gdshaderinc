// The original room shader (ingame/shaders/shaders.group.bin):
//   modulatedColour = vertexColour * terrainTex(UV0) * lightmapTex(UV1)
// Unshaded: the lightmaps and vertex colours carry all lighting.

uniform sampler2D base_texture : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform vec4 base_color : source_color = vec4(1.0);
uniform sampler2D lightmap_texture : source_color, filter_linear, repeat_enable, hint_default_white;
uniform bool use_lightmap = false;

// Vertex colours arrive as the original bytes (gamma space). Textures are
// decoded to linear by source_color, so the colour is linearised too: the
// product then matches the original gamma-space multiply after output encoding.
vec3 srgb_to_linear(vec3 c) {
	return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, lessThan(c, vec3(0.04045)));
}

vec4 room_colour(vec2 uv, vec2 uv2, vec4 vertex_colour) {
	vec4 base = texture(base_texture, uv) * base_color;
	vec3 light = use_lightmap ? texture(lightmap_texture, uv2).rgb : vec3(1.0);
	return vec4(srgb_to_linear(vertex_colour.rgb) * base.rgb * light, vertex_colour.a * base.a);
}
