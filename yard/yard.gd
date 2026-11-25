extends Node3D

const PanelRoom = preload("res://panel_room.gd")
const VIEWS := {
	"overview": [Vector3(16.0, 14.0, 25.5), Vector3(-1.6, 1.1, -0.2), 52.0],
	"breaker": [Vector3(-4.0, 2.2, 3.4), Vector3(-2.1, 1.9, 0.05), 58.0],
	"room": [Vector3(-8.8, 1.76, 7.6), Vector3(-8.8, 1.25, 2.82), 60.0],
	"protection": [Vector3(-10.35, 1.56, 4.68), Vector3(-10.35, 1.34, 2.82), 51.0],
	"bay": [Vector3(-8.8, 1.56, 4.68), Vector3(-8.8, 1.34, 2.82), 51.0],
	"metering": [Vector3(-7.25, 1.56, 4.68), Vector3(-7.25, 1.34, 2.82), 51.0],
}
const WALK_START := Vector3(-7.61, 0.025, 11.7)
const WALK_INSIDE := Vector3(-8.8, 0.025, 6.8)

var panel_room := PanelRoom.new()
var walk_section := "yard"
var dragging := false
var outdoor_readings: Dictionary = {}
var outdoor_detail_labels: Array[Label3D] = []

var steel := material(Color("#50616a"), 0.35)
var galvanized := material(Color("#879397"), 0.45)
var porcelain := material(Color("#3c302d"))
var hardware := material(Color("#39484b"), 0.4)
var aluminum := material(Color("#aaa699"), 0.6)
var equipment := material(Color("#536958"))
var concrete := material(Color("#a5a39a"))
var road := material(Color("#767772"))
var caution := material(Color("#d9ae4d"))
var wire_source := material(Color("#a9a5a0"), 0.25)
var wire_feeder := material(Color("#7f898a"), 0.25)
var fault_lamp := material(Color("#42494a"))
var source_lamp := material(Color("#42494a"))
var contact_a_lamp := material(Color("#42494a"))
var contact_b_lamp := material(Color("#42494a"))

var indicator: Node3D
var linkage: Node3D
var state_label: Label3D
var camera: Camera3D
var walk_camera: Camera3D
var walker: CharacterBody3D
var yard_window
var last_snapshot := ""
var last_view_request := ""
var angle_target := 0.0
var current_view := "overview"


func _ready() -> void:
	build_environment()
	build_ground()
	build_source()
	build_breaker()
	build_feeder()
	panel_room.build(self)
	build_cameras()
	set_view("overview")
	if OS.has_feature("web"):
		yard_window = JavaScriptBridge.get_interface("window")
		yard_window.ss01YardSceneReady = true


func _process(delta: float) -> void:
	if yard_window != null:
		var snapshot := str(yard_window.ss01YardSnapshot)
		if snapshot != last_snapshot:
			last_snapshot = snapshot
			var data: Variant = JSON.parse_string(snapshot)
			if data is Dictionary:
				apply_telemetry(data)
		var request := str(yard_window.ss01YardView)
		if request != last_view_request:
			last_view_request = request
			set_view(request.get_slice(":", 0))
	linkage.rotation.z = lerpf(linkage.rotation.z, angle_target, minf(1.0, delta * 9.0))


func _physics_process(delta: float) -> void:
	if current_view != "walk":
		return
	var input := Vector2(
		float(Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT)) -
			float(Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT)),
		float(Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN)) -
			float(Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP))
	)
	if yard_window != null:
		input += Vector2(float(yard_window.ss01WalkX), float(yard_window.ss01WalkY))
		look(float(yard_window.ss01Turn) * delta * 440.0, 0)
	if Input.is_physical_key_pressed(KEY_Q):
		look(-delta * 440.0, 0)
	if Input.is_physical_key_pressed(KEY_E):
		look(delta * 440.0, 0)
	var desired := walker.basis * Vector3(input.x, 0.0, input.y).limit_length() * 2.65
	walker.velocity.x = move_toward(walker.velocity.x, desired.x, 16.0 * delta)
	walker.velocity.z = move_toward(walker.velocity.z, desired.z, 16.0 * delta)
	walker.velocity.y = -3.0
	walker.move_and_slide()
	if walker.position.y < -1.5:
		spawn_walker(walk_section)


