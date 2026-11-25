extends SceneTree


func _initialize() -> void:
	call_deferred("check_scene")


func check_scene() -> void:
	var yard = preload("res://yard.tscn").instantiate()
	root.add_child(yard)
	var overview_labels_hidden: bool = yard.outdoor_detail_labels.all(func(label): return not label.visible)
	yard.apply_telemetry({"position": "CLOSED", "energized": true, "fault": true, "contactA": true, "contactB": false,
		"voltage": 11.0, "current": 1200.0, "quality": "LIVE"})
	var meters: Dictionary = yard.panel_room.readings
	var stuck: bool = (
		yard.linkage.visible and yard.angle_target == 0.0 and yard.fault_lamp.emission_enabled
		and yard.contact_a_lamp.emission_enabled and not yard.contact_b_lamp.emission_enabled
		and meters.voltage.text == "11.00 kV" and meters.current.text == "1200.0 A"
		and meters.contacts.text == "52a ON    /    52b OFF"
		and yard.outdoor_readings.current.text == "1200.0 A"
	)
	assert(meters.protectionCurrent.text == "UNAVAILABLE")
	assert(meters.protectionTrip.text == "UNAVAILABLE")
	assert(meters.operationFailure.text == "FAILURE · UNAVAILABLE")
	assert(meters.position.text == "UNAVAILABLE")
	yard.apply_telemetry({"current": 1200.0, "relayCurrent": 250.0, "relayTrip": true,
		"breakerPosition": "CLOSED", "operationFailure": true})
	assert(meters.current.text == "1200.0 A")
	assert(meters.protectionCurrent.text == "250.0 A")
	assert(meters.protectionTrip.text == "ASSERTED")
	assert(meters.position.text == "CLOSED")
	assert(meters.operationFailure.text == "FAILURE · ASSERTED")
	yard.apply_telemetry({"position": "OPEN", "energized": true, "fault": true, "contactA": false, "contactB": true,
		"voltage": 11.0, "current": 0.0, "quality": "LIVE", "breakerPosition": "OPEN"})
	var opened: bool = (
		yard.linkage.visible and yard.angle_target < -1.0 and yard.source_lamp.emission_enabled
		and not yard.contact_a_lamp.emission_enabled and yard.contact_b_lamp.emission_enabled
		and meters.current.text == "0.0 A" and meters.voltage.text == "11.00 kV"
		and meters.position.text == "OPEN"
	)
	yard.apply_telemetry({"position": "INVALID CONTACTS", "contactA": true, "contactB": true, "breakerPositionQuality": "INVALID"})
	var invalid: bool = not yard.linkage.visible and meters.position.text == "INVALID"
	yard.apply_telemetry({})
	var unavailable: bool = meters.current.text == "—" and meters.voltage.text == "—" and meters.quality.text == "UNAVAILABLE"
	yard.set_view("walk")
	var walk: bool = yard.walk_camera.is_current() and yard.current_view == "walk"
	yard.set_view("breaker")
	var inspect: bool = yard.camera.is_current() and yard.current_view == "breaker" and not yard.state_label.visible
	for view in ["room", "protection", "bay", "metering"]:
		yard.set_view(view)
		inspect = inspect and yard.current_view == view and yard.camera.is_current()
	yard.set_view("walk-room")
	walk = walk and yard.walk_camera.is_current() and yard.walker.position.z < 8.5
	yard.set_view("walk")
	for step in range(115):
		await physics_frame
		yard.walker.velocity = Vector3(0, -1, -2.65)
		yard.walker.move_and_slide()
	var doorway: bool = yard.walker.position.z < 8.15 and yard.walker.position.y > -0.05
	if not (overview_labels_hidden and stuck and opened and invalid and unavailable and walk and inspect and doorway):
		push_error("Switchyard scene checks failed")
		quit(1)
		return
	print("Switchyard passed panel readings, unknown data, camera views, and walk-through doorway checks.")
	quit()
