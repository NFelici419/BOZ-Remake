class_name NavMeshSettings
## Shared by the navmesh bake tool and the runtime re-bake (they must match).

const CELL_SIZE := 0.15
const CELL_HEIGHT := 0.1
const AGENT_RADIUS := 0.3
const AGENT_HEIGHT := 1.8
const AGENT_MAX_CLIMB := 0.4
const AGENT_MAX_SLOPE := 50.0


static func new_mesh() -> NavigationMesh:
	var mesh := NavigationMesh.new()
	mesh.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	mesh.cell_size = CELL_SIZE
	mesh.cell_height = CELL_HEIGHT
	mesh.agent_radius = AGENT_RADIUS
	mesh.agent_height = AGENT_HEIGHT
	mesh.agent_max_climb = AGENT_MAX_CLIMB
	mesh.agent_max_slope = AGENT_MAX_SLOPE
	return mesh