func _unhandled_input(event: InputEvent) -> void:
	if current_view != "walk":
		return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		dragging = event.pressed
	elif event is InputEventMouseMotion and dragging and (event.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
		look(event.relative.x, event.relative.y)
	elif event is InputEventScreenDrag:
		look(event.relative.x, event.relative.y)
	elif event is InputEventKey and event.pressed and event.keycode == KEY_HOME:
		spawn_walker(walk_section)


func look(x: float, y: float) -> void:
	walker.rotate_y(-x * 0.003)
	walk_camera.rotation.x = clampf(walk_camera.rotation.x - y * 0.003, -1.20, 1.20)


func spawn_walker(section: String) -> void:
	walk_section = section
	walker.position = WALK_INSIDE if section == "room" else WALK_START
	walker.rotation = Vector3.ZERO
	walker.velocity = Vector3.ZERO
	walk_camera.rotation.x = -0.02


func set_view(view: String) -> void:
	for label in outdoor_detail_labels:
		label.visible = view not in ["overview", "breaker"]
	dragging = false
	if view in ["walk", "walk-room"]:
		current_view = "walk"
		spawn_walker("room" if view == "walk-room" else "yard")
		walk_camera.make_current()
		return
	current_view = view if VIEWS.has(view) else "overview"
	var settings: Array = VIEWS[current_view]
	camera.position = settings[0]
	camera.look_at(settings[1])
	camera.fov = settings[2]
	camera.make_current()


func apply_telemetry(data: Dictionary) -> void:
	var position: String = data.get("position", "UNKNOWN")
	var known := position in ["OPEN", "CLOSED", "IN TRANSIT"]
	match position:
		"OPEN": angle_target = -1.17
		"CLOSED": angle_target = 0.0
		"IN TRANSIT": angle_target = -0.56
	linkage.visible = known
	state_label.text = position
	state_label.modulate = Color("#f0e1b0") if not known else Color("#e5eddd")
	set_lamp(source_lamp, data.get("energized"), Color("#8ac794"))
	set_lamp(fault_lamp, data.get("fault"), Color("#ff624d"))
	set_lamp(contact_a_lamp, data.get("contactA"), Color("#e57d66"))
	set_lamp(contact_b_lamp, data.get("contactB"), Color("#80bf9b"))
	panel_room.update(data)
	outdoor_readings.voltage.text = panel_room.readings.voltage.text
	outdoor_readings.current.text = panel_room.readings.current.text


func set_lamp(surface: StandardMaterial3D, state: Variant, active: Color) -> void:
	surface.albedo_color = active if state == true else Color("#343d3e")
	surface.emission_enabled = state == true
	surface.emission = active
	surface.emission_energy_multiplier = 0.35


func build_environment() -> void:
	var sky := ProceduralSkyMaterial.new()
	sky.sky_top_color = Color("#4e7193")
	sky.sky_horizon_color = Color("#ced8dd")
	sky.ground_horizon_color = Color("#ced8dd")
	sky.ground_bottom_color = Color("#656d60")
	var world_sky := Sky.new()
	world_sky.sky_material = sky
	var environment := Environment.new()
	environment.background_mode = Environment.BG_SKY
	environment.sky = world_sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("#cedce6")
	environment.ambient_light_energy = 0.55
	var world := WorldEnvironment.new()
	world.environment = environment
	add_child(world)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-53.0, -33.0, 0.0)
	sun.light_color = Color("#fff0d5")
	sun.light_energy = 0.93
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 55.0
	add_child(sun)


func build_ground() -> void:
	box(Vector3(0, -0.21, 0), Vector3(440, 0.24, 440), material(Color("#67715e")))
	box(Vector3(0, -0.11, 0), Vector3(29, 0.20, 35), material(Color("#777970")))
	box(Vector3(4.8, 0.01, 1), Vector3(2.9, 0.03, 31), road)
	box(Vector3(-2.5, 0.015, 10.8), Vector3(17.1, 0.03, 2.6), road)
	box(Vector3(-7.61, 0.012, 9.54), Vector3(1.95, 0.024, 1.65), concrete)
	box(Vector3(-3.99, 0.015, 4.51), Vector3(0.55, 0.035, 12.4), concrete)
	for z in range(-8, 11):
		box(Vector3(-3.99, 0.033, z), Vector3(0.54, 0.009, 0.015), hardware)
	collision_box(Vector3(0, -0.16, 0), Vector3(29, 0.32, 35))
	build_gravel()
	for x in [-13.3, 13.3]:
		fence(Vector3(x, 0, -16), Vector3(x, 0, 16))
	fence(Vector3(-13.3, 0, -16), Vector3(13.3, 0, -16))
	fence(Vector3(-13.3, 0, 16), Vector3(3.2, 0, 16))
	fence(Vector3(6.5, 0, 16), Vector3(13.3, 0, 16))
	collision_box(Vector3(4.85, 1, 16.4), Vector3(3.3, 2.5, 0.2))
	for z in range(-13, 14, 3):
		box(Vector3(6.17, 0.045, z), Vector3(0.08, 0.018, 1.5), caution)
	label_at("SS-01  /  11 kV", Vector3(6.9, 1.9, 14.2), 0.011)


