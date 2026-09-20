(() => {
  const GRID = 52;
  const RADIUS = 20;
  const COLORS = ["#2f6fed", "#c03636", "#1a8f62", "#b45309", "#6d4ae8", "#c23078", "#0e7f8c"];

  const ic = (name) => `<span class="ic" data-ic="${name}" aria-hidden="true"></span>`;
  const entering = new Set();

  const ICON = {
    move: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 2v12M2 8h12"/></svg>'
  };

  const tablesRoot = document.getElementById("tables");
  const wires = document.getElementById("wires");
  const noteEl = document.getElementById("note");
  const exportMenu = document.getElementById("export-menu");
  const importMenu = document.getElementById("import-menu");
  const importFile = document.getElementById("import-file");

  let nid = 0;
  let tableSeq = 0;
  let zTop = 2;
  let colorSeq = 0;
  const tables = [];
  const relations = [];

  let moving = null;
  let linking = null;
  let noteTimer = 0;
  let swallowClick = false;
  const view = { x: 0, y: 0, scale: 1 };

  const uid = (prefix) => prefix + (++nid);
  const peekColor = () => COLORS[colorSeq % COLORS.length];
  const tableById = (id) => tables.find((t) => t.id === id);
  const columnById = (table, id) => table.columns.find((c) => c.id === id);
  const fkOf = (colId) => relations.find((r) => r.toColumnId === colId);
  const pkColumns = (table) => table.columns.filter((c) => c.pk);
  const isEmpty = () => tables.length === 0;

  function screenToWorld(sx, sy) {
    return {
      x: (sx - view.x) / view.scale,
      y: (sy - view.y) / view.scale
    };
  }

  function applyView() {
    tablesRoot.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    document.body.style.backgroundSize = `${GRID * view.scale}px ${GRID * view.scale}px`;
    document.body.style.backgroundPosition = `${view.x}px ${view.y}px`;
  }

  function zoomBy(factor, cx, cy, animated) {
    const old = view.scale;
    const next = Math.min(2.5, Math.max(0.4, old * factor));
    if (next === old) return;
    const wx = (cx - view.x) / old;
    const wy = (cy - view.y) / old;
    const nx = cx - wx * next;
    const ny = cy - wy * next;
    if (animated) {
      animateView(nx, ny, next);
      return;
    }
    viewAnim += 1;
    view.scale = next;
    view.x = nx;
    view.y = ny;
    applyView();
    drawWires();
  }

  let viewAnim = 0;
  function animateView(toX, toY, toScale, ms = 200) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      view.x = toX;
      view.y = toY;
      view.scale = toScale;
      applyView();
      drawWires();
      return;
    }
    const fromX = view.x;
    const fromY = view.y;
    const fromS = view.scale;
    const t0 = performance.now();
    const id = ++viewAnim;
    const ease = (t) => 1 - (1 - t) ** 3;
    const frame = (now) => {
      if (id !== viewAnim) return;
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      view.x = fromX + (toX - fromX) * e;
      view.y = fromY + (toY - fromY) * e;
      view.scale = fromS + (toScale - fromS) * e;
      applyView();
      drawWires();
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function resetView() {
    animateView(0, 0, 1);
  }

  function fitView() {
    if (!tables.length) {
      resetView();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    tables.forEach((t) => {
      const el = tblEl(t.id);
      const w = el ? el.offsetWidth : 220;
      const h = el ? el.offsetHeight : 80;
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + w);
      maxY = Math.max(maxY, t.y + h);
    });
    const pad = 72;
    const bw = Math.max(1, maxX - minX + pad * 2);
    const bh = Math.max(1, maxY - minY + pad * 2);
    const next = Math.min(1, Math.max(0.4, Math.min(window.innerWidth / bw, window.innerHeight / bh)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    animateView(
      window.innerWidth / 2 - cx * next,
      window.innerHeight / 2 - cy * next,
      next
    );
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  function showNote(text, ms) {
    noteEl.textContent = text;
    noteEl.hidden = false;
    noteEl.classList.remove("show");
    void noteEl.offsetWidth;
    noteEl.classList.add("show");
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      noteEl.hidden = true;
      noteEl.classList.remove("show");
    }, ms || Math.min(5200, Math.max(2400, String(text).length * 45)));
  }

  function uniqueColumnName(table, base) {
    const used = new Set(table.columns.map((c) => c.name));
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base}_${n}`)) n += 1;
    return `${base}_${n}`;
  }

  function slugJoin(a, b) {
    return `${a}_${b}`.replace(/\s+/g, "_");
  }

  function colHTML(table, col) {
    const rel = fkOf(col.id);
    const classes = ["col"];
    if (col.pk) classes.push("pk");
    if (rel) classes.push("fk");
    if (entering.has(col.id)) classes.push("enter");
    const fkStyle = rel ? ` style="--fk:${rel.color}"` : "";
    return `
      <div class="${classes.join(" ")}" data-id="${col.id}"${fkStyle}>
        <span class="pk-hit" title="Drag to another table">
          <span class="pk-ic ic" data-ic="key" aria-hidden="true"></span>
        </span>
        <div class="name" contenteditable="true" spellcheck="false">${escapeHtml(col.name)}</div>
        <div class="col-actions">
          <button type="button" class="circle key-btn${col.pk ? " key-off" : ""}" aria-label="${col.pk ? "Remove key" : "Make key"}">${ic("key")}</button>
          <button type="button" class="circle del-col" aria-label="Delete row">${ic("cross")}</button>
        </div>
      </div>
      <div class="sep" data-table="${table.id}" data-index="${table.columns.indexOf(col) + 1}">
        <button type="button" class="sep-plus" aria-label="Add row">${ic("plus")}</button>
      </div>`;
  }

  function tableHTML(table) {
    const cols = table.columns.map((c) => colHTML(table, c)).join("");
    return `
      <article class="tbl${entering.has(table.id) ? " enter" : ""}" data-id="${table.id}" style="left:${table.x}px;top:${table.y}px;z-index:${table.z}">
        <header class="tbl-head">
          <div class="name" contenteditable="true" spellcheck="false">${escapeHtml(table.name)}</div>
          <div class="head-grip" aria-hidden="true"></div>
          <button type="button" class="circle tbl-del" aria-label="Delete table">${ic("cross")}</button>
        </header>
        <div class="sep" data-table="${table.id}" data-index="0">
          <button type="button" class="sep-plus" aria-label="Add row">${ic("plus")}</button>
        </div>
        <div class="tbl-cols">${cols}</div>
        <button type="button" class="move" aria-label="Move table">${ICON.move}</button>
      </article>`;
  }

  function flushEdit() {
    const el = document.activeElement;
    if (el && el.classList && el.classList.contains("name")) {
      saveName(el);
      el.blur();
    }
  }

  function renderTables() {
    flushEdit();
    tablesRoot.innerHTML = tables.map(tableHTML).join("");
    entering.clear();
  }

  function dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function toward(from, to, d) {
    const L = dist(from, to);
    if (L === 0) return { x: from.x, y: from.y };
    const t = Math.min(d, L) / L;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }

  function collinear(a, b, c) {
    const sameX = Math.abs(a.x - b.x) < 0.6 && Math.abs(b.x - c.x) < 0.6;
    const sameY = Math.abs(a.y - b.y) < 0.6 && Math.abs(b.y - c.y) < 0.6;
    return sameX || sameY;
  }

  function simplify(points) {
    const out = [];
    for (const p of points) {
      if (out.length && dist(out[out.length - 1], p) < 0.8) continue;
      while (out.length >= 2 && collinear(out[out.length - 2], out[out.length - 1], p)) out.pop();
      out.push(p);
    }
    return out;
  }

  function roundedPath(raw, radius = RADIUS) {
    const pts = simplify(raw);
    if (!pts.length) return "";
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const next = pts[i + 1];
      const r = Math.min(radius, dist(prev, curr) / 2, dist(curr, next) / 2);
      const a = toward(curr, prev, r);
      const b = toward(curr, next, r);
      d += ` L ${a.x} ${a.y} Q ${curr.x} ${curr.y} ${b.x} ${b.y}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  }

  function laneShift(lane, room) {
    const pitch = Math.max(26, Math.min(44, room));
    const raw = lane * pitch;
    if (raw === 0) return 0;
    const cap = Math.max(13, room);
    return Math.max(-cap, Math.min(cap, raw));
  }

  function routePoints(x1, y1, x2, y2, lane = 0) {
    const stub = 20;
    const goingRight = x2 >= x1;
    const s = goingRight ? 1 : -1;
    const start = { x: x1, y: y1 };
    const end = { x: x2, y: y2 };
    const a = { x: x1 + s * stub, y: y1 };
    const b = { x: x2 - s * stub, y: y2 };
    const gap = (b.x - a.x) * s;
    const spread = laneShift(lane, Math.max(0, gap / 2 - 8));

    if (gap >= RADIUS) {
      const midX = (a.x + b.x) / 2 + spread;
      return [start, a, { x: midX, y: y1 }, { x: midX, y: y2 }, b, end];
    }

    const around = 36 + Math.abs(spread);
    const baseY = y1 <= y2 ? Math.min(y1, y2) - around : Math.max(y1, y2) + around;
    const ax = a.x + spread;
    const bx = b.x + spread;
    const hy = baseY + spread;
    return [start, { x: ax, y: y1 }, { x: ax, y: hy }, { x: bx, y: hy }, { x: bx, y: y2 }, end];
  }

  function lastSegment(pts) {
    for (let i = pts.length - 1; i > 0; i -= 1) {
      if (dist(pts[i], pts[i - 1]) > 0.8) return [pts[i - 1], pts[i]];
    }
    return [pts[0], pts[pts.length - 1]];
  }

  function arrowHead(pts, size = 8) {
    const [from, to] = lastSegment(simplify(pts));
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const a1 = angle + Math.PI * 0.82;
    const a2 = angle - Math.PI * 0.82;
    const p1 = `${to.x + Math.cos(a1) * size},${to.y + Math.sin(a1) * size}`;
    const p2 = `${to.x + Math.cos(a2) * size},${to.y + Math.sin(a2) * size}`;
    return `${to.x},${to.y} ${p1} ${p2}`;
  }

  function arrowMarkup(x1, y1, x2, y2, color, lane = 0) {
    const pts = routePoints(x1, y1, x2, y2, lane);
    const d = roundedPath(pts);
    return `<g>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>
      <polygon points="${arrowHead(pts)}" fill="${color}"/>
    </g>`;
  }

  function tblEl(id) {
    return tablesRoot.querySelector(`.tbl[data-id="${id}"]`);
  }

  function colEl(tableId, colId) {
    return tablesRoot.querySelector(`.tbl[data-id="${tableId}"] .col[data-id="${colId}"]`);
  }

  function sideAnchor(tableId, columnId, side) {
    const table = tblEl(tableId);
    const row = colEl(tableId, columnId);
    if (!table || !row) return null;
    const t = table.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return {
      x: side === "right" ? t.right : t.left,
      y: r.top + r.height / 2
    };
  }

  function pickSides(fromTableId, toX) {
    const el = tblEl(fromTableId);
    if (!el) return ["right", "left"];
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    return toX >= cx ? ["right", "left"] : ["left", "right"];
  }

  function relationEnds(rel) {
    const toTable = tblEl(rel.toTableId);
    if (!toTable) return null;
    const toBox = toTable.getBoundingClientRect();
    const toCx = toBox.left + toBox.width / 2;
    const [fromSide, toSide] = pickSides(rel.fromTableId, toCx);
    const a = sideAnchor(rel.fromTableId, rel.fromColumnId, fromSide);
    const b = sideAnchor(rel.toTableId, rel.toColumnId, toSide);
    if (!a || !b) return null;
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }

  function relationLanes() {
    const groups = new Map();
    relations.forEach((r) => {
      const key = `${r.fromTableId}>${r.toTableId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    const lane = new Map();
    groups.forEach((list) => {
      list.forEach((r, i) => lane.set(r.id, i - (list.length - 1) / 2));
    });
    return lane;
  }

  function drawWires() {
    const parts = [];
    const lanes = relationLanes();
    for (const rel of relations) {
      const ends = relationEnds(rel);
      if (!ends) continue;
      parts.push(arrowMarkup(ends.x1, ends.y1, ends.x2, ends.y2, rel.color, lanes.get(rel.id) || 0));
    }
    if (linking) {
      const [fromSide] = pickSides(linking.fromTableId, linking.x);
      const ids = linking.fromColumnIds || [linking.fromColumnId];
      ids.forEach((colId, i) => {
        const a = sideAnchor(linking.fromTableId, colId, fromSide);
        if (!a) return;
        const lane = i - (ids.length - 1) / 2;
        parts.push(arrowMarkup(a.x, a.y, linking.x, linking.y, linking.color, lane));
      });
    }
    wires.innerHTML = parts.join("");
  }

  let wireFrame = 0;
  function scheduleWires() {
    if (wireFrame) return;
    wireFrame = requestAnimationFrame(() => {
      wireFrame = 0;
      drawWires();
    });
  }

  function clearHot() {
    tablesRoot.querySelectorAll(".sep.hot").forEach((el) => {
      el.classList.remove("hot");
      el.style.removeProperty("--hot");
    });
  }

  function findDropTarget(px, py) {
    let best = null;
    for (const table of tables) {
      if (linking && table.id === linking.fromTableId) continue;
      const el = tblEl(table.id);
      if (!el) continue;
      const box = el.getBoundingClientRect();
      if (px < box.left - 10 || px > box.right + 10 || py < box.top - 12 || py > box.bottom + 16) continue;
      const seps = el.querySelectorAll(".sep");
      seps.forEach((sep) => {
        const r = sep.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const d = Math.abs(py - y);
        if (d < 12 && (!best || d < best.dist)) {
          best = {
            tableId: table.id,
            index: Number(sep.dataset.index),
            dist: d,
            sep
          };
        }
      });
    }
    return best;
  }

  function addTable() {
    tableSeq += 1;
    const w = 220;
    const gap = 80;
    const centre = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    let x = Math.round(centre.x - 110);
    let y = Math.round(centre.y - 48);
    if (tables.length) {
      const last = tables[tables.length - 1];
      x = last.x + w + gap;
      y = last.y;
      const lastScreen = last.x * view.scale + view.x;
      if (lastScreen + (w + gap + w) * view.scale > window.innerWidth - 24) {
        x = Math.round(centre.x - 110);
        y = last.y + 180;
      }
    }
    const id = uid("t");
    entering.add(id);
    tables.push({
      id,
      name: `Table ${tableSeq}`,
      x,
      y,
      z: ++zTop,
      colSeq: 0,
      columns: []
    });
    renderTables();
    drawWires();
  }

  function addColumn(table, index, name, pk = false) {
    const col = { id: uid("c"), name, pk };
    entering.add(col.id);
    const at = Math.max(0, Math.min(index, table.columns.length));
    table.columns.splice(at, 0, col);
    return col;
  }

  function addRow(tableId, index) {
    const table = tableById(tableId);
    if (!table) return;
    table.colSeq += 1;
    const at = Number.isFinite(index) ? index : table.columns.length;
    addColumn(table, at, `column ${table.colSeq}`);
    renderTables();
    drawWires();
  }

  function deleteTable(tableId) {
    for (let i = relations.length - 1; i >= 0; i -= 1) {
      if (relations[i].fromTableId === tableId || relations[i].toTableId === tableId) relations.splice(i, 1);
    }
    const idx = tables.findIndex((t) => t.id === tableId);
    if (idx >= 0) tables.splice(idx, 1);
    renderTables();
    drawWires();
  }

  function deleteColumn(tableId, colId) {
    const table = tableById(tableId);
    if (!table) return;
    table.columns = table.columns.filter((c) => c.id !== colId);
    for (let i = relations.length - 1; i >= 0; i -= 1) {
      const r = relations[i];
      if (r.fromColumnId === colId || r.toColumnId === colId) relations.splice(i, 1);
    }
    renderTables();
    drawWires();
  }

  function toggleKey(tableId, colId) {
    const table = tableById(tableId);
    if (!table) return;
    const col = columnById(table, colId);
    if (!col) return;
    col.pk = !col.pk;
    if (!col.pk) {
      for (let i = relations.length - 1; i >= 0; i -= 1) {
        if (relations[i].fromColumnId === colId) relations.splice(i, 1);
      }
    }
    renderTables();
    drawWires();
  }

  function readName(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function saveName(el) {
    const tbl = el.closest(".tbl");
    if (!tbl) return;
    const table = tableById(tbl.dataset.id);
    if (!table) return;
    const value = readName(el);
    const col = el.closest(".col");
    if (col) {
      const column = columnById(table, col.dataset.id);
      if (!column) return;
      column.name = value || column.name;
      el.textContent = column.name;
      return;
    }
    table.name = value || table.name;
    el.textContent = table.name;
  }

  function selectAll(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function bringFront(table) {
    table.z = ++zTop;
    const el = tblEl(table.id);
    if (el) el.style.zIndex = String(table.z);
  }

  function setBusy(on, cls) {
    document.body.classList.toggle("busy", on);
    if (cls) document.body.classList.toggle(cls, on);
  }

  function startMove(e, table) {
    const world = screenToWorld(e.clientX, e.clientY);
    moving = {
      table,
      dx: world.x - table.x,
      dy: world.y - table.y,
      moved: false
    };
    bringFront(table);
    setBusy(true, "moving");
    tablesRoot.setPointerCapture?.(e.pointerId);
  }

  function startLink(e, table, col) {
    const keys = pkColumns(table);
    const bundle = keys.length > 1 ? keys : [col];
    linking = {
      fromTableId: table.id,
      fromColumnIds: bundle.map((c) => c.id),
      color: peekColor(),
      x: e.clientX,
      y: e.clientY,
      drop: null
    };
    bringFront(table);
    setBusy(true, "linking");
    drawWires();
  }

  function dropForeignKey() {
    if (!linking || !linking.drop) return false;
    const fromTable = tableById(linking.fromTableId);
    const toTable = tableById(linking.drop.tableId);
    if (!fromTable || !toTable) return false;
    const ids = linking.fromColumnIds || [];
    const keys = ids.map((id) => columnById(fromTable, id)).filter(Boolean);
    if (!keys.length) return false;
    let at = linking.drop.index;
    keys.forEach((fromCol) => {
      const name = uniqueColumnName(toTable, slugJoin(fromTable.name, fromCol.name));
      const col = addColumn(toTable, at, name, false);
      at += 1;
      relations.push({
        id: uid("r"),
        color: linking.color,
        fromTableId: fromTable.id,
        fromColumnId: fromCol.id,
        toTableId: toTable.id,
        toColumnId: col.id
      });
    });
    colorSeq += 1;
    return true;
  }

  function endLink() {
    dropForeignKey();
    linking = null;
    clearHot();
    setBusy(false, "linking");
    swallowClick = true;
    renderTables();
    drawWires();
  }

  function onPointerMove(e) {
    if (moving) {
      moving.moved = true;
      const world = screenToWorld(e.clientX, e.clientY);
      moving.table.x = Math.round(world.x - moving.dx);
      moving.table.y = Math.round(world.y - moving.dy);
      const el = tblEl(moving.table.id);
      if (el) {
        el.style.left = `${moving.table.x}px`;
        el.style.top = `${moving.table.y}px`;
      }
      scheduleWires();
      return;
    }
    if (!linking) return;
    linking.x = e.clientX;
    linking.y = e.clientY;
    const drop = findDropTarget(e.clientX, e.clientY);
    clearHot();
    linking.drop = drop;
    if (drop) {
      drop.sep.classList.add("hot");
      drop.sep.style.setProperty("--hot", linking.color);
    }
    scheduleWires();
  }

  function onPointerUp(e) {
    if (moving) {
      if (moving.moved) swallowClick = true;
      moving = null;
      setBusy(false, "moving");
      return;
    }
    if (linking) {
      if (e && Number.isFinite(e.clientX)) {
        linking.x = e.clientX;
        linking.y = e.clientY;
        linking.drop = findDropTarget(e.clientX, e.clientY);
      }
      endLink();
    }
  }

  tablesRoot.addEventListener("pointerdown", (e) => {
    const tbl = e.target.closest(".tbl");
    if (!tbl) return;
    const table = tableById(tbl.dataset.id);
    if (!table) return;
    bringFront(table);

    const moveBtn = e.target.closest(".move");
    if (moveBtn) {
      e.preventDefault();
      startMove(e, table);
      return;
    }

    const headGrip = e.target.closest(".head-grip") || (
      e.target.closest(".tbl-head") && !e.target.closest(".name") && !e.target.closest("button")
    );
    if (headGrip) {
      e.preventDefault();
      startMove(e, table);
      return;
    }

    const keyBtn = e.target.closest(".key-btn");
    const pkHit = e.target.closest(".pk-hit");
    const colElNode = e.target.closest(".col");
    const col = colElNode && columnById(table, colElNode.dataset.id);
    const nearKey = colElNode && col && col.pk && !e.target.closest(".name") && !e.target.closest(".col-actions") && (
      pkHit || (e.clientX - colElNode.getBoundingClientRect().left) < 30
    );

    if (nearKey) {
      e.preventDefault();
      startLink(e, table, col);
      return;
    }

    if (keyBtn && col) {
      e.preventDefault();
      const origin = { x: e.clientX, y: e.clientY, table, col };
      const onMove = (ev) => {
        if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 4) return;
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onUp, true);
        if (!origin.col.pk) return;
        startLink(ev, origin.table, origin.col);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onUp, true);
        toggleKey(origin.table.id, origin.col.id);
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
    }
  });

  document.addEventListener("click", (e) => {
    if (!swallowClick) return;
    e.preventDefault();
    e.stopPropagation();
    swallowClick = false;
  }, true);

  tablesRoot.addEventListener("click", (e) => {
    const plus = e.target.closest(".sep-plus");
    if (plus) {
      const sep = plus.closest(".sep");
      addRow(sep.dataset.table, Number(sep.dataset.index));
      return;
    }
    const delTable = e.target.closest(".tbl-del");
    if (delTable) {
      deleteTable(delTable.closest(".tbl").dataset.id);
      return;
    }
    const delCol = e.target.closest(".del-col");
    if (delCol) {
      const tbl = delCol.closest(".tbl");
      const col = delCol.closest(".col");
      deleteColumn(tbl.dataset.id, col.dataset.id);
    }
  });

  tablesRoot.addEventListener("focusin", (e) => {
    if (!e.target.classList.contains("name")) return;
    const el = e.target;
    const pick = (ev) => {
      ev.preventDefault();
      selectAll(el);
    };
    el.addEventListener("mouseup", pick, { once: true });
    requestAnimationFrame(() => selectAll(el));
  });

  tablesRoot.addEventListener("focusout", (e) => {
    if (!e.target.classList.contains("name")) return;
    saveName(e.target);
    drawWires();
  });

  tablesRoot.addEventListener("keydown", (e) => {
    if (!e.target.classList.contains("name")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const tbl = e.target.closest(".tbl");
      const table = tableById(tbl.dataset.id);
      const col = e.target.closest(".col");
      e.target.textContent = col ? columnById(table, col.dataset.id).name : table.name;
      e.target.blur();
    }
  });

  tablesRoot.addEventListener("paste", (e) => {
    if (!e.target.classList.contains("name")) return;
    e.preventDefault();
    const text = (e.clipboardData.getData("text/plain") || "").replace(/\s+/g, " ");
    document.execCommand("insertText", false, text);
  });

  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);

  window.addEventListener("wheel", (e) => {
    if (e.target.closest(".chrome") || e.target.closest("#add-table") || e.target.closest("#note")) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08, e.clientX, e.clientY);
  }, { passive: false });

  document.getElementById("add-table").addEventListener("click", addTable);
  document.getElementById("zoom-in").addEventListener("click", () => {
    zoomBy(1.16, window.innerWidth / 2, window.innerHeight / 2, true);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    zoomBy(1 / 1.16, window.innerWidth / 2, window.innerHeight / 2, true);
  });
  document.getElementById("zoom-reset").addEventListener("click", resetView);
  document.getElementById("zoom-fit").addEventListener("click", fitView);

  document.getElementById("export-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    importMenu.hidden = true;
    exportMenu.hidden = !exportMenu.hidden;
  });

  document.getElementById("import-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    exportMenu.hidden = true;
    importMenu.hidden = !importMenu.hidden;
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".export-wrap")) exportMenu.hidden = true;
    if (!e.target.closest(".import-wrap")) importMenu.hidden = true;
  });

  exportMenu.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-export]");
    if (!btn) return;
    exportMenu.hidden = true;
    const kind = btn.dataset.export;
    if (kind === "csv") downloadCsv();
    if (kind === "png") await downloadPng();
    if (kind === "pdf") await downloadPdf();
  });

  importMenu.addEventListener("click", (e) => {
    const fileBtn = e.target.closest("[data-import]");
    if (fileBtn) {
      importMenu.hidden = true;
      importFile.click();
      return;
    }
    const exampleBtn = e.target.closest("[data-example]");
    if (!exampleBtn) return;
    importMenu.hidden = true;
    loadExample(exampleBtn.dataset.example);
  });

  importFile.addEventListener("change", async () => {
    const file = importFile.files[0];
    importFile.value = "";
    if (!file) return;
    const text = await file.text();
    if (!loadCsv(text)) showNote("This file is not a Database Central export.");
  });

  window.addEventListener("beforeunload", (e) => {
    if (isEmpty()) return;
    e.preventDefault();
    e.returnValue = "Data is local. Closing tab will lose all data. Use export to keep working.";
  });

  function csvCell(v) {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let q = false;
    const src = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (q) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cell += '"'; i += 1; }
          else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch !== "\r") cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.length && r.some((c) => c !== ""));
  }

  function download(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadCsv() {
    const lines = [["DATABASE_CENTRAL", "1"].map(csvCell).join(",")];
    tables.forEach((t) => {
      lines.push(["T", t.id, t.name, t.x, t.y].map(csvCell).join(","));
      t.columns.forEach((c) => {
        lines.push(["C", c.id, t.id, c.name, c.pk ? 1 : 0].map(csvCell).join(","));
      });
    });
    relations.forEach((r) => {
      lines.push(["R", r.id, r.fromTableId, r.fromColumnId, r.toTableId, r.toColumnId, r.color].map(csvCell).join(","));
    });
    download("database-central.csv", new Blob([lines.join("\n")], { type: "text/csv" }));
  }

  function loadCsv(text) {
    const rows = parseCsv(text);
    if (!rows.length || rows[0][0] !== "DATABASE_CENTRAL") return false;
    const nextTables = [];
    const nextRels = [];
    for (const row of rows.slice(1)) {
      const kind = row[0];
      if (kind === "T") {
        const x = Number(row[3]);
        const y = Number(row[4]);
        if (!row[1] || !Number.isFinite(x) || !Number.isFinite(y)) return false;
        nextTables.push({
          id: row[1],
          name: row[2] || "Table",
          x, y, z: ++zTop,
          colSeq: 0,
          columns: []
        });
      } else if (kind === "C") {
        const table = nextTables.find((t) => t.id === row[2]);
        if (!table || !row[1]) return false;
        table.columns.push({ id: row[1], name: row[3] || "column", pk: row[4] === "1" });
        table.colSeq += 1;
      } else if (kind === "R") {
        const color = /^#[0-9a-fA-F]{6}$/.test(row[6] || "") ? row[6] : peekColor();
        nextRels.push({
          id: row[1] || uid("r"),
          fromTableId: row[2],
          fromColumnId: row[3],
          toTableId: row[4],
          toColumnId: row[5],
          color
        });
      }
    }
    const validRels = nextRels.filter((r) => {
      const from = nextTables.find((t) => t.id === r.fromTableId);
      const to = nextTables.find((t) => t.id === r.toTableId);
      return from && to && from.columns.some((c) => c.id === r.fromColumnId) && to.columns.some((c) => c.id === r.toColumnId);
    });
    tables.splice(0, tables.length, ...nextTables);
    relations.splice(0, relations.length, ...validRels);
    const nums = tables.map((t) => {
      const m = /^Table (\d+)$/.exec(t.name);
      return m ? Number(m[1]) : 0;
    });
    tableSeq = Math.max(0, ...nums, tables.length);
    let maxId = 0;
    [...tables.map((t) => t.id), ...tables.flatMap((t) => t.columns.map((c) => c.id)), ...relations.map((r) => r.id)]
      .forEach((id) => {
        const n = parseInt(String(id).replace(/^[a-z]+/i, ""), 10);
        if (Number.isFinite(n) && n > maxId) maxId = n;
      });
    nid = maxId;
    colorSeq = relations.length;
    renderTables();
    drawWires();
    return true;
  }

  const EXAMPLES = {
    "1nf": {
      note: "1st normal form: atomic values, but names repeat and depend on only part of a composite key.",
      tables: [
        {
          name: "Enrolment",
          columns: [
            { name: "student_id", pk: true },
            { name: "module_id", pk: true },
            { name: "student_name", pk: false },
            { name: "tutor_name", pk: false },
            { name: "module_title", pk: false },
            { name: "grade", pk: false }
          ]
        },
        {
          name: "Loan",
          columns: [
            { name: "loan_id", pk: true },
            { name: "student_id", pk: false },
            { name: "student_name", pk: false },
            { name: "book_title", pk: false },
            { name: "due_date", pk: false }
          ]
        }
      ],
      relations: []
    },
    "2nf": {
      note: "2nd normal form: no partial key dependencies. Tutor name still depends on tutor_id.",
      tables: [
        {
          name: "Student",
          columns: [
            { name: "student_id", pk: true },
            { name: "student_name", pk: false },
            { name: "tutor_id", pk: false },
            { name: "tutor_name", pk: false }
          ]
        },
        {
          name: "Enrolment",
          columns: [
            { name: "student_id", pk: true },
            { name: "module_id", pk: true },
            { name: "grade", pk: false }
          ]
        }
      ],
      relations: [
        { from: 0, fromCol: "student_id", to: 1, toCol: "student_id" }
      ]
    },
    "3nf": {
      note: "3rd normal form: tutor lives in its own table, so no transitive dependency.",
      tables: [
        {
          name: "Tutor",
          columns: [
            { name: "tutor_id", pk: true },
            { name: "tutor_name", pk: false },
            { name: "office", pk: false }
          ]
        },
        {
          name: "Student",
          columns: [
            { name: "student_id", pk: true },
            { name: "student_name", pk: false },
            { name: "tutor_id", pk: false }
          ]
        },
        {
          name: "Enrolment",
          columns: [
            { name: "student_id", pk: true },
            { name: "module_id", pk: true },
            { name: "grade", pk: false }
          ]
        }
      ],
      relations: [
        { from: 0, fromCol: "tutor_id", to: 1, toCol: "tutor_id" },
        { from: 1, fromCol: "student_id", to: 2, toCol: "student_id" }
      ]
    }
  };

  function loadExample(key) {
    const spec = EXAMPLES[key];
    if (!spec) return;
    tables.splice(0, tables.length);
    relations.splice(0, relations.length);
    nid = 0;
    tableSeq = 0;
    colorSeq = 0;
    zTop = 2;
    const built = spec.tables.map((def, i) => {
      tableSeq += 1;
      const table = {
        id: uid("t"),
        name: def.name,
        x: 48 + i * 280,
        y: 96,
        z: ++zTop,
        colSeq: def.columns.length,
        columns: def.columns.map((c) => ({
          id: uid("c"),
          name: c.name,
          pk: !!c.pk
        }))
      };
      tables.push(table);
      return table;
    });
    spec.relations.forEach((r) => {
      const from = built[r.from];
      const to = built[r.to];
      const fromCol = from.columns.find((c) => c.name === r.fromCol);
      const toCol = to.columns.find((c) => c.name === r.toCol);
      if (!fromCol || !toCol) return;
      relations.push({
        id: uid("r"),
        color: peekColor(),
        fromTableId: from.id,
        fromColumnId: fromCol.id,
        toTableId: to.id,
        toColumnId: toCol.id
      });
      colorSeq += 1;
    });
    renderTables();
    drawWires();
    fitView();
    showNote(spec.note);
  }

  function contentBounds() {
    if (!tables.length) {
      return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    tables.forEach((t) => {
      const el = tblEl(t.id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right);
      maxY = Math.max(maxY, r.bottom);
    });
    const pad = 48;
    return {
      left: minX - pad,
      top: minY - pad,
      width: Math.max(320, maxX - minX + pad * 2),
      height: Math.max(240, maxY - minY + pad * 2)
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawKeyIcon(ctx, x, y, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(5.2, 7, 5, 0, Math.PI * 2);
    ctx.arc(5.2, 7, 2, 0, Math.PI * 2, true);
    ctx.rect(9, 6, 6, 2.3);
    ctx.rect(11.4, 8.3, 1.5, 2.2);
    ctx.rect(13.4, 8.3, 1.6, 1.5);
    ctx.fill("evenodd");
    ctx.restore();
  }

  function drawCanvas() {
    const bounds = contentBounds();
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(bounds.width * scale);
    canvas.height = Math.ceil(bounds.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, bounds.width, bounds.height);

    ctx.strokeStyle = "#ececec";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startX = Math.ceil(bounds.left / GRID) * GRID;
    const startY = Math.ceil(bounds.top / GRID) * GRID;
    for (let x = startX; x <= bounds.left + bounds.width; x += GRID) {
      const dx = x - bounds.left + 0.5;
      ctx.moveTo(dx, 0);
      ctx.lineTo(dx, bounds.height);
    }
    for (let y = startY; y <= bounds.top + bounds.height; y += GRID) {
      const dy = y - bounds.top + 0.5;
      ctx.moveTo(0, dy);
      ctx.lineTo(bounds.width, dy);
    }
    ctx.stroke();

    const ox = bounds.left;
    const oy = bounds.top;
    const lanes = relationLanes();

    relations.forEach((rel) => {
      const ends = relationEnds(rel);
      if (!ends) return;
      const pts = routePoints(ends.x1 - ox, ends.y1 - oy, ends.x2 - ox, ends.y2 - oy, lanes.get(rel.id) || 0);
      ctx.strokeStyle = rel.color;
      ctx.fillStyle = rel.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const path = new Path2D(roundedPath(pts));
      ctx.stroke(path);
      const [from, to] = lastSegment(simplify(pts));
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x + Math.cos(angle + Math.PI * 0.82) * 8, to.y + Math.sin(angle + Math.PI * 0.82) * 8);
      ctx.lineTo(to.x + Math.cos(angle - Math.PI * 0.82) * 8, to.y + Math.sin(angle - Math.PI * 0.82) * 8);
      ctx.closePath();
      ctx.fill();
    });

    tables.forEach((table) => {
      const el = tblEl(table.id);
      if (!el) return;
      const box = el.getBoundingClientRect();
      const x = box.left - ox;
      const y = box.top - oy;
      const w = box.width;
      const h = box.height;
      roundRect(ctx, x, y, w, h, 4);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#d4d4d4";
      ctx.lineWidth = 1;
      ctx.stroke();

      const head = el.querySelector(".tbl-head").getBoundingClientRect();
      ctx.save();
      roundRect(ctx, x, y, w, head.height, 4);
      ctx.clip();
      ctx.fillStyle = "#e9e9e9";
      ctx.fillRect(x, y, w, head.height + 4);
      ctx.restore();
      ctx.fillStyle = "#e9e9e9";
      ctx.fillRect(x, y + 4, w, head.height - 4);

      ctx.fillStyle = "#1a1a1a";
      ctx.font = "650 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(table.name, x + 10, y + head.height / 2, w - 20);

      table.columns.forEach((col) => {
        const row = colEl(table.id, col.id);
        if (!row) return;
        const r = row.getBoundingClientRect();
        const rx = r.left - ox;
        const ry = r.top - oy;
        const rel = fkOf(col.id);
        if (rel) {
          ctx.fillStyle = rel.color;
          ctx.globalAlpha = 0.14;
          ctx.fillRect(x + 1, ry, w - 2, r.height);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = "#ebebeb";
        ctx.beginPath();
        ctx.moveTo(x + 1, ry + 0.5);
        ctx.lineTo(x + w - 1, ry + 0.5);
        ctx.stroke();
        if (col.pk) drawKeyIcon(ctx, rx + 2, ry + (r.height - 14) / 2, rel ? rel.color : "#1a1a1a");
        ctx.fillStyle = rel ? rel.color : "#1a1a1a";
        ctx.font = `${col.pk || rel ? "700" : "400"} 13px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(col.name, rx + 22, ry + r.height / 2, w - 36);
      });
    });

    return canvas;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function downloadPng() {
    const canvas = drawCanvas();
    const blob = await canvasToBlob(canvas, "image/png");
    download("database-central.png", blob);
  }

  function u8(s) {
    return new TextEncoder().encode(s);
  }

  function concatBytes(chunks) {
    const len = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    chunks.forEach((c) => { out.set(c, o); o += c.length; });
    return out;
  }

  function pdfFromJpeg(jpeg, imgW, imgH) {
    const pageW = +(imgW * 72 / 96).toFixed(2);
    const pageH = +(imgH * 72 / 96).toFixed(2);
    const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q\n`;
    const objs = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n`,
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`
    ];
    const imgDict = `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`;
    const chunks = [u8("%PDF-1.4\n")];
    const offsets = [0];
    let pos = chunks[0].length;
    objs.forEach((body) => {
      offsets.push(pos);
      const bytes = u8(body);
      chunks.push(bytes);
      pos += bytes.length;
    });
    offsets.push(pos);
    chunks.push(u8(imgDict));
    pos += imgDict.length;
    chunks.push(jpeg);
    pos += jpeg.length;
    const imgTail = u8("\nendstream\nendobj\n");
    chunks.push(imgTail);
    pos += imgTail.length;
    const xrefStart = pos;
    let xref = `xref\n0 6\n0000000000 65535 f \n`;
    for (let i = 1; i <= 5; i += 1) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    chunks.push(u8(xref));
    return new Blob([concatBytes(chunks)], { type: "application/pdf" });
  }

  async function downloadPdf() {
    const canvas = drawCanvas();
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    download("database-central.pdf", pdfFromJpeg(jpeg, canvas.width, canvas.height));
  }

  applyView();
})();
