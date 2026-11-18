/* ライブボード（先生と生徒が同じボードに同時に書く）の同期部分。先生の board.html と生徒の live/index.html で共通。
   しくみ: 各オブジェクトに oid（ID）を付け、変わった分だけ（追加・変更・削除）を Supabase Realtime の Broadcast で送り合う。
   先生が持っているボードが「正」。生徒がつながる（hello）と、先生が今のページ全体（state）を送る。
   送るのは今開いているページだけ。ページを替えると、新しいページ全体をあらためて送る。 */
function LiveSync(o) {
  const canvas = o.canvas, role = o.role, teacher = role === 'teacher';
  const EXTRA = ['oid', 'base', 'fid', 'furi'];
  const OK_TYPES = ['i-text', 'textbox', 'text', 'rect', 'ellipse', 'circle', 'path', 'image', 'line', 'triangle', 'polygon', 'polyline'];
  const MODKEYS = ['left', 'top', 'scaleX', 'scaleY', 'angle', 'flipX', 'flipY', 'skewX', 'skewY', 'fill', 'stroke', 'strokeWidth', 'opacity', 'text', 'fontSize', 'rx', 'ry', 'width', 'height', 'styles', 'fontWeight', 'fontFamily', 'globalCompositeOperation'];
  const rid = () => Math.random().toString(36).slice(2, 10);
  const known = new Map();            // oid → 最後に送った（受け取った）姿の文字列
  let rt = null, connected = false, active = false, busy = false, timer = null, page = 0, sid = '', live = teacher, lastPing = 0, pending = {};
  const status = (t, k) => o.onStatus && o.onStatus(t, k);
  const isImg = x => x.type === 'image';
  const inSel = x => x.group && x.group.type === 'activeSelection';
  const byId = id => canvas.getObjects().find(x => x.oid === id);

  // ---- 直列化 ----
  function lite(x) {   // 位置・色・文字など小さい部分だけ（path と画像の中身は含めない）
    const j = x.toObject(EXTRA); delete j.path; delete j.src; delete j.version;
    if (isImg(x)) { j.dw = x.getScaledWidth(); j.dh = x.getScaledHeight(); delete j.width; delete j.height; delete j.scaleX; delete j.scaleY; delete j.cropX; delete j.cropY; delete j.filters; }
    return j;
  }
  function shrinkSrc(x, src) {   // 大きい画像は、送るときだけ縮める（Broadcast の1通は 256KB まで）
    if (src.length < 150000) return { src };
    const el = x._element, w0 = el.naturalWidth || el.width, h0 = el.naturalHeight || el.height;
    for (const [m, q] of [[900, .7], [700, .6], [520, .5], [380, .45]]) {
      const k = Math.min(1, m / Math.max(w0, h0)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
      c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
      const s = c.toDataURL('image/jpeg', q);
      if (s.length < 190000) return { src: s, w: c.width, h: c.height };
    }
    return null;
  }
  function full(x) {
    const j = x.toObject(EXTRA); delete j.version;
    if (isImg(x)) {
      j.dw = x.getScaledWidth(); j.dh = x.getScaledHeight();
      const s = shrinkSrc(x, j.src || '');
      if (!s) return null;
      j.src = s.src; if (s.w) { j.width = s.w; j.height = s.h; }
      j.scaleX = j.dw / j.width; j.scaleY = j.dh / j.height; delete j.cropX; delete j.cropY; delete j.filters;
    }
    return j;
  }
  const key = x => JSON.stringify(lite(x));

  // ---- 受け取って反映 ----
  function enliven(list, done) {
    list = list.filter(j => j && OK_TYPES.includes(j.type) && j.oid && !(j.type === 'image' && !/^data:image\//.test(j.src || '')));
    if (!list.length) return done && done();
    fabric.util.enlivenObjects(list, objs => {
      objs.forEach((ob, i) => {
        const j = list[i];
        if (byId(j.oid)) return;
        ob.oid = j.oid; if (j.base) ob.base = true; if (j.fid) ob.fid = j.fid; if (j.furi) ob.furi = j.furi;
        if (isImg(ob) && j.dw && ob.width) { ob.scaleX = j.dw / ob.width; ob.scaleY = j.dh / ob.height; }
        if ((ob.type === 'i-text' || ob.type === 'textbox') && !ob.styles) ob.styles = {};
        canvas.add(ob);
        known.set(ob.oid, key(ob));
        if (pending[ob.oid]) { const pj = pending[ob.oid]; delete pending[ob.oid]; applyMod(pj); }
      });
      canvas.requestRenderAll();
      done && done();
    });
  }
  function applyMod(j) {
    const ob = byId(j.oid);
    if (!ob) { pending[j.oid] = j; return; }   // 画像など、まだ届いていない物への変更は、届いてから反映
    if (ob.isEditing || inSel(ob)) return;
    const set = {};
    MODKEYS.forEach(k => { if (k in j && !(isImg(ob) && /^(width|height|scaleX|scaleY)$/.test(k))) set[k] = j[k]; });
    if (isImg(ob) && j.dw && ob.width) { set.scaleX = j.dw / ob.width; set.scaleY = j.dh / ob.height; }
    if (ob.type === 'path') { delete set.width; delete set.height; }
    ob.set(set); ob.setCoords();
    if (ob.initDimensions && /text/.test(ob.type)) ob.initDimensions();
    known.set(ob.oid, key(ob));
  }
  function applyOps(m) {
    if (teacher) page = o.getPage();
    if (m.p !== page) return;
    busy = true;
    try {
      (m.del || []).forEach(id => { const ob = byId(id); if (ob) { if (canvas.getActiveObject() === ob) canvas.discardActiveObject(); canvas.remove(ob); } known.delete(id); });
      (m.mod || []).forEach(applyMod);
    } finally { busy = false; }
    enliven(m.add || [], () => { canvas.requestRenderAll(); o.onRemote && o.onRemote(); });
    if ((m.del || []).length || (m.mod || []).length) { canvas.requestRenderAll(); o.onRemote && o.onRemote(); }
  }

  // ---- 送る ----
  const send = (ev, p) => { if (!rt || !connected || !active) return false; return rt.send(ev, p); };
  function batches(list) {
    const out = []; let cur = [], n = 0;
    list.forEach(j => { const s = JSON.stringify(j).length; if (cur.length && n + s > 150000) { out.push(cur); cur = []; n = 0; } cur.push(j); n += s; });
    if (cur.length) out.push(cur);
    return out;
  }
  function flush() {
    timer = null;
    if (teacher) page = o.getPage();
    if (!active || !live || busy || (o.isBusy && o.isBusy())) { if (active && live) touch(); return; }
    const objs = canvas.getObjects(), seen = new Set(), add = [], mod = [], del = [];
    objs.forEach(x => {
      if (!x.oid) x.oid = rid();
      seen.add(x.oid);
      if (inSel(x)) return;   // 複数選択の最中は、選択をはずしたときに送る
      const k = key(x);
      if (!known.has(x.oid)) { const f = full(x); if (f) add.push(f); known.set(x.oid, k); }
      else if (known.get(x.oid) !== k) { mod.push(lite(x)); known.set(x.oid, k); }
    });
    [...known.keys()].forEach(id => { if (!seen.has(id)) { del.push(id); known.delete(id); } });
    if (!add.length && !mod.length && !del.length) return;
    if (del.length) send('ops', { p: page, del });
    for (const b of batches(mod)) send('ops', { p: page, mod: b });
    for (const b of batches(add)) send('ops', { p: page, add: b });
  }
  function touch() { if (active && !timer) timer = setTimeout(flush, 70); }

  // 先生: 今のページ全体を送る（生徒がつながったとき・ページを替えたとき）
  function sendState() {
    if (!teacher || !active || !connected) return;
    canvas.discardActiveObject();
    page = o.getPage();
    sid = rid();
    clearTimeout(timer); timer = null;
    const list = []; known.clear();
    canvas.getObjects().forEach(x => { if (!x.oid) x.oid = rid(); const f = full(x); if (f) { list.push(f); known.set(x.oid, key(x)); } });
    send('st-begin', { sid, p: page, n: o.getCount() });
    batches(list).forEach(b => send('st-objs', { sid, objs: b }));
    send('st-end', { sid });
  }

  // ---- 受信の振り分け ----
  function onMsg(ev, m) {
    if (!m) return;
    if (teacher) {
      if (ev === 'hello') { lastPing = Date.now(); o.onPeer && o.onPeer(true); sendState(); }
      else if (ev === 'here') { lastPing = Date.now(); o.onPeer && o.onPeer(true); }   // 生徒さんが状態を受け取った合図
      else if (ev === 'ping') { if (!lastPing) sendState(); lastPing = Date.now(); o.onPeer && o.onPeer(true); }
      else if (ev === 'ops') applyOps(m);
      else if (ev === 'laser') remoteLaser(m);
    } else {
      if (ev === 'st-begin') {
        live = false; busy = true; sid = m.sid; page = m.p; known.clear();
        canvas.getObjects().slice().forEach(x => canvas.remove(x)); canvas.discardActiveObject();
        o.onPage && o.onPage(m.p, m.n);
      } else if (ev === 'st-objs') { if (m.sid === sid) enliven(m.objs || [], () => canvas.requestRenderAll()); }
      else if (ev === 'st-end') { if (m.sid === sid) setTimeout(() => { busy = false; live = true; lastPing = Date.now(); canvas.requestRenderAll(); status('live', 'ok'); send('here', {}); o.onRemote && o.onRemote(); }, 150); }
      else if (ev === 'tping') { lastPing = Date.now(); if (!live) hello(); }
      else if (ev === 'ops') applyOps(m);
      else if (ev === 'laser') remoteLaser(m);
      else if (ev === 'bye') { live = false; status('closed', 'wait'); }
    }
  }
  const hello = () => send('hello', { t: Date.now() });

  // ---- レーザー（相手のポインターが赤い点で見える） ----
  const lz = document.createElement('canvas');
  lz.style.cssText = 'position:absolute;pointer-events:none;z-index:3';
  let rtrail = [], lzRun = false, lastLz = 0;
  function placeLaser() {
    if (!o.stage) return;
    const r = canvas.upperCanvasEl.getBoundingClientRect(), sr = o.stage.getBoundingClientRect();
    lz.style.left = (r.left - sr.left) + 'px'; lz.style.top = (r.top - sr.top) + 'px';
    if (lz.width !== Math.round(r.width) || lz.height !== Math.round(r.height)) { lz.width = r.width; lz.height = r.height; }
    lz.style.width = r.width + 'px'; lz.style.height = r.height + 'px';
  }
  function drawLaser() {
    const c = lz.getContext('2d'), now = performance.now(), z = canvas.getZoom();
    rtrail = rtrail.filter(p => now - p.t < 450);
    c.clearRect(0, 0, lz.width, lz.height);
    for (let i = 1; i < rtrail.length; i++) {
      const a = 1 - (now - rtrail[i].t) / 450;
      c.strokeStyle = `rgba(255,40,60,${a * .6})`; c.lineWidth = 10 * a + 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(rtrail[i - 1].x * z, rtrail[i - 1].y * z); c.lineTo(rtrail[i].x * z, rtrail[i].y * z); c.stroke();
    }
    const l = rtrail[rtrail.length - 1];
    if (l && now - l.t < 250) { c.fillStyle = 'rgba(255,40,60,.95)'; c.shadowColor = 'rgba(255,40,60,.9)'; c.shadowBlur = 16; c.beginPath(); c.arc(l.x * z, l.y * z, 9, 0, 7); c.fill(); c.shadowBlur = 0; }
    if (rtrail.length) requestAnimationFrame(drawLaser); else lzRun = false;
  }
  function remoteLaser(m) {
    if (m.p !== page || typeof m.x !== 'number') return;
    if (!lz.parentNode && o.stage) o.stage.appendChild(lz);
    placeLaser(); rtrail.push({ x: m.x, y: m.y, t: performance.now() });
    if (!lzRun) { lzRun = true; requestAnimationFrame(drawLaser); }
  }
  // 自分のポインターを相手に見せる（座標はボードの 1600×900 のもの）。draw=true なら自分の画面にも描く（生徒側）
  function laser(x, y, draw) {
    if (draw) { if (!lz.parentNode && o.stage) o.stage.appendChild(lz); placeLaser(); rtrail.push({ x, y, t: performance.now() }); if (!lzRun) { lzRun = true; requestAnimationFrame(drawLaser); } }
    const n = performance.now();
    if (n - lastLz > 40 && live) { lastLz = n; send('laser', { p: page, x: Math.round(x), y: Math.round(y) }); }
  }

  // ---- つなぐ・切る ----
  let pingT = null;
  function start() {
    if (active) return; active = true;
    status('connecting', 'wait');
    rt = RT(o.url, o.key, o.chan, onMsg, ok => {
      connected = ok;
      if (!ok) { status(active ? 'offline' : 'closed', 'wait'); if (!teacher) live = false; return; }
      if (teacher) { status('on', 'ok'); sendState(); } else { status('waiting', 'wait'); hello(); }
    });
    pingT = setInterval(() => {
      if (teacher) {
        send('tping', { t: Date.now() });
        if (lastPing && Date.now() - lastPing > 40000) { lastPing = 0; o.onPeer && o.onPeer(false); }
      } else {
        send(live ? 'ping' : 'hello', { t: Date.now() });
        if (live && Date.now() - lastPing > 45000) { live = false; status('waiting', 'wait'); }
      }
    }, 12000);
    // 生徒: 先生の状態を受け取るまで 4 秒ごとに hello を送り直す
    if (!teacher) setInterval(() => { if (connected && !live && active) hello(); }, 4000);
  }
  function stop() {
    if (!active) return;
    if (teacher) send('bye', {});
    active = false; clearInterval(pingT); clearTimeout(timer);
    try { rt && rt.close(); } catch (e) {}
    rt = null; connected = false; lastPing = 0; status('off', 'off'); o.onPeer && o.onPeer(false);
  }
  window.addEventListener('beforeunload', () => { if (teacher && active) { try { rt.send('bye', {}); } catch (e) {} } });
  ['object:added', 'object:modified', 'object:removed', 'text:changed', 'selection:cleared', 'path:created'].forEach(ev => canvas.on(ev, touch));
  canvas.on('selection:updated', touch);
  window.addEventListener('resize', placeLaser);

  return { start, stop, touch, sendState, laser, placeLaser, get active() { return active; }, get connected() { return connected; }, get live() { return live; }, get page() { return page; }, set page(v) { page = v; } };
}
