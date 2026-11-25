const views = {
  overview: { eye: [11, 9, 13], target: [0, 0, 0], zoom: 570 },
  breaker: { eye: [3.5, 1.65, 4.7], target: [-0.8, 1, 0], zoom: 560 },
  relay: { eye: [3.5, 1.65, 4], target: [2.55, 1.1, 1.5], zoom: 520 },
};

const subtract = (a, b) => a.map((value, i) => value - b[i]);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = ([x, y, z], [a, b, c]) => [y*c-z*b, z*a-x*c, x*b-y*a];
const unit = a => a.map(value => value / Math.hypot(...a));

export function drawYard(canvas, station, view) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const { eye, target, zoom } = views[view];
  const forward = unit(subtract(target, eye));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const faces = [];

  function project(point) {
    const relative = subtract(point, eye);
    const depth = dot(relative, forward);
    return [width/2 + zoom*dot(relative, right)/depth,
      height/2 - zoom*dot(relative, up)/depth];
  }

  function box(x, y, z, w, h, d, colors) {
    const a = [x,y,z], b = [x+w,y,z], c = [x+w,y,z+d], e = [x,y,z+d];
    const top = ([px, , pz]) => [px,y+h,pz];
    const panels = [
      [e,c,top(c),top(e)], [b,c,top(c),top(b)], [a,b,top(b),top(a)],
      [a,e,top(e),top(a)], [top(a),top(b),top(c),top(e)],
    ];
    panels.forEach((points, index) => {
      if (points.some(point => dot(subtract(point, eye), forward) < .1)) return;
      const depth = points.reduce((sum, p) => sum + dot(subtract(p, eye), forward), 0) / 4;
      faces.push({ points, depth, color: colors[index % colors.length] });
    });
  }

  const steel = ['#63757d', '#4c5f68', '#85969c'];
  const ceramic = ['#836e58', '#6a5544', '#a58c70'];
  const cabinet = ['#829098', '#616f76', '#a6b0b3'];
  ctx.fillStyle = '#aebbc1';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#7e8984';
  ctx.fillRect(0, height * .58, width, height * .42);
  box(-4.2, -.14, -3.4, 8.4, .14, 6.4, ['#a2a7a0']);
  for (const x of [-3.2, 2.9]) {
    box(x, 0, -2.48, .17, 2.9, .17, steel);
  }
  box(-3.2, 2.72, -2.41, 6.3, .1, .12, steel);
  box(-.85, 2.7, -2.4, .07, .07, 4.35, steel);
  box(-1.5, 0, -.7, 1.28, .16, 1.4, ['#c4c7be']);
  box(-1.38, .16, -.35, 1.03, .85, .72, steel);
  for (const z of [-.36, .14]) box(-1.03, 1.01, z, .32, .94, .24, ceramic);
  box(-1.08, .53, .372, .52, .25, .04, ['#242e33']);
  box(2.02, 0, 1.15, 1.05, 1.78, .52, cabinet);
  box(2.18, .88, 1.67, .72, .62, .02, ['#273238']);

  for (const { points, color } of faces.sort((a, b) => b.depth - a.depth)) {
    ctx.beginPath();
    points.forEach((point, index) => {
      const [x, y] = project(point);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function label(point, text, color) {
    const [x, y] = project(point);
    ctx.font = 'bold 15px Consolas, monospace';
    ctx.fillStyle = '#233039';
    ctx.fillRect(x - 5, y - 16, ctx.measureText(text).width + 10, 22);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  if (view === 'overview') label([-3, 2.95, -2.4], '11 kV BUS', '#fff');
  if (view !== 'relay') label([-.9, .73, .45], '52-F01 ' + station.position, '#fff');
  if (view !== 'breaker') {
    label([2.25, 1.4, 1.7], station.tripLatched ? '● TRIP' : '● READY',
      station.tripLatched ? '#ff857d' : '#a6e1ac');
  }
}