func build_gravel() -> void:
	var gravel := MultiMesh.new()
	gravel.transform_format = MultiMesh.TRANSFORM_3D
	gravel.use_colors = true
	var stone := BoxMesh.new()
	stone.size = Vector3(0.12, 0.018, 0.09)
	gravel.mesh = stone
	gravel.instance_count = 5200
	var random := RandomNumberGenerator.new()
	random.seed = 61850
	var count := 0
	for n in range(gravel.instance_count):
		var x := random.randf_range(-13.2, 13.2)
		var z := random.randf_range(-15.8, 15.8)
		if absf(x - 4.8) < 1.50 or absf(z - 10.8) < 1.34 or (x < -5.0 and z > 1.5 and z < 10.0):
			continue
		var basis := Basis(Vector3.UP, random.randf_range(0.0, TAU)).scaled(Vector3.ONE * random.randf_range(0.6, 1.4))
		gravel.set_instance_transform(count, Transform3D(basis, Vector3(x, 0, z)))
		var tone := random.randf_range(0.61, 0.90)
		gravel.set_instance_color(count, Color(tone, tone * 0.99, tone * 0.92))
		count += 1
	gravel.visible_instance_count = count
	var surface := MultiMeshInstance3D.new()
	surface.multimesh = gravel
	var pebbles := material(Color("#9a9b8d"))
	pebbles.vertex_color_use_as_albedo = true
	surface.material_override = pebbles
	surface.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(surface)


func fence(start: Vector3, end: Vector3) -> void:
	var length := start.distance_to(end)
	var intervals := int(ceil(length / 2.4))
	for i in range(intervals + 1):
		var p := start.lerp(end, float(i) / float(intervals))
		box(p + Vector3(0, 1.05, 0), Vector3(0.085, 2.1, 0.085), galvanized)
	for y in [0.25, 0.55, 0.85, 1.15, 1.45, 1.75, 2.0]:
		beam(start + Vector3(0, y, 0), end + Vector3(0, y, 0), 0.018, galvanized)
	var dimensions := Vector3(absf(end.x - start.x) + 0.16, 2.1, absf(end.z - start.z) + 0.16)
	collision_box((start + end) / 2.0 + Vector3(0, 1.05, 0), dimensions)


func build_source() -> void:
	gantry(-8.7)
	box(Vector3(-7.3, 0.13, -10.2), Vector3(4.7, 0.3, 4.7), concrete)
	box(Vector3(-7.3, 1.1, -10.2), Vector3(3.3, 1.8, 2.8), equipment)
	box(Vector3(-7.3, 2.05, -10.2), Vector3(3.55, 0.16, 3.0), hardware)
	box(Vector3(-7.3, 0.24, -10.2), Vector3(3.8, 0.35, 3.35), hardware)
	for i in range(8):
		box(Vector3(-8.82 + i * 0.43, 1.14, -8.72), Vector3(0.13, 1.42, 0.26), steel)
	for phase in [-1, 0, 1]:
		var x := float(phase) * 2.0
		var bushing_x := -7.3 + float(phase) * 0.88
		insulator(Vector3(bushing_x, 2.13, -9.85), 0.91, 0.17)
		beam(Vector3(bushing_x, 3.04, -9.85), Vector3(x, 4.16, -8.7), 0.048, wire_source)
		insulator(Vector3(x, 4.16, -8.7), 0.83, 0.105)
		beam(Vector3(x, 4.16, -8.7), Vector3(x, 2.35, -3.6), 0.052, wire_source)
	collision_box(Vector3(-7.3, 1.0, -10.2), Vector3(3.6, 2.0, 3.1))
	outdoor_detail_labels.append(label_at("11 kV SOURCE  /  BUS", Vector3(-6.8, 2.65, -8.6), 0.011))
	outdoor_readings.voltage = label_at("—", Vector3(-6.8, 2.21, -8.6), 0.009)
	outdoor_detail_labels.append(outdoor_readings.voltage)
	box(Vector3(-8.93, 1.19, -10.4), Vector3(0.32, 1.47, 1.42), equipment)
	tube(Vector3(-7.45, 2.28, -10.92), 0.34, 0.49, equipment)
	box(Vector3(-4.8, 1.4, -8.6), Vector3(0.22, 0.37, 0.20), hardware)
	box(Vector3(-4.8, 1.45, -8.48), Vector3(0.12, 0.12, 0.035), source_lamp)


