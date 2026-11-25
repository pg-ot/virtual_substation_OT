extends RefCounted
## LV secondary equipment for the outdoor F01 bay.
const FRONT := 2.05
const PROTECTION_X := -10.35
const BAY_X := -8.8
const INTERFACE_X := -7.25

var layout: Node3D
var readings: Dictionary = {}
var lamps: Dictionary = {}


func build(yard: Node3D) -> void:
	layout = yard
	var floor = yard.material(Color("#737d7c"))
	var walls = yard.material(Color("#c1c3ba"))
	var trim = yard.material(Color("#40565c"))
	var roof = yard.material(Color("#526164"))
	yard.box(Vector3(-8.8, 0.02, 5.15), Vector3(7.4, 0.04, 7.0), floor)
	wall(Vector3(-8.8, 1.55, 1.75), Vector3(7.4, 3.1, 0.22), walls)
	wall(Vector3(-12.4, 1.55, 5.15), Vector3(0.22, 3.1, 7.0), walls)
	wall(Vector3(-5.2, 1.55, 5.15), Vector3(0.22, 3.1, 7.0), walls)
	wall(Vector3(-10.54, 1.55, 8.55), Vector3(3.92, 3.1, 0.22), walls)
	wall(Vector3(-5.86, 1.55, 8.55), Vector3(1.54, 3.1, 0.22), walls)
	wall(Vector3(-7.61, 2.71, 8.55), Vector3(1.96, 0.78, 0.22), walls)
	yard.box(Vector3(-8.8, 3.19, 5.15), Vector3(7.75, 0.18, 7.3), roof)
	yard.box(Vector3(-7.61, 0.03, 8.63), Vector3(1.95, 0.04, 0.36), trim)
	for x in [-8.6, -6.62]:
		yard.box(Vector3(x, 1.15, 8.72), Vector3(0.10, 2.3, 0.12), trim)
	yard.box(Vector3(-7.61, 2.26, 8.72), Vector3(2.08, 0.10, 0.12), trim)
	yard.box(Vector3(-7.61, 2.65, 8.68), Vector3(2.76, 0.33, 0.07), trim)
	face("F01  CONTROL ROOM", Vector3(-7.61, 2.65, 8.727), 0.0031)
	yard.box(Vector3(-10.57, 0.21, 8.673), Vector3(3.75, 0.42, 0.075), trim)
	yard.box(Vector3(-5.89, 0.21, 8.673), Vector3(1.36, 0.42, 0.075), trim)
	wall(Vector3(-8.61, 1.105, 9.45), Vector3(0.075, 2.10, 1.46), trim)
	yard.box(Vector3(-8.555, 1.08, 9.99), Vector3(0.07, 0.12, 0.15), roof)
	var joint = yard.material(Color("#5f696a"))
	for z in [3.37, 5.13, 6.89]:
		yard.box(Vector3(-8.8, 0.041, z), Vector3(6.9, 0.002, 0.014), joint)
	for x in [-11.4, -6.12]:
		yard.box(Vector3(x, 0.047, 4.45), Vector3(0.055, 0.01, 2.7), yard.caution)

	var fixture = yard.material(Color("#eaf0e6"))
	fixture.emission_enabled = true
	fixture.emission = Color("#eaf0e6")
	for z in [3.0, 6.5]:
		yard.box(Vector3(-8.8, 3.04, z), Vector3(2.25, 0.065, 0.24), fixture)
		var light := OmniLight3D.new()
		light.position = Vector3(-8.8, 2.86, z)
		light.omni_range = 5.8
		light.light_energy = 0.95
		yard.add_child(light)
	var tray = yard.material(Color("#686f73"), 0.3)
	yard.box(Vector3(-8.8, 2.63, 2.35), Vector3(5.4, 0.11, 0.33), tray)
	for x in [PROTECTION_X, BAY_X, INTERFACE_X]:
		yard.box(Vector3(x, 2.43, 2.39), Vector3(0.15, 0.39, 0.12), tray)

	cabinet(PROTECTION_X, "PRF01  |  PROTECTION", "LIVE RELAY FEEDBACK")
	meter(PROTECTION_X, "RELAY INPUT CURRENT", "protectionCurrent", 1.46)
	meter(PROTECTION_X, "RELAY TRIP", "protectionTrip", 1.11)
	cabinet(BAY_X, "BRF01  |  BAY CONTROL", "52-F01  /  BRF01 FEEDBACK")
	meter(BAY_X, "BREAKER POSITION", "position", 1.46)
	meter(BAY_X, "SIMF01 AUXILIARY CONTACTS", "contacts", 1.11)
	readings.contacts.pixel_size = 0.00198
	cabinet(INTERFACE_X, "SIMF01  |  PROCESS I/O", "SOURCE AND FEEDER METERING")
	meter(INTERFACE_X, "SOURCE BUS VOLTAGE", "voltage", 1.46)
	meter(INTERFACE_X, "FEEDER CURRENT", "current", 1.11)
	face("PROCESS DATA QUALITY", Vector3(INTERFACE_X, 0.82, FRONT + 0.85), 0.00135)
	readings.quality = face("UNAVAILABLE", Vector3(INTERFACE_X, 0.69, FRONT + 0.85), 0.00185)
	for item in [["closed", -0.27, "52a"], ["open", 0.27, "52b"]]:
		var lamp = yard.material(Color("#343d3e"))
		lamps[item[0]] = lamp
		yard.box(Vector3(BAY_X + item[1], 0.78, FRONT + 0.85), Vector3(0.092, 0.04, 0.025), lamp)
		face(item[2], Vector3(BAY_X + item[1], 0.69, FRONT + 0.88), 0.00137)
	readings.operationFailure = face("FAILURE · UNAVAILABLE", Vector3(BAY_X, 0.60, FRONT + 0.85), 0.00132)


