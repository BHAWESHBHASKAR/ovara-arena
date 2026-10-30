/**
 * Checkpoint: five sealed crates wait on a lane before a gate with a drop bar.
 * The crate nearest the gate carries a key (all four lid dots lit) and is held
 * there, bar down. The pointer picks a crate: a clean one lifts over the queue,
 * the bar rises, and it passes through the gate; the key crate, picked, gets
 * the bar pressed down onto it. The crates queued behind a cleared one step
 * up, staggered outwards from it. The slider is how far short of the bar the key
 * crate is held, in world units.
 *
 * The pattern: one of many. Tweens for the choice, a hit test on the crates'
 * resting centres, and paint order re-sorted by depth as a crate travels.
 */
const {
  Cam, clamp, facing, fit, hull, lerp, open, poly, proj, rings, prism, ringAt, run, rrect,
  tdone, tset, tval, tween, disposer, mk, place, pointer, register, solid, put, reflect,
} = HL;

const N = 5, KEY = 4, CW = 18, CD = 22, CH = 16, PL = 3;
// the queue comes in from the near end; the gate stands mid-lane; cleared crates go on to the far end
const QX = [178, 152, 129, 104], YS = [8, 11, 7, 10, 9], GX = 50, PASS = 8, ARC = 30;
const STEP = 23, BAR_UP = 38, BAR_DOWN = 9, BAR_PRESS = 5, POST = 50;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let gap = value;
  const heldX = () => GX + 4 + CW / 2 + gap;

  const C = Cam(45, 0.5, 1.34);
  fit(C, [[-14, -10, 0], [192, 50, 0], [-14, 50, 0], [192, -10, 0], [GX, -10, POST + 6], [PASS, 9, PL + CH + ARC]], 200, 170);
  const P = proj(C), front = facing(C);

  const root = mk("g", {}, svg);
  // the lane: a long low plate with a seam where the gate stands
  const [lane, laneIn] = rings(-14, -4, 192, 44, 6, 1.6);
  reflect(svg, root, P, front, lane, 0, 12);
  put(solid(root), prism(P, front, lane, laneIn, 0, PL));
  mk("path", { d: open([P(GX + 9, -2, PL), P(GX + 9, 42, PL)]), class: "nf lo dash" }, root);

  // depth-sorted things: each has a group, a key (x + y) and a redraw
  const things = [];
  const box = (x0, y0, x1, y1, z0, z1, r, b) => { const [o, i] = rings(x0, y0, x1, y1, r, b); return prism(P, front, o, i, z0, z1); };

  // the gate: far post, near post, and the frame across the top, which is one solid with the bar's housing
  const farPost = solid(mk("g", {}, root)); put(farPost, box(GX - 4, -10, GX + 4, -2, PL, POST, 2.5, 1));
  const nearPost = solid(mk("g", {}, root)); put(nearPost, box(GX - 4, 42, GX + 4, 50, PL, POST, 2.5, 1));
  const head = solid(mk("g", {}, root)); put(head, box(GX - 5, -10, GX + 5, 50, POST, POST + 6, 2.5, 1.2));
  const barG = mk("g", {}, root), bar = solid(barG);
  const bz = tween(BAR_DOWN);
  bar.sil.classList.add("hi");
  things.push({ g: farPost.g, k: () => GX - 6 }, { g: barG, k: () => GX + 20 }, { g: nearPost.g, k: () => GX + 46 }, { g: head.g, k: () => GX + 47 });

  // crates: lid dots carry identity. Clean crates show one lit dot in a different place; the key crate shows all four.
  const crates = [];
  for (let i = 0; i < N; i++) {
    const g = mk("g", {}, root), s = solid(g);
    const lid = mk("path", { class: "nf lo" }, g);
    const dots = [0, 1, 2, 3].map((k) => mk("circle", { r: 1.25, class: "dot " + (i === KEY || k === i % 4 ? "m" : "off") }, g));
    const c = { i, g, s, lid, dots, x: tween(i === KEY ? heldX() : QX[i]), lift: 0 };
    crates.push(c);
    things.push({ g, k: () => c.cx + YS[i] + CD / 2 });
  }

  function drawCrate(c, now) {
    const home = c.i === KEY ? heldX() : QX[c.i];
    const x = tval(c.x, now);
    // a clean crate travelling to PASS rides an arc over the queue; at home and at PASS it sits on the lane
    // only a crate heading past the gate rides the arc; a step up the queue stays on the lane
    const t = c.i === KEY || x > home - STEP - 1 ? 0 : clamp((home - x) / (home - PASS), 0, 1);
    const z = PL + ARC * Math.sin(Math.PI * t);
    c.cx = x;
    const Y0 = YS[c.i];
    const [o, inner] = rings(x - CW / 2, Y0, x + CW / 2, Y0 + CD, 3, 1.4);
    put(c.s, prism(P, front, o, inner, z, z + CH));
    c.lid.setAttribute("d", poly(ringAt(P, rrect(x - CW / 2 + 3.5, Y0 + 3.5, x + CW / 2 - 3.5, Y0 + CD - 3.5, 2, 4), z + CH)));
    c.dots.forEach((d, k) => place(d, P(x + ((k % 2) - 0.5) * 6, Y0 + CD / 2 + (Math.floor(k / 2) - 0.5) * 7, z + CH)));
  }

  function drawBar(now) {
    const z = tval(bz, now);
    const [o, i] = rings(GX - 3, -2, GX + 3, 42, 2, 0.9);
    put(bar, prism(P, front, o, i, z, z + 4));
  }

  let order = "";
  function sort() {
    const s = things.slice().sort((a, b) => a.k() - b.k());
    const key = s.map((t) => things.indexOf(t)).join(",");
    if (key !== order) { order = key; s.forEach((t) => root.appendChild(t.g)); }
  }

  const B = register(stage, (_dt, now) => {
    let moving = !tdone(bz, now);
    crates.forEach((c) => { drawCrate(c, now); if (!tdone(c.x, now)) moving = true; });
    drawBar(now); sort();
    return moving;
  });
  bag.add(B.unregister);

  // hit test: the crate whose RESTING centre is nearest the pointer on screen, within reach
  const restC = crates.map((c) => P(c.i === KEY ? GX + 4 + CW / 2 + 12 : QX[c.i], YS[c.i] + CD / 2, PL + CH));
  function hit([sx, sy]) {
    let best = -1, bd = 26;
    restC.forEach((p, i) => { const d = Math.hypot(sx - p[0], sy - p[1]); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  let act = -1;
  function setActive(a) {
    if (a === act) return;
    const now = performance.now();
    act = a;
    const clear = a >= 0 && a !== KEY;
    crates.forEach((c) => {
      const home = c.i === KEY ? heldX() : QX[c.i];
      // the crates queued behind a cleared one step up to close the gap, outwards from it
      const to = c.i === a && clear ? PASS : clear && c.i < a ? home - STEP : home;
      tset(c.x, to, now, clear && c.i < a ? Math.abs(c.i - a) * 45 : 0);
      c.s.sil.classList.toggle("hi", c.i === a);
    });
    tset(bz, clear ? BAR_UP : a === KEY ? BAR_PRESS : BAR_DOWN, now, clear ? 0 : 120);
    bar.sil.classList.toggle("hi", a < 0);
    read.textContent = a < 0 ? "rest" : `req ${a + 1} · ${a === KEY ? "held" : "pass"}`;
    B.wake();
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());
  read.textContent = "rest";

  return {
    set: (v) => { gap = v; const now = performance.now(); tset(crates[KEY].x, heldX(), now, 0); B.wake(); },
    destroy: bag.dispose,
  };
}

hairline({
  name: "checkpoint",
  means: "Crates queue at a gate: clean ones pass under the raised bar; the one carrying a key is held, bar down.",
  rules: [1, 2, 4, 5],
  range: [4, 12, 22],
  tour: [[150, 210], [205, 185], [255, 165], null],
  mount,
});