func build_breaker() -> void:
	box(Vector3(0, 0.14, -1.7), Vector3(6.4, 0.30, 5.2), concrete)
	box(Vector3(0, 0.63, -1.7), Vector3(5.55, 0.73, 0.37), steel)
	for phase in [-1, 0, 1]:
		var x := float(phase) * 2.0
		box(Vector3(x, 0.72, -1.7), Vector3(0.55, 1.0, 0.8), steel)
		box(Vector3(x, 1.04, -1.7), Vector3(0.80, 0.43, 2.65), equipment)
		box(Vector3(x, 0.97, -0.37), Vector3(0.41, 0.18, 0.056), hardware)
		label_at(["L1", "L2", "L3"][phase + 1], Vector3(x, 0.98, -0.331), 0.003)
		for end in [-1, 1]:
			var z := -1.7 + float(end) * 1.07
			insulator(Vector3(x, 1.26, z), 1.09, 0.20)
			box(Vector3(x, 2.35, z), Vector3(0.30, 0.11, 0.25), aluminum)
		beam(Vector3(x, 2.35, -3.6), Vector3(x, 2.35, -2.77), 0.048, wire_source)
		beam(Vector3(x, 2.35, -0.63), Vector3(x, 2.02, 3.4), 0.048, wire_feeder)
		collision_box(Vector3(x, 0.8, -1.7), Vector3(0.84, 1.7, 2.7))
	box(Vector3(-2.7, 1.05, 0.29), Vector3(0.86, 1.49, 0.57), equipment)
	box(Vector3(-2.7, 0.87, 0.59), Vector3(0.77, 0.70, 0.035), steel)
	box(Vector3(-2.39, 0.89, 0.63), Vector3(0.046, 0.17, 0.055), hardware)
	box(Vector3(-2.7, 1.35, 0.59), Vector3(0.69, 0.45, 0.04), hardware)
	box(Vector3(-2.86, 1.40, 0.62), Vector3(0.12, 0.105, 0.03), contact_a_lamp)
	box(Vector3(-2.55, 1.40, 0.62), Vector3(0.12, 0.105, 0.03), contact_b_lamp)
	outdoor_detail_labels.append(label_at("52a       52b", Vector3(-2.7, 1.26, 0.65), 0.004))
	indicator = Node3D.new()
	add_child(indicator)
	indicator.position = Vector3(-2.70, 1.76, 0.72)
	linkage = Node3D.new()
	indicator.add_child(linkage)
	var arm := MeshInstance3D.new()
	var shape := BoxMesh.new()
	shape.size = Vector3(0.32, 0.045, 0.045)
	arm.mesh = shape
	arm.material_override = caution
	arm.position.x = 0.15
	linkage.add_child(arm)
	linkage.visible = false
	outdoor_detail_labels.append(label_at("52-F01  /  CIRCUIT BREAKER", Vector3(-2.65, 2.72, 0.47), 0.010))
	state_label = label_at("UNKNOWN", Vector3(-2.65, 2.32, 0.56), 0.009)
	outdoor_detail_labels.append(state_label)
	collision_box(Vector3(-2.7, 1.04, 0.29), Vector3(0.9, 1.85, 0.6))


func build_feeder() -> void:
	box(Vector3(0, 0.10, 3.7), Vector3(6.1, 0.24, 2.15), concrete)
	for phase in [-1, 0, 1]:
		var x := float(phase) * 2.0
		box(Vector3(x, 0.57, 3.7), Vector3(0.34, 0.77, 0.41), steel)
		insulator(Vector3(x, 0.97, 3.7), 0.86, 0.16)
		tube(Vector3(x, 1.91, 3.7), 0.27, 0.32, equipment)
		box(Vector3(x, 2.02, 3.7), Vector3(0.34, 0.09, 0.56), aluminum)
		beam(Vector3(x, 2.02, 3.4), Vector3(x, 2.02, 4.0), 0.06, wire_feeder)
		conductor(Vector3(x, 2.02, 4.0), Vector3(x, 4.16, 11.3), 0.23, wire_feeder)
		conductor(Vector3(x, 4.16, 11.3), Vector3(x, 4.45, 16.0), 0.21, wire_feeder)
		insulator(Vector3(x, 4.16, 11.3), 0.83, 0.105)
	gantry(11.3)
	label_at("F01 OUTGOING", Vector3(0.0, 5.41, 11.0), 0.011)
	outdoor_detail_labels.append(label_at("F01 CTs", Vector3(0, 2.83, 3.7), 0.009))
	outdoor_readings.current = label_at("—", Vector3(0, 2.48, 3.7), 0.008)
	outdoor_detail_labels.append(outdoor_readings.current)
	box(Vector3(3.5, 0.92, 7.2), Vector3(0.32, 1.81, 0.37), steel)
	box(Vector3(3.5, 1.73, 7.43), Vector3(0.17, 0.17, 0.05), fault_lamp)
	outdoor_detail_labels.append(label_at("FEEDER FAULT", Vector3(3.5, 2.1, 7.43), 0.010))