func wall(at: Vector3, size: Vector3, surface: StandardMaterial3D) -> void:
	layout.box(at, size, surface)
	layout.collision_box(at, size)


func cabinet(x: float, title: String, subtitle: String) -> void:
	var paint = layout.material(Color("#9ba9a9"), 0.15)
	var fascia = layout.material(Color("#263c43"), 0.18)
	var seam = layout.material(Color("#475b62"))
	wall(Vector3(x, 1.13, FRONT + 0.39), Vector3(1.37, 2.18, 0.78), paint)
	layout.box(Vector3(x, 0.065, FRONT + 0.41), Vector3(1.42, 0.13, 0.82), seam)
	layout.box(Vector3(x, 1.97, FRONT + 0.8), Vector3(1.24, 0.17, 0.08), fascia)
	layout.box(Vector3(x, 1.25, FRONT + 0.8), Vector3(1.12, 1.08, 0.08), fascia)
	for height in [0.42, 1.26, 1.77]:
		layout.box(Vector3(x - 0.66, height, FRONT + 0.792), Vector3(0.055, 0.10, 0.045), seam)
	layout.box(Vector3(x + 0.61, 0.62, FRONT + 0.82), Vector3(0.05, 0.21, 0.06), seam)
	layout.box(Vector3(x, 0.52, FRONT + 0.786), Vector3(1.31, 0.015, 0.022), seam)
	for index in range(4):
		layout.box(Vector3(x, 0.23 + index * 0.055, FRONT + 0.787), Vector3(0.58, 0.013, 0.025), seam)
	face(title, Vector3(x, 1.97, FRONT + 0.851), 0.0021)
	face(subtitle, Vector3(x, 1.69, FRONT + 0.85), 0.00137)


func meter(x: float, name: String, key: String, y: float) -> void:
	var screen = layout.material(Color("#112423"))
	layout.box(Vector3(x, y - 0.06, FRONT + 0.85), Vector3(0.96, 0.26, 0.045), screen)
	face(name, Vector3(x, y, FRONT + 0.883), 0.00151)
	readings[key] = face("—", Vector3(x, y - 0.125, FRONT + 0.883), 0.00285)
	readings[key].modulate = Color("#b7e2cd")


func face(text: String, at: Vector3, pixels: float) -> Label3D:
	var label: Label3D = layout.label_at(text, at, pixels)
	label.billboard = BaseMaterial3D.BILLBOARD_DISABLED
	label.outline_size = 0
	return label


func update(data: Dictionary) -> void:
	var current: Variant = data.get("current")
	var voltage: Variant = data.get("voltage")
	var relay_current: Variant = data.get("relayCurrent")
	var contact_a: Variant = data.get("contactA")
	var contact_b: Variant = data.get("contactB")
	readings.current.text = "—" if current == null else "%.1f A" % float(current)
	readings.protectionCurrent.text = data.get("relayCurrentQuality", "UNAVAILABLE") if relay_current == null else "%.1f A" % float(relay_current)
	readings.protectionCurrent.pixel_size = 0.00185 if relay_current == null else 0.00285
	readings.protectionCurrent.modulate = Color("#ffca8f") if relay_current == null else Color("#b7e2cd")
	readings.voltage.text = "—" if voltage == null else "%.2f kV" % float(voltage)
	set_indication(readings.protectionTrip, data.get("relayTrip"), data.get("relayTripQuality", "UNAVAILABLE"))
	readings.protectionTrip.pixel_size = 0.00185 if data.get("relayTrip") == null else 0.00285
	set_indication(readings.operationFailure, data.get("operationFailure"), data.get("operationFailureQuality", "UNAVAILABLE"), "FAILURE · ")
	var breaker_position: Variant = data.get("breakerPosition")
	readings.position.text = data.get("breakerPositionQuality", "UNAVAILABLE") if breaker_position == null else breaker_position
	readings.position.pixel_size = 0.00285 if breaker_position in ["OPEN", "CLOSED"] else 0.00185
	readings.position.modulate = Color("#b7e2cd") if breaker_position in ["OPEN", "CLOSED"] else Color("#ffca8f")
	readings.contacts.text = "52a %s    /    52b %s" % [contact_text(contact_a), contact_text(contact_b)]
	readings.quality.text = data.get("quality", "UNAVAILABLE")
	layout.set_lamp(lamps.closed, contact_a, Color("#e57d66"))
	layout.set_lamp(lamps.open, contact_b, Color("#80bf9b"))


func set_indication(label: Label3D, value: Variant, quality: String, prefix: String = "") -> void:
	label.text = prefix + (quality if value == null else ("ASSERTED" if value else "CLEAR"))
	label.modulate = Color("#ffca8f") if value == null else (Color("#ff8c79") if value else Color("#b7e2cd"))


func contact_text(state: Variant) -> String:
	if state == null:
		return "—"
	return "ON" if state else "OFF"
