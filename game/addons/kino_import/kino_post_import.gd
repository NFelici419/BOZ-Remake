@tool
extends EditorScenePostImportPlugin
## Runs when Godot imports the converter's kino.gltf. Replaces every imported
## material with the original room shader (vertex colour x texture x lightmap,
## unshaded) and gives every room mesh trimesh collision.

const ROOM_SHADER := preload("res://shaders/kino_room.gdshader")
const CUTOUT_SHADER := preload("res://shaders/kino_room_cutout.gdshader")
## Root node name Godot gives the imported scene (the file's base name).
const KINO_ROOT := "kino"


func _post_process(scene: Node) -> void:
	if scene.name != KINO_ROOT:
		return
	var converted := {}
	for node in scene.find_children("*", "MeshInstance3D", true, false):
		var mesh_instance := node as MeshInstance3D
		var mesh := mesh_instance.mesh
		for surface in mesh.get_surface_count():
			var source := mesh.surface_get_material(surface)
			if not converted.has(source):
				converted[source] = room_material(source)
			mesh.surface_set_material(surface, converted[source])
		add_collision(mesh_instance, scene)


## Room material equivalent of an imported glTF material: base colour texture,
## lightmap from the occlusion slot (UV2), alpha cut-out for MASK materials.
static func room_material(source: Material) -> ShaderMaterial:
	var standard := source as BaseMaterial3D
	var cutout := standard != null and standard.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	var material := ShaderMaterial.new()
	material.shader = CUTOUT_SHADER if cutout else ROOM_SHADER
	material.resource_name = source.resource_name if source else "missing"
	if standard:
		material.set_shader_parameter("base_texture", standard.albedo_texture)
		material.set_shader_parameter("base_color", standard.albedo_color)
		var lightmap := standard.ao_texture if standard.ao_enabled else null
		material.set_shader_parameter("lightmap_texture", lightmap)
		material.set_shader_parameter("use_lightmap", lightmap != null)
	return material


static func add_collision(mesh_instance: MeshInstance3D, owner: Node) -> void:
	var body := StaticBody3D.new()
	body.name = "collision"
	var shape := CollisionShape3D.new()
	shape.shape = mesh_instance.mesh.create_trimesh_shape()
	body.add_child(shape)
	mesh_instance.add_child(body)
	body.owner = owner
	shape.owner = owner
