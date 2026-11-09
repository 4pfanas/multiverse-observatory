/* Multiverse Observatory: interactive exhibits.
   Everything here is a classical simulation of ideal quantum measurements:
   H on every qubit followed by measurement yields uniform random bit strings. */
(function () {
  "use strict";

  /* ---------- constants (all verified in the README) ---------- */
  var QUBITS = 14;
  var OUTCOMES = 1 << QUBITS;          // 16,384 -> values 0..16383
  var TARGET = 1473;                    // the "winning" number (Copernicus's birth year)
  var FUTURES = 14000504;               // futures in the story
  var SHOTS = 4096;                     // shots per submission

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function randInt(n) { return Math.floor(Math.random() * n); }
  function bin(n, width) { var s = n.toString(2); while (s.length < width) s = "0" + s; return s; }
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- CircuitBoard: vanilla port of the React + framer-motion component ----------
     Same API shape: nodes {id,x,y,label,icon,status,size}, connections {from,to,animated,bidirectional}.
     Traces route with right angles, draw in, and carry a travelling pulse. Colours come from the
     --cb-* tokens in the stylesheet, so each theme styles the board without touching this code. */
  var boardSeq = 0;
  function cbNodeSize(size) { return size === "sm" ? 24 : size === "lg" ? 48 : 36; }
  function cbPath(from, to) {
    var fs = cbNodeSize(from.size) / 2 + 4, ts = cbNodeSize(to.size) / 2 + 4;
    var dx = to.x - from.x, dy = to.y - from.y, sx = from.x, sy = from.y, ex = to.x, ey = to.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      sx = from.x + (dx > 0 ? fs : -fs); ex = to.x + (dx > 0 ? -ts : ts);
      return "M " + sx + " " + sy + " H " + (from.x + dx / 2) + " V " + ey + " H " + ex;
    }
    sy = from.y + (dy > 0 ? fs : -fs); ey = to.y + (dy > 0 ? -ts : ts);
    return "M " + sx + " " + sy + " V " + (from.y + dy / 2) + " H " + ex + " V " + ey;
  }
  function CircuitPattern(name) {
    var P = {
      "data-flow": {
        nodes: [
          { id: "input", x: 50, y: 200, label: "Input", status: "active" },
          { id: "process1", x: 200, y: 100, label: "Process", status: "processing" },
          { id: "process2", x: 200, y: 300, label: "Validate", status: "active" },
          { id: "merge", x: 400, y: 200, label: "Merge", status: "active" },
          { id: "output", x: 550, y: 200, label: "Output", status: "active" }
        ],
        connections: [
          { from: "input", to: "process1" }, { from: "input", to: "process2" },
          { from: "process1", to: "merge" }, { from: "process2", to: "merge" }, { from: "merge", to: "output" }
        ]
      },
      network: {
        nodes: [
          { id: "server", x: 300, y: 80, label: "Server", status: "active", size: "lg" },
          { id: "client1", x: 100, y: 200, label: "Client 1", status: "active" },
          { id: "client2", x: 300, y: 250, label: "Client 2", status: "processing" },
          { id: "client3", x: 500, y: 200, label: "Client 3", status: "active" },
          { id: "db", x: 300, y: 350, label: "Database", status: "active" }
        ],
        connections: [
          { from: "server", to: "client1", bidirectional: true }, { from: "server", to: "client2", bidirectional: true },
          { from: "server", to: "client3", bidirectional: true }, { from: "server", to: "db", bidirectional: true }
        ]
      },
      processor: {
        nodes: [
          { id: "alu", x: 300, y: 200, label: "ALU", status: "processing", size: "lg" },
          { id: "reg1", x: 150, y: 100, label: "R1", status: "active", size: "sm" },
          { id: "reg2", x: 150, y: 200, label: "R2", status: "active", size: "sm" },
          { id: "reg3", x: 150, y: 300, label: "R3", status: "active", size: "sm" },
          { id: "cache", x: 450, y: 200, label: "Cache", status: "active" },
          { id: "out", x: 550, y: 200, label: "Out", status: "active", size: "sm" }
        ],
        connections: [
          { from: "reg1", to: "alu" }, { from: "reg2", to: "alu" }, { from: "reg3", to: "alu" },
          { from: "alu", to: "cache" }, { from: "cache", to: "out" }
        ]
      },
      tree: {
        nodes: [
          { id: "root", x: 300, y: 50, label: "Root", status: "active" },
          { id: "l1", x: 150, y: 150, label: "L1", status: "active" },
          { id: "r1", x: 450, y: 150, label: "R1", status: "processing" },
          { id: "l1l", x: 80, y: 280, label: "L1L", status: "active", size: "sm" },
          { id: "l1r", x: 220, y: 280, label: "L1R", status: "active", size: "sm" },
          { id: "r1l", x: 380, y: 280, label: "R1L", status: "error", size: "sm" },
          { id: "r1r", x: 520, y: 280, label: "R1R", status: "active", size: "sm" }
        ],
        connections: [
          { from: "root", to: "l1" }, { from: "root", to: "r1" }, { from: "l1", to: "l1l" },
          { from: "l1", to: "l1r" }, { from: "r1", to: "r1l" }, { from: "r1", to: "r1r" }
        ]
      }
    };
    return JSON.parse(JSON.stringify(P[name]));
  }
  function CircuitBoard(host, spec, o) {
    o = o || {};
    var W = o.width || 600, H = o.height || 400, gs = o.gridSize || 20, speed = o.pulseSpeed || 2, tw = o.traceWidth || 2;
    var showGrid = o.showGrid !== false, uid = "cb" + (++boardSeq);
    var glow = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cb-glow")) || 0;
    var nodes = spec.nodes, conns = spec.connections, map = {};
    nodes.forEach(function (n) { map[n.id] = n; });
    var s = '<svg class="cb" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"><defs>';
    if (glow > 0) s += '<filter id="' + uid + 'g" filterUnits="userSpaceOnUse" x="-' + W + '" y="-' + H + '" width="' + W * 3 + '" height="' + H * 3 + '"><feGaussianBlur stdDeviation="' + glow + '" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    if (showGrid) s += '<pattern id="' + uid + 'p" width="' + gs + '" height="' + gs + '" patternUnits="userSpaceOnUse"><circle cx="' + gs / 2 + '" cy="' + gs / 2 + '" r="1" class="cb-dot"/></pattern>';
    s += "</defs>";
    if (showGrid) s += '<rect width="' + W + '" height="' + H + '" fill="url(#' + uid + 'p)"/>';
    conns.forEach(function (c, i) {
      var a = map[c.from], b = map[c.to]; if (!a || !b) return;
      var d = cbPath(a, b);
      s += '<g class="cb-conn" data-i="' + i + '"><path class="cb-trace" d="' + d + '" pathLength="1" style="stroke-width:' + tw + "px;animation-delay:" + (i * 0.2) + 's"/>';
      if (c.animated !== false) s += '<path class="cb-pulse" d="' + d + '" pathLength="1"' + (glow > 0 ? ' filter="url(#' + uid + 'g)"' : "") + ' style="stroke-width:' + (tw + 2) + "px;animation-duration:" + speed + "s;animation-delay:" + (i * 0.3) + 's"/>';
      if (c.bidirectional) s += '<path class="cb-pulse rev" d="' + d + '" pathLength="1"' + (glow > 0 ? ' filter="url(#' + uid + 'g)"' : "") + ' style="stroke-width:' + (tw + 2) + "px;animation-duration:" + speed + "s;animation-delay:" + (i * 0.3 + speed / 2) + 's"/>';
      s += "</g>";
    });
    nodes.forEach(function (n, i) {
      var z = cbNodeSize(n.size), h = z / 2;
      s += '<g transform="translate(' + n.x + " " + n.y + ')"><g class="cb-node st-' + (n.status || "inactive") + '" data-id="' + n.id + '" style="animation-delay:' + (i * 0.1 + 0.5) + 's">';
      s += '<rect class="cb-glow" x="' + -h + '" y="' + -h + '" width="' + z + '" height="' + z + '"' + (glow > 0 ? ' filter="url(#' + uid + 'g)"' : "") + "/>";
      s += '<rect class="cb-box" x="' + -h + '" y="' + -h + '" width="' + z + '" height="' + z + '"/>';
      s += '<text class="cb-icon" y="1" style="font-size:' + Math.round(z * 0.36) + 'px">' + (n.icon || "") + "</text>";
      s += '<text class="cb-label" y="' + (h + 18) + '">' + (n.label || "") + "</text></g></g>";
    });
    host.innerHTML = s + "</svg>";
    return {
      setNode: function (id, p) {
        var el = host.querySelector('.cb-node[data-id="' + id + '"]'); if (!el) return;
        if (p.status) el.setAttribute("class", "cb-node st-" + p.status);
        if (p.label != null) el.querySelector(".cb-label").textContent = p.label;
        if (p.icon != null) el.querySelector(".cb-icon").textContent = p.icon;
      },
      setConnection: function (i, p) {
        var el = host.querySelector('.cb-conn[data-i="' + i + '"]'); if (!el) return;
        el.classList.toggle("is-dim", !!p.dim);
      }
    };
  }

  /* ---------- BranchDiagram: the two figures from the source article, as a component ----------
     BranchDiagram(host, preset, { onSelect }) draws a branching tree: purple-ish nodes, labelled arrows,
     spheres for the finished worlds. Click, tap or Enter on a world to light up the path that led to it.
     Presets: "stone" (Figure 1: give the stone or not) and "spin" (Figure 2: three up/down measurements). */
  var BRANCH_PRESETS = {
    stone: {
      label: "Decision tree: giving Thanos the stone leads to one future, not giving it leads to four",
      root: { x: 475, y: 30, kids: [
        { label: "Give Thanos the Stone", lx: 335, ly: 82, a: "end", n: { x: 235, y: 190, kids: [
          { n: { x: 155, y: 350, kids: [ { n: { x: 115, y: 535, leaf: "The one future where it works" } } ] } } ] } },
        { label: "Don't give Thanos the Stone", lx: 580, ly: 82, a: "start", n: { x: 715, y: 190, kids: [
          { n: { x: 635, y: 350, kids: [ { n: { x: 600, y: 535, leaf: "A future where it fails" } }, { n: { x: 675, y: 535, leaf: "A future where it fails" } } ] } },
          { n: { x: 790, y: 350, kids: [ { n: { x: 755, y: 535, leaf: "A future where it fails" } }, { n: { x: 835, y: 535, leaf: "A future where it fails" } } ] } } ] } }
      ] }
    },
    spin: (function () {
      var L = [115, 190, 280, 355, 600, 675, 755, 835];
      function leaf(i, mx) { var dn = i % 2 === 1; return { n: { x: L[i], y: 535, leaf: true }, label: dn ? "down" : "up", lx: (mx + L[i]) / 2 + (dn ? 9 : -9), ly: 445, a: dn ? "start" : "end" }; }
      function mid(x, i, lab, lx, a) { return { label: lab, lx: lx, ly: 270, a: a, n: { x: x, y: 350, kids: [leaf(i, x), leaf(i + 1, x)] } }; }
      return {
        label: "Binary tree: three spin measurements, each splitting into up and down, give eight worlds",
        root: { x: 475, y: 30, kids: [
          { label: "up", lx: 340, ly: 95, a: "end", n: { x: 235, y: 190, kids: [ mid(155, 0, "up", 170, "end"), mid(315, 2, "down", 300, "start") ] } },
          { label: "down", lx: 600, ly: 95, a: "start", n: { x: 715, y: 190, kids: [ mid(635, 4, "up", 625, "end"), mid(790, 6, "down", 780, "start") ] } }
        ] }
      };
    })()
  };
  function BranchDiagram(host, name, o) {
    o = o || {};
    var spec = BRANCH_PRESETS[name], uid = "bd" + (++boardSeq), W = 900, H = 600, R = 11, LR = 34;
    var leaves = [], edges = [], nodes = [];
    function walk(n, parentIdx, label, lx, ly, a, trail) {
      var idx = nodes.length, me = { x: n.x, y: n.y, leaf: !!n.leaf, parent: parentIdx, trail: trail.slice() };
      nodes.push(me);
      if (parentIdx >= 0) edges.push({ from: parentIdx, to: idx, label: label, lx: lx, ly: ly, a: a });
      if (n.leaf) { me.leafIndex = leaves.length; leaves.push(idx); me.text = typeof n.leaf === "string" ? n.leaf : ""; return; }
      (n.kids || []).forEach(function (k, i) {
        var t = trail.concat(k.label || ""); walk(k.n, idx, k.label, k.lx, k.ly, k.a, t);
      });
    }
    walk(spec.root, -1, "", 0, 0, "", []);
    var s = '<svg class="bd" viewBox="0 0 ' + W + " " + H + '" role="group" aria-label="' + spec.label + '"><defs>' +
      '<radialGradient id="' + uid + 'g" cx="38%" cy="32%" r="75%"><stop offset="0" style="stop-color:var(--bd-leaf-hi)"/><stop offset="1" style="stop-color:var(--bd-leaf-lo)"/></radialGradient></defs>';
    edges.forEach(function (e, i) {
      var a = nodes[e.from], b = nodes[e.to];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy), ux = dx / len, uy = dy / len;
      var sx = a.x + ux * (R + 3), sy = a.y + uy * (R + 3), rr = b.leaf ? LR : R, ex = b.x - ux * (rr + 3), ey = b.y - uy * (rr + 3);
      var hx = ex - ux * 11, hy = ey - uy * 11, px = -uy * 4.5, py = ux * 4.5;
      s += '<g class="bd-edge" data-e="' + i + '"><path class="bd-line" pathLength="1" d="M ' + sx.toFixed(1) + " " + sy.toFixed(1) + " L " + hx.toFixed(1) + " " + hy.toFixed(1) + '" style="animation-delay:' + (nodes[e.from].y / 600 * 0.9 + i * 0.03).toFixed(2) + 's"/>' +
        '<path class="bd-head" d="M ' + ex.toFixed(1) + " " + ey.toFixed(1) + " L " + (hx + px).toFixed(1) + " " + (hy + py).toFixed(1) + " L " + (hx - px).toFixed(1) + " " + (hy - py).toFixed(1) + ' Z"/>';
      if (e.label) s += '<text class="bd-label" x="' + e.lx + '" y="' + e.ly + '" text-anchor="' + e.a + '">' + e.label + "</text>";
      s += "</g>";
    });
    nodes.forEach(function (n, i) {
      if (n.leaf) {
        s += '<g class="bd-world" tabindex="0" role="button" data-leaf="' + n.leafIndex + '" aria-label="World ' + (n.leafIndex + 1) + '" transform="translate(' + n.x + " " + n.y + ')">' +
          '<circle class="bd-hit" r="' + (LR + 8) + '"/><circle class="bd-sphere" r="' + LR + '" fill="url(#' + uid + 'g)"/>' +
          '<ellipse class="bd-eq" rx="' + LR + '" ry="9"/><circle class="bd-spark" cx="-12" cy="-17" r="3.2"/></g>';
      } else {
        s += '<circle class="bd-node" data-n="' + i + '" cx="' + n.x + '" cy="' + n.y + '" r="' + R + '"/>';
      }
    });
    host.innerHTML = s + "</svg>";
    var els = host.querySelectorAll(".bd-world"), edgeEls = host.querySelectorAll(".bd-edge"), nodeEls = host.querySelectorAll(".bd-node"), cur = -1;
    function pathOf(leafIdx) {
      var i = leaves[leafIdx], ns = {}, es = {}, trail = [];
      while (i >= 0) { ns[i] = 1; i = nodes[i].parent; }
      edges.forEach(function (e, k) { if (ns[e.from] && ns[e.to]) { es[k] = 1; if (e.label) trail.push(e.label); } });
      return { ns: ns, es: es, trail: trail };
    }
    function select(k) {
      cur = k;
      var p = k >= 0 ? pathOf(k) : null;
      host.querySelector("svg").classList.toggle("has-pick", !!p);
      edgeEls.forEach(function (el, i) { el.classList.toggle("is-path", !!(p && p.es[i])); });
      nodeEls.forEach(function (el) { el.classList.toggle("is-path", !!(p && p.ns[el.getAttribute("data-n")])); });
      els.forEach(function (el, i) { el.classList.toggle("is-pick", i === k); });
      if (o.onSelect) o.onSelect(k, p ? p.trail : [], k >= 0 ? nodes[leaves[k]].text : "", leaves.length);
    }
    els.forEach(function (el, i) {
      el.addEventListener("click", function () { select(cur === i ? -1 : i); });
      el.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(cur === i ? -1 : i); } });
    });
    return { select: select, count: leaves.length, current: function () { return cur; } };
  }

  /* ---------- the 3D cloud: all 16,384 outcomes as points (three.js) ---------- */
  var stage = { observe: function () {}, release: function () {}, many: function () {}, reach: function () {}, drag: function () {}, interp: function () {} };
  (function stageInit() {
    var canvas = $("stage"); if (!canvas || !window.THREE) return;
    var T = THREE, N = OUTCOMES, renderer;
    try { renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true }); } catch (e) { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    var scene = new T.Scene(), cam = new T.PerspectiveCamera(48, 1, 0.1, 100), group = new T.Group();
    scene.add(group);
    var cs = getComputedStyle(document.documentElement);
    function col(n, d) { var v = cs.getPropertyValue(n).trim() || d; return new T.Color(v); }

    var A = new Float32Array(N * 3), B = new Float32Array(N * 3), C = new Float32Array(N * 3), seed = new Float32Array(N), lit = new Float32Array(N).fill(1), idx = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var sd = Math.random(); seed[i] = sd; idx[i] = i;
      var y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), ph = i * 2.399963;
      A[i * 3] = Math.cos(ph) * r * 2.4; A[i * 3 + 1] = y * 2.4; A[i * 3 + 2] = Math.sin(ph) * r * 2.4;
      var gx = i % 128, gy = Math.floor(i / 128);
      B[i * 3] = (gx - 63.5) / 127 * 7; B[i * 3 + 1] = (gy - 63.5) / 127 * 7; B[i * 3 + 2] = Math.sin(gx * 0.18) * Math.cos(gy * 0.18) * 0.5;
      var u = gx / 128 * 6.2832, v = gy / 128 * 6.2832;
      C[i * 3] = (2.3 + 0.9 * Math.cos(v)) * Math.cos(u); C[i * 3 + 1] = 0.9 * Math.sin(v); C[i * 3 + 2] = (2.3 + 0.9 * Math.cos(v)) * Math.sin(u);
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(A, 3));
    geo.setAttribute("aB", new T.BufferAttribute(B, 3));
    geo.setAttribute("aC", new T.BufferAttribute(C, 3));
    geo.setAttribute("aSeed", new T.BufferAttribute(seed, 1));
    geo.setAttribute("aIdx", new T.BufferAttribute(idx, 1));
    var litAttr = new T.BufferAttribute(lit, 1); litAttr.setUsage(T.DynamicDrawUsage);
    geo.setAttribute("aLit", litAttr);
    var U = {
      uMix: { value: new T.Vector2(0, 0) }, uTime: { value: 0 }, uCollapse: { value: 0 }, uPick: { value: -1 }, uMany: { value: 0 },
      uLitMix: { value: 0 }, uDim: { value: 1 }, uPx: { value: renderer.getPixelRatio() },
      cHot: { value: col("--stage-hot", "#ffc9a8") }, cDim: { value: col("--stage-dim", "#b83a00") }
    };
    var mat = new T.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: [
        "attribute vec3 aB; attribute vec3 aC; attribute float aSeed; attribute float aLit; attribute float aIdx;",
        "uniform vec2 uMix; uniform float uTime, uCollapse, uPick, uMany, uLitMix, uDim, uPx;",
        "varying float vA; varying float vHot;",
        "void main(){",
        "  vec3 p = mix(position, aB, uMix.x); p = mix(p, aC, uMix.y);",
        "  float isPick = step(abs(aIdx - uPick), 0.5);",
        "  float isTarget = step(abs(aIdx - 1473.0), 0.5);",
        "  p = mix(p, vec3(0.0), isPick * uCollapse * 0.92);",
        "  p += normalize(p + 0.001) * sin(uTime * 1.2 + aSeed * 40.0) * 0.05 * (1.0 - uCollapse);",
        "  vec3 dir = normalize(vec3(sin(aSeed * 91.0), cos(aSeed * 57.0), sin(aSeed * 33.0)));",
        "  p += dir * uCollapse * uMany * (0.5 + aSeed) * 1.1 * (1.0 - isPick);",
        "  float a = mix(1.0, mix(0.0, 0.3, uMany), uCollapse * (1.0 - isPick));",
        "  a = mix(a, a * mix(0.05, 1.0, aLit), uLitMix);",
        "  a *= 0.55 + 0.45 * sin(uTime * 1.6 + aSeed * 60.0);",
        "  a = max(a, isTarget * 0.9 * (1.0 - uLitMix * (1.0 - aLit)));",
        "  float size = (3.2 + aSeed * 2.6) * uPx;",
        "  size *= 1.0 + isTarget * 4.0 + isPick * 9.0 * uCollapse + aLit * uLitMix * 1.2;",
        "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
        "  gl_Position = projectionMatrix * mv;",
        "  gl_PointSize = size * (7.0 / -mv.z);",
        "  vA = clamp(a, 0.0, 1.0) * mix(uDim, 1.0, max(isTarget, isPick * uCollapse));",
        "  vHot = max(isTarget, isPick * uCollapse);",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 cHot, cDim; varying float vA; varying float vHot;",
        "void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;",
        "  float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(mix(cDim, cHot, vHot), a * vA * mix(0.9, 1.0, vHot)); }"
      ].join("\n")
    });
    var pts = new T.Points(geo, mat); pts.frustumCulled = false; group.add(pts);

    /* scroll -> shape, dimming and what the cloud means in each section */
    var SHAPES = { premise: [0, 0, 1], superposition: [1, 0, .6], measurement: [1, 0, .6], interpretations: [1, 1, .7], tree: [1, 1, .55], "qubit-lab": [0, 0, .6], circuit: [0, 0, .95], experiment: [1, 0, .55], physics: [1, 1, .5], sources: [0, 0, .4] };
    var secEls = Object.keys(SHAPES).map(function (k) { return document.getElementById(k); }).filter(Boolean);
    var curSec = "premise", reachOn = false;
    var NAMES = { premise: "The premise", superposition: "Superposition", measurement: "Measurement", interpretations: "Two readings", tree: "The branching tree", "qubit-lab": "Qubit lab", circuit: "Circuit builder", experiment: "Run the experiment", physics: "The real physics", sources: "Sources and corrections" };
    function pickSection() {
      var mid = window.innerHeight * 0.45, best = curSec;
      secEls.forEach(function (el) { var r = el.getBoundingClientRect(); if (r.top <= mid && r.bottom > mid) best = el.id; });
      if (best !== curSec) { curSec = best; $("hereLabel").textContent = NAMES[best]; }
      var max = document.documentElement.scrollHeight - window.innerHeight;
      document.documentElement.style.setProperty("--prog", (max > 0 ? window.scrollY / max : 0).toFixed(4));
    }
    window.addEventListener("scroll", pickSection, { passive: true });

    var tgt = { collapse: 0, many: 0, iCollapse: 0 }, pickHero = -1, pickInterp = -1, rot = { y: 0.4, x: 0.25, vy: 0.0006, vx: 0 }, ptr = { x: 0, y: 0 }, mask = null;
    window.addEventListener("pointermove", function (e) { ptr.x = e.clientX / window.innerWidth - 0.5; ptr.y = e.clientY / window.innerHeight - 0.5; });
    stage.observe = function (v) { pickHero = v; tgt.collapse = 1; };
    stage.interp = function (on, v) { tgt.iCollapse = on ? 1 : 0; if (on) pickInterp = v; };
    stage.release = function () { tgt.collapse = 0; };
    stage.many = function (on) { tgt.many = on ? 1 : 0; };
    stage.drag = function (dx, dy) { rot.vy = dx * 0.0009; rot.y += dx * 0.006; rot.x = Math.max(-1.2, Math.min(1.2, rot.x + dy * 0.005)); };
    stage.reach = function (m) {
      mask = m;
      for (var i = 0; i < N; i++) lit[i] = ((i & ~m) === 0) ? 1 : 0;
      litAttr.needsUpdate = true;
    };

    function resize() {
      var w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
      cam.position.set(0, 0, w > 1000 ? 8.6 : 10.5);
    }
    window.addEventListener("resize", resize); resize();

    var last = performance.now(), running = true;
    document.addEventListener("visibilitychange", function () { running = !document.hidden; if (running) { last = performance.now(); frame(last); } });
    function lerp(a, b, k) { return a + (b - a) * k; }
    function frame(now) {
      if (!running) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      var s = SHAPES[curSec], k = Math.min(1, dt * 2.4);
      U.uMix.value.x = lerp(U.uMix.value.x, s[0], k); U.uMix.value.y = lerp(U.uMix.value.y, s[1], k);
      U.uDim.value = lerp(U.uDim.value, s[2] * (window.innerWidth < 860 ? 0.62 : 1), k);
      var flat0 = U.uMix.value.x * (1 - U.uMix.value.y), hero = curSec === "premise", wide = window.innerWidth > 1000;
      var sc = (hero ? 1 : (wide ? 0.62 : 0.8)) * (1 - 0.22 * flat0 - 0.06 * U.uMix.value.y);
      group.scale.setScalar(lerp(group.scale.x, sc, k));
      group.position.x = lerp(group.position.x, wide ? (hero ? 2.7 : 3.55) : 0, k);
      var want = curSec === "premise" ? tgt.collapse : curSec === "interpretations" ? tgt.iCollapse : 0;
      if (want) U.uPick.value = curSec === "premise" ? pickHero : pickInterp;
      U.uCollapse.value = lerp(U.uCollapse.value, want, Math.min(1, dt * 3.2));
      U.uMany.value = lerp(U.uMany.value, tgt.many, k);
      U.uLitMix.value = lerp(U.uLitMix.value, curSec === "circuit" && mask !== null ? 1 : 0, k);
      U.uTime.value = reduceMotion ? 0 : now / 1000;
      rot.vy = lerp(rot.vy, reduceMotion ? 0 : 0.0006, 0.02);
      rot.y += rot.vy * dt * 1000 * 0.35 + dt * (reduceMotion ? 0 : 0.08);
      var flat = U.uMix.value.x * (1 - U.uMix.value.y);
      group.rotation.y = rot.y * (1 - flat * 0.7) + ptr.x * 0.5;
      group.rotation.x = lerp(rot.x, -0.9, flat * 0.55) + ptr.y * 0.35 + window.scrollY * 0.00012;
      renderer.render(scene, cam);
      requestAnimationFrame(frame);
    }
    pickSection(); requestAnimationFrame(frame);
    document.documentElement.classList.add("has-stage");
  })();

  /* ---------- depth: panels tilt toward the pointer ---------- */
  (function tilt() {
    if (reduceMotion || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    Array.prototype.forEach.call(document.querySelectorAll(".panel"), function (el) {
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = "perspective(1100px) rotateX(" + (-y * 2.4).toFixed(2) + "deg) rotateY(" + (x * 3.2).toFixed(2) + "deg)";
      });
      el.addEventListener("pointerleave", function () { el.style.transform = ""; });
    });
  })();

  /* ---------- 01 hero register ---------- */
  (function hero() {
    var reg = $("register"), cells = [], timer = null, collapsed = false;
    var observed = 0, wins = 0;
    for (var i = QUBITS - 1; i >= 0; i--) {
      var c = document.createElement("div");
      c.className = "qcell is-flux";
      var v = document.createElement("span"); v.textContent = "?";
      var idx = document.createElement("span"); idx.className = "qcell-idx"; idx.textContent = "q" + i;
      c.appendChild(v); c.appendChild(idx);
      reg.appendChild(c); cells.push(v);
    }
    function flux() {
      cells.forEach(function (v) {
        v.textContent = Math.random() < 0.5 ? "0" : "1";
        v.parentNode.className = "qcell is-flux";
      });
    }
    function startFlux() {
      stopFlux();
      cells.forEach(function (v) { v.parentNode.className = "qcell is-flux"; v.textContent = "?"; });
      if (!reduceMotion) { flux(); timer = setInterval(flux, 120); }
    }
    function stopFlux() { if (timer) { clearInterval(timer); timer = null; } }
    function observe() {
      stopFlux(); collapsed = true;
      var r = randInt(OUTCOMES), b = bin(r, QUBITS);
      cells.forEach(function (v, k) {
        var bit = b.charAt(k);
        v.textContent = bit;
        v.parentNode.className = "qcell" + (bit === "1" ? " is-one" : "");
      });
      observed++;
      var win = r === TARGET; if (win) wins++;
      stage.observe(r);
      $("heroState").textContent = "collapsed";
      $("heroReadout").textContent = "value: " + fmt(r) + " (" + b + ")" + (win ? "  ← the winning universe" : "");
      $("heroTally").textContent = "universes observed: " + fmt(observed) + " · winning universe (1,473): " + wins;
    }
    function release() {
      collapsed = false; startFlux(); stage.release();
      $("heroState").textContent = "superposition";
      $("heroReadout").textContent = "value: undecided";
    }
    $("heroObserve").addEventListener("click", observe);
    $("heroRelease").addEventListener("click", release);
    startFlux();
    /* drag the cloud to turn it; a click on it observes (or releases) */
    var sec = $("premise"), down = null;
    sec.addEventListener("pointerdown", function (e) { if (e.target.closest("button,.panel,.tiles,a")) return; down = { x: e.clientX, y: e.clientY, moved: 0 }; });
    window.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y; down.moved += Math.abs(dx) + Math.abs(dy); down.x = e.clientX; down.y = e.clientY; stage.drag(dx, dy);
    });
    window.addEventListener("pointerup", function () { if (down && down.moved < 6) { if (collapsed) release(); else observe(); } down = null; });
    window.addEventListener("pointercancel", function () { down = null; });
  })();

  /* ---------- 02 superposition ---------- */
  (function superposition() {
    var street = $("street"), spots = [];
    for (var i = 0; i < 16; i++) {
      var s = document.createElement("div"); s.className = "spot is-spread"; street.appendChild(s); spots.push(s);
    }
    $("streetObserve").addEventListener("click", function () {
      var k = randInt(16);
      spots.forEach(function (s, j) { s.className = "spot " + (j === k ? "is-found" : "is-gone"); });
      $("streetState").textContent = "observed";
      $("streetReadout").textContent = "Found at position " + (k + 1) + " of 16. The other 15 possibilities are gone.";
    });
    function reset() {
      spots.forEach(function (s) { s.className = "spot is-spread"; });
      $("streetState").textContent = "unobserved";
      $("streetReadout").textContent = "Before observation, it has no single position.";
    }
    $("streetReset").addEventListener("click", reset);

    var bars = $("qubitBars"), c = [0, 0], b = [], lbl = [];
    for (var n = 0; n < 2; n++) {
      var bar = document.createElement("div"); bar.className = "bar"; bar.style.height = "2px";
      var l = document.createElement("div"); l.className = "bar-count"; bar.appendChild(l);
      bars.appendChild(bar); b.push(bar); lbl.push(l);
    }
    function draw() {
      var t = c[0] + c[1];
      for (var k = 0; k < 2; k++) {
        var pct = t ? Math.min(100, (c[k] / t) * 160) : 0;
        b[k].style.height = Math.max(2, pct * 1.4) + "px";
        lbl[k].textContent = c[k] ? fmt(c[k]) : "";
      }
      $("qubitReadout").textContent = t
        ? "0: " + fmt(c[0]) + " · 1: " + fmt(c[1]) + " · " + (c[1] / t * 100).toFixed(1) + "% ones out of " + fmt(t)
        : "Each measurement is random. The pattern only shows up in bulk.";
    }
    $("qubitMeasure").addEventListener("click", function () {
      for (var i = 0; i < 1000; i++) c[Math.random() < 0.5 ? 0 : 1]++;
      draw();
    });
    $("qubitReset").addEventListener("click", function () { c = [0, 0]; draw(); });
    draw();
  })();

  /* ---------- 03 measurement (3 qubits) ---------- */
  (function measurement() {
    var bars = $("measBars"), labels = $("measLabels"), counts = new Array(8).fill(0), b = [], l = [], total = 0;
    for (var i = 0; i < 8; i++) {
      var bar = document.createElement("div"); bar.className = "bar"; bar.style.height = "2px";
      var cnt = document.createElement("div"); cnt.className = "bar-count"; bar.appendChild(cnt);
      bars.appendChild(bar); b.push(bar); l.push(cnt);
      var s = document.createElement("span"); s.textContent = bin(i, 3); labels.appendChild(s);
    }
    function draw() {
      for (var k = 0; k < 8; k++) {
        var pct = total ? Math.min(100, (counts[k] / (total / 8)) * 50) : 0;
        b[k].style.height = Math.max(2, pct * 1.4) + "px";
        l[k].textContent = counts[k] ? fmt(counts[k]) : "";
      }
      $("measCount").textContent = fmt(total) + (total === 1 ? " measurement" : " measurements");
    }
    function shot() { var r = randInt(8); counts[r]++; total++; return r; }
    $("measOne").addEventListener("click", function () {
      var r = shot(); draw();
      $("measReadout").textContent = "last result: " + bin(r, 3) + " (" + r + ")";
    });
    $("measHundred").addEventListener("click", function () {
      var r = 0; for (var i = 0; i < 100; i++) r = shot(); draw();
      $("measReadout").textContent = "last result: " + bin(r, 3) + " (" + r + ") · the bars drift toward equal heights";
    });
    $("measReset").addEventListener("click", function () {
      counts = new Array(8).fill(0); total = 0; draw();
      $("measReadout").textContent = "last result: none yet";
    });
    draw();
  })();

  /* ---------- 04 interpretations ---------- */
  (function interpretations() {
    var mode = "cop", measured = false, outcome = "up", lastPick = -1, fresh = false;
    var worlds = $("worlds");
    function card(cls, title, body) {
      var d = document.createElement("div"); d.className = "world-card " + cls;
      var t = document.createElement("div"); t.className = "h3"; t.textContent = title;
      var p = document.createElement("div"); p.className = "readout"; p.textContent = body;
      d.appendChild(t); d.appendChild(p); return d;
    }
    function render() {
      worlds.innerHTML = "";
      var other = outcome === "up" ? "down" : "up";
      $("segCop").setAttribute("aria-pressed", String(mode === "cop"));
      $("segMany").setAttribute("aria-pressed", String(mode === "many"));
      $("interpTitle").textContent = mode === "cop"
        ? "Copenhagen: one outcome, the rest is gone"
        : "Many worlds: every outcome happens, in its own branch";
      $("interpState").textContent = measured ? "after measurement" : "before";
      stage.many(mode === "many");
      stage.interp(measured, measured ? (lastPick = lastPick >= 0 && !fresh ? lastPick : randInt(OUTCOMES)) : -1); fresh = false;
      var row = document.createElement("div"); row.className = "world-row";
      var copy;
      if (!measured) {
        row.appendChild(card("is-lit", "Particle", "spin: up and down together (superposition)"));
        copy = "Before anyone measures, the maths describes the spin as both values at once.";
      } else if (mode === "cop") {
        row.appendChild(card("is-lit", "The one real result", "spin " + outcome));
        row.appendChild(card("is-ghost", "Spin " + other, "never happened"));
        copy = "The superposition collapses. Only spin " + outcome + " is real now. The equations predict the odds but do not say why this result was picked.";
      } else {
        row.appendChild(card("is-lit", "Branch A: observer sees up", "spin up, observer records up"));
        row.appendChild(card("is-lit", "Branch B: observer sees down", "spin down, observer records down"));
        copy = "Nothing collapses. The measurement links the observer to the particle, so one version of the observer sees up and another sees down. Both branches exist.";
      }
      worlds.appendChild(row);
      $("interpCopy").textContent = copy;
    }
    $("segCop").addEventListener("click", function () { mode = "cop"; render(); });
    $("segMany").addEventListener("click", function () { mode = "many"; render(); });
    $("interpMeasure").addEventListener("click", function () { outcome = Math.random() < 0.5 ? "up" : "down"; measured = true; fresh = true; render(); });
    $("interpReset").addEventListener("click", function () { measured = false; render(); });
    render();
    /* Figure 2 from the article: three spin measurements, each one splitting into up and down */
    var spinNote = "Each measurement splits the story in two, so three in a row give 2 × 2 × 2 = 8 worlds. In the many-worlds reading all eight exist. In Copenhagen only the path you actually get is real. Tap a world to trace its path.";
    $("spinNote").textContent = spinNote;
    BranchDiagram($("spinBoard"), "spin", { onSelect: function (k, trail) {
      $("spinState").textContent = k < 0 ? "tap a world" : "world " + (k + 1) + " of 8";
      $("spinNote").textContent = k < 0 ? spinNote : "Path: " + trail.join(" → ") + ". That is one of 8 worlds. Fourteen measurements would give 2^14 = 16,384.";
    } });
  })();

  /* ---------- 05 branching tree (4 decisions, 16 futures) ---------- */
  (function tree() {
    var DEPTH = 4, N = 16;
    var leavesEl = $("leaves"), leaves = [];
    for (var i = 0; i < N; i++) {
      var d = document.createElement("div"); d.className = "leaf"; d.textContent = String(i + 1);
      leavesEl.appendChild(d); leaves.push(d);
    }
    var winner, lo, hi, path, done, peek, played = 0, found = 0;
    function newTree() {
      winner = randInt(N); lo = 0; hi = N; path = []; done = false; peek = false; played++;
      render();
    }
    function render() {
      leaves.forEach(function (el, i) {
        var cls = "leaf";
        if (!done && i >= lo && i < hi) cls += " is-reach";
        if (done && i === winner) cls += " is-win";
        if (done && i === lo && lo !== winner) cls += " is-lost";
        if (peek && !done && i === winner) cls += " is-peek";
        el.className = cls;
      });
      $("treeAttempts").textContent = "tree " + played + " · winner found " + found + (found === 1 ? " time" : " times");
      var p = path.length ? path.join(" → ") : "none yet";
      if (!done) {
        $("treePath").textContent = "Decision " + (path.length + 1) + " of " + DEPTH + ": choose a side. Path so far: " + p;
        $("treeReadout").textContent = (hi - lo) + " futures still reachable. Odds of landing on the winner by guessing: 1 in " + (hi - lo) + " from here.";
      } else if (lo === winner) {
        $("treePath").textContent = "Path: " + p + ". You reached future " + (lo + 1) + ", the winning one.";
        $("treeReadout").textContent = "Lucky. Guessing gets this right 1 time in 16. At 24 decisions it would be 1 in 16,777,216.";
      } else {
        $("treePath").textContent = "Path: " + p + ". You reached future " + (lo + 1) + ". The winner was future " + (winner + 1) + ".";
        $("treeReadout").textContent = "Missed. All 15 other futures still happen in the many-worlds picture, which is the whole point.";
      }
      $("treeLeft").disabled = done; $("treeRight").disabled = done;
    }
    function choose(side) {
      if (done) return;
      var mid = (lo + hi) / 2;
      if (side === "L") { hi = mid; } else { lo = mid; }
      path.push(side);
      if (path.length === DEPTH) { done = true; if (lo === winner) found++; }
      render();
    }
    $("treeLeft").addEventListener("click", function () { choose("L"); });
    $("treeRight").addEventListener("click", function () { choose("R"); });
    $("treePeek").addEventListener("click", function () { peek = !peek; render(); });
    $("treeNew").addEventListener("click", newTree);
    newTree();
    /* Figure 1 from the article: the sorcerer's choice, drawn as a small tree */
    var stoneNote = "A toy version of Doctor Strange's search, with five futures instead of 14,000,504. Giving Thanos the stone leads to one future. Refusing leads to four. Tap a world to follow its path.";
    $("stoneNote").textContent = stoneNote;
    BranchDiagram($("stoneBoard"), "stone", { onSelect: function (k, trail, text) {
      $("stoneState").textContent = k < 0 ? "tap a world" : "world " + (k + 1) + " of 5";
      $("stoneNote").textContent = k < 0 ? stoneNote : "Choice: " + trail[0] + ". " + text + ". " + (k === 0 ? "Only this branch ends well, which is why Strange hands it over." : "Four of the five futures end badly, so refusing is the losing bet.");
    } });
  })();

  /* ---------- 06 qubit lab ---------- */
  (function lab() {
    var range = $("labRange"), MAXQ = 30;
    $("mark14").style.left = (14 / MAXQ * 100) + "%";
    $("mark24").style.left = (24 / MAXQ * 100) + "%";
    function pctText(p) {
      if (p < 1) return p.toFixed(2) + "%";
      if (p < 100) return p.toFixed(1) + "%";
      return Math.round(p).toLocaleString("en-US") + "%";
    }
    function update() {
      var n = parseInt(range.value, 10), out = Math.pow(2, n);
      $("labN").textContent = n + (n === 1 ? " qubit" : " qubits");
      $("labFill").style.width = (n / MAXQ * 100) + "%";
      $("labOutcomes").textContent = fmt(out);
      $("labCover").textContent = pctText(out / FUTURES * 100);
      var enough = out >= FUTURES;
      $("labVerdict").textContent = enough ? "enough" : "not enough";
      var note;
      if (n === 14) note = "The 14-qubit machine used in the article.";
      else if (n === 23) note = "23 qubits give 8,388,608, still short.";
      else if (n === 24) note = "The smallest size that covers every future.";
      else if (enough) note = "More than enough room.";
      else note = "Short by " + fmt(FUTURES - out) + " futures.";
      $("labNote").textContent = note;
    }
    range.addEventListener("input", update);
    update();
  })();

  /* ---------- 07 circuit builder ---------- */
  (function circuit() {
    var host = $("circuitHost"), gates = new Array(QUBITS).fill(true), btns = [];
    var head = document.createElement("div"); head.className = "wire wire-head";
    ["wire", "weight · target bit", "", "H", "M"].forEach(function (t, i) {
      var d = document.createElement("div"); d.textContent = t; if (i >= 3) d.className = "c"; head.appendChild(d);
    });
    host.appendChild(head);
    for (var i = 0; i < QUBITS; i++) {
      (function (i) {
        var row = document.createElement("div"); row.className = "wire";
        var lab = document.createElement("div"); lab.className = "wire-label"; lab.textContent = "q" + i;
        var w = document.createElement("div"); w.className = "wire-weight";
        var tb = (TARGET >> i) & 1;
        w.appendChild(document.createTextNode(fmt(1 << i) + " → "));
        var t = document.createElement("span"); t.className = "tbit" + (tb ? " is-one" : ""); t.textContent = String(tb); w.appendChild(t);
        var line = document.createElement("div"); line.className = "wire-line";
        var gc = document.createElement("div"); gc.className = "gate-cell";
        var g = document.createElement("button"); g.className = "gate"; g.textContent = "H";
        g.setAttribute("aria-label", "Hadamard gate on qubit " + i);
        g.addEventListener("click", function () { gates[i] = !gates[i]; draw(); });
        gc.appendChild(g); btns.push(g);
        var m = document.createElement("div"); m.className = "meas"; m.textContent = "M";
        row.appendChild(lab); row.appendChild(w); row.appendChild(line); row.appendChild(gc); row.appendChild(m);
        host.appendChild(row);
      })(i);
    }
    function draw() {
      var k = 0, reach = true;
      for (var i = 0; i < QUBITS; i++) {
        btns[i].setAttribute("aria-pressed", String(gates[i]));
        if (gates[i]) k++;
        if (((TARGET >> i) & 1) && !gates[i]) reach = false;
      }
      var prob = reach ? 1 / Math.pow(2, k) : 0, pct = prob * 100;
      $("cH").textContent = k;
      $("cOut").textContent = fmt(Math.pow(2, k));
      $("cReach").textContent = reach ? "yes" : "no";
      $("cProb").textContent = prob === 0 ? "0%" : (pct >= 1 ? pct.toFixed(2) : pct.toFixed(4)) + "%";
    }
    $("cAll").addEventListener("click", function () { gates.fill(true); draw(); });
    /* live data-flow board (CircuitBoard "data-flow" pattern, relabelled for this circuit) */
    var flowSpec = CircuitPattern("data-flow"), flowLab = { input: ["Start", "|0⟩"], process1: ["H wires", "H"], process2: ["Idle wires", "·"], merge: ["Measure", "M"], output: ["Output", "#"] };
    flowSpec.nodes.forEach(function (n) { n.label = flowLab[n.id][0]; n.icon = flowLab[n.id][1]; n.size = "lg"; });
    var flow = CircuitBoard($("flowBoard"), flowSpec, { height: 380 });
    function updateFlow(k, reach) {
      flow.setNode("process1", { label: k + " H wires", status: k === 0 ? "inactive" : "active" });
      flow.setNode("process2", { label: (QUBITS - k) + " idle wires", status: k === QUBITS ? "inactive" : "active" });
      flow.setNode("merge", { status: "processing" });
      flow.setNode("output", { label: reach ? "1,473: yes" : "1,473: no", status: reach ? "active" : "error" });
      flow.setConnection(0, { dim: k === 0 }); flow.setConnection(2, { dim: k === 0 });
      flow.setConnection(1, { dim: k === QUBITS }); flow.setConnection(3, { dim: k === QUBITS });
      flow.setConnection(4, { dim: !reach });
      $("flowState").textContent = k + " of " + QUBITS + " wires on";
      $("flowNote").textContent = k === 0
        ? "No H gates: every wire stays 0, so the only possible result is 0. Nothing is in superposition."
        : k === QUBITS
          ? "All wires carry an H. Every one of the " + fmt(Math.pow(2, QUBITS)) + " bit patterns is possible and equally likely."
          : reach
            ? "Only the H wires are uncertain; idle wires stay fixed at 0. The outputs are limited to " + fmt(Math.pow(2, k)) + " numbers, and 1,473 is among them."
            : "A wire that needs a 1 has no H, so it is stuck at 0 and 1,473 can never come out.";
    }
    var drawBase = draw;
    draw = function () { drawBase(); var k = 0, r = true; for (var i = 0; i < QUBITS; i++) { if (gates[i]) k++; if (((TARGET >> i) & 1) && !gates[i]) r = false; } updateFlow(k, r); var m = 0; for (var j = 0; j < QUBITS; j++) if (gates[j]) m |= (1 << j); stage.reach(m); };
    draw();
    $("cNone").addEventListener("click", function () { gates.fill(false); draw(); });
    $("cNeeded").addEventListener("click", function () {
      for (var i = 0; i < QUBITS; i++) gates[i] = ((TARGET >> i) & 1) === 1;
      draw();
    });
    draw();
  })();

  /* ---------- 08 experiment ---------- */
  (function experiment() {
    var shots = 0, subs = 0, wins = 0, subWins = 0, log = $("expLog");
    function pushLog(left, right, win) {
      var d = document.createElement("div"); if (win) d.className = "is-win";
      var a = document.createElement("span"); a.textContent = left;
      var b = document.createElement("span"); b.textContent = right;
      d.appendChild(a); d.appendChild(b);
      log.insertBefore(d, log.firstChild);
      while (log.children.length > 10) log.removeChild(log.lastChild);
    }
    function render() {
      $("eShots").textContent = fmt(shots);
      $("eSubs").textContent = fmt(subs);
      $("eOther").textContent = fmt(shots - wins);
      $("eWins").textContent = fmt(wins);
      $("eSubWins").textContent = fmt(subWins);
      var rate = subs ? subWins / subs * 100 : 0;
      $("eRate").textContent = subs ? "(" + rate.toFixed(1) + "% of " + fmt(subs) + ")" : "";
      $("eMeter").style.width = Math.min(100, rate) + "%";
    }
    function submission() {
      var hits = 0;
      for (var i = 0; i < SHOTS; i++) if (randInt(OUTCOMES) === TARGET) hits++;
      shots += SHOTS; subs++; wins += hits; if (hits > 0) subWins++;
      return hits;
    }
    $("expOne").addEventListener("click", function () {
      var r = randInt(OUTCOMES), win = r === TARGET;
      shots++; if (win) wins++;
      pushLog("shot → " + fmt(r), win ? "winning world" : "other world", win);
      render();
    });
    $("expSub").addEventListener("click", function () {
      var h = submission();
      pushLog("submission " + fmt(subs) + " · 4,096 shots", h + (h === 1 ? " win" : " wins"), h > 0);
      render();
    });
    $("expHundred").addEventListener("click", function () {
      var h = 0, i;
      for (i = 0; i < 100; i++) h += submission();
      pushLog("100 submissions · 409,600 shots", h + (h === 1 ? " win" : " wins"), h > 0);
      render();
    });
    $("expReset").addEventListener("click", function () {
      shots = subs = wins = subWins = 0; log.innerHTML = ""; render();
    });
    render();
  })();
})();