func conductor(start: Vector3, end: Vector3, sag: float, surface: StandardMaterial3D) -> void:
	var previous := start
	for section in range(1, 9):
		var fraction := float(section) / 8.0
		var point := start.lerp(end, fraction) - Vector3.UP * (4.0 * sag * fraction * (1.0 - fraction))
		beam(previous, point, 0.048, surface)
		previous = point


func gantry(z: float) -> void:
	for x in [-4.3, 4.3]:
		box(Vector3(x, 0.13, z), Vector3(0.84, 0.28, 0.86), concrete)
		box(Vector3(x, 2.64, z), Vector3(0.26, 4.88, 0.26), steel)
		collision_box(Vector3(x, 2.5, z), Vector3(0.36, 5.0, 0.36))
		var inner := float(x) - signf(x) * 1.19
		beam(Vector3(x, 4.04, z), Vector3(inner, 5.03, z), 0.11, galvanized)
	box(Vector3(0, 5.03, z), Vector3(8.9, 0.22, 0.26), steel)


func insulator(base: Vector3, height: float, radius: float) -> void:
	tube(base + Vector3(0, height * 0.5, 0), height, radius * 0.57, porcelain)
	for i in range(7):
		tube(base + Vector3(0, height * (i + 1) / 8.0, 0), height * 0.066, radius, porcelain)
	tube(base + Vector3(0, height * 0.95, 0), height * 0.085, radius * 0.67, aluminum)


func build_cameras() -> void:
	camera = Camera3D.new()
	camera.near = 0.12
	add_child(camera)
	walker = CharacterBody3D.new()
	add_child(walker)
	var body_shape := CapsuleShape3D.new()
	body_shape.radius = 0.30
	body_shape.height = 1.70
	var shape := CollisionShape3D.new()
	shape.shape = body_shape
	shape.position.y = 0.87
	walker.add_child(shape)
	walk_camera = Camera3D.new()
	walk_camera.position.y = 1.66
	walk_camera.near = 0.08
	walk_camera.fov = 67.0
	walker.add_child(walk_camera)


func material(color: Color, metallic: float = 0.0) -> StandardMaterial3D:
	var surface := StandardMaterial3D.new()
	surface.albedo_color = color
	surface.metallic = metallic
	surface.roughness = 0.8
	return surface


func box(at: Vector3, dimensions: Vector3, surface: StandardMaterial3D) -> MeshInstance3D:
	var shape := BoxMesh.new()
	shape.size = dimensions
	return mesh_at(at, shape, surface)


func tube(at: Vector3, height: float, radius: float, surface: StandardMaterial3D) -> void:
	var shape := CylinderMesh.new()
	shape.height = height
	shape.top_radius = radius
	shape.bottom_radius = radius
	shape.radial_segments = 12
	shape.rings = 1
	mesh_at(at, shape, surface)


func beam(start: Vector3, end: Vector3, width: float, surface: StandardMaterial3D) -> void:
	var direction := end - start
	var piece := box((start + end) / 2.0, Vector3(width, width, direction.length()), surface)
	piece.look_at(end, Vector3.RIGHT if absf(direction.normalized().dot(Vector3.UP)) > 0.98 else Vector3.UP)


func mesh_at(at: Vector3, shape: Mesh, surface: StandardMaterial3D) -> MeshInstance3D:
	var piece := MeshInstance3D.new()
	piece.mesh = shape
	piece.material_override = surface
	piece.position = at
	add_child(piece)
	return piece


func collision_box(at: Vector3, size: Vector3) -> void:
	var wall := StaticBody3D.new()
	wall.position = at
	var box_shape := BoxShape3D.new()
	box_shape.size = size
	var collider := CollisionShape3D.new()
	collider.shape = box_shape
	wall.add_child(collider)
	add_child(wall)


func label_at(text: String, at: Vector3, pixels: float) -> Label3D:
	var label := Label3D.new()
	label.text = text
	label.position = at
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.pixel_size = pixels
	label.font_size = 48
	label.outline_size = 10
	label.outline_modulate = Color("#263338")
	label.modulate = Color("#e9e6d9")
	add_child(label)
	return label
