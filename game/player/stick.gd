class_name Stick
## Analog stick shaping: radial dead zone, then a response curve on the
## remaining range so small deflections give fine control.


static func shape(raw: Vector2, deadzone: float, exponent: float) -> Vector2:
	var length := raw.length()
	if length <= deadzone:
		return Vector2.ZERO
	var t := clampf((length - deadzone) / (1.0 - deadzone), 0.0, 1.0)
	return raw / length * pow(t, exponent)
