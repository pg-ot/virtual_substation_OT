export function drawStationMimic(ctx, { position, feederCurrentA, relayCurrentA, directInput }) {
  const center = 391;
  const y = 220;
  const positionColor = { CLOSED: '#f19a82', OPEN: '#8ed3a8' }[position] ?? '#e1bc75';
  const text = (value, x, top, color = '#c1cdd3', size = 17) => {
    ctx.font = size + 'px Consolas, monospace';
    ctx.fillStyle = color;
    ctx.fillText(value, x, top);
  };
  const line = (x1, y1, x2, y2, color, width = 3) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  const bus = '#86a9b9';
  ctx.clearRect(0, 0, 960, 520);
  text('SOURCE', 110, 56, '#a1b4bf', 15);
  text('11 kV BUS  /  NOMINAL', 142, 113, '#d9e3e8', 20);
  line(110, 65, 110, 139, bus);
  line(110, 139, 827, 139, bus, 5);
  line(center, 139, center, y - 23, bus);
  ctx.fillStyle = bus;
  ctx.fillRect(center - 4, 135, 8, 8);
  ctx.strokeStyle = positionColor;
  ctx.lineWidth = 3;
  if (position === 'CLOSED') {
    ctx.fillStyle = '#653f38';
    ctx.fillRect(center - 19, y - 22, 38, 44);
    line(center, y - 15, center, y + 15, positionColor);
  }
  ctx.strokeRect(center - 19, y - 22, 38, 44);
  if (position !== 'CLOSED' && position !== 'OPEN') text(position === 'INTERMEDIATE' ? '–' : '?', center - 6, y + 7, positionColor, 22);
  text('52-F01', 434, 216, '#ebf1f3', 21);
  text(position ?? 'UNKNOWN', 434, 242, positionColor, 17);
  line(center, y + 22, center, 416, position === 'CLOSED' ? '#86a9b9' : '#687b85');
  ctx.strokeStyle = '#86a9b9';
  ctx.beginPath();
  ctx.arc(center, 316, 16, 0, Math.PI * 2);
  ctx.stroke();
  text('CT-F01   FEEDER PHASE A', 434, 311, '#96aab5', 15);
  text(feederCurrentA == null ? '— A' : feederCurrentA.toFixed(1) + ' A', 434, 339, '#d6edf1', 23);
  if (directInput) {
    text('PRF01 TEST INPUT · HTTP', 575, 195, '#96aab5', 15);
    text(relayCurrentA == null ? '— A' : relayCurrentA.toFixed(1) + ' A', 575, 224, '#d6edf1', 23);
  }
  line(center - 10, 405, center, 416, bus);
  line(center + 10, 405, center, 416, bus);
  text('F01  OUTGOING FEEDER', 434, 419, '#d9e3e8', 19);
}
