export function drawSingleLine(drawing, { position, busVoltageKv, feederCurrentA }) {
  const closed = position === 'CLOSED';
  const unknown = position !== 'CLOSED' && position !== 'OPEN';
  const live = '#294653';
  const unavailable = '#80520d';
  drawing.clearRect(0, 0, 630, 310);
  drawing.strokeStyle = '#c2cbcf';
  drawing.lineWidth = 1;
  for (let x = 18; x < 630; x += 18) {
    for (let y = 18; y < 310; y += 18) drawing.strokeRect(x, y, 0.5, 0.5);
  }
  drawing.fillStyle = live;
  drawing.font = '16px Consolas, monospace';
  drawing.fillText(busVoltageKv ? busVoltageKv + ' kV BUS' : '11 kV BUS (NOMINAL)', 83, 59);
  drawing.fillStyle = unknown ? unavailable : live;
  drawing.fillText('52-F01  ' + (position ?? 'UNKNOWN'), 320, 148);
  drawing.fillStyle = live;
  drawing.fillText('CT   ' + (feederCurrentA == null ? '—' : feederCurrentA + ' A'), 320, 207);
  drawing.fillText('FEEDER F01', 320, 275);
  drawing.strokeStyle = live;
  drawing.lineWidth = 3;
  drawing.beginPath();
  drawing.moveTo(83, 77);
  drawing.lineTo(543, 77);
  drawing.moveTo(270, 77);
  drawing.lineTo(270, 126);
  drawing.stroke();
  if (closed) drawing.fillRect(259, 126, 22, 30);
  if (unknown) {
    drawing.strokeStyle = unavailable;
    drawing.fillStyle = unavailable;
    drawing.fillText(position === 'INTERMEDIATE' ? '–' : '?', 265, 146);
  }
  drawing.strokeRect(259, 126, 22, 30);
  drawing.strokeStyle = closed ? live : unknown ? unavailable : '#75838a';
  if (unknown) drawing.setLineDash([5, 5]);
  drawing.beginPath();
  drawing.moveTo(270, 156);
  drawing.lineTo(270, 274);
  drawing.lineTo(262, 262);
  drawing.moveTo(270, 274);
  drawing.lineTo(278, 262);
  drawing.stroke();
  if (unknown) drawing.setLineDash([]);
  drawing.beginPath();
  drawing.arc(270, 202, 12, 0, 2 * Math.PI);
  drawing.stroke();
}
