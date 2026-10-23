/* Cloud sync for the cue-card app.
   Offline-first: localStorage stays the source of truth for the UI. When a session exists and the
   network is up, changes are pushed to the cloud database and remote rows are merged back in.
   Modules used: Auth (phone / email OTP), Database (questions, interviews, entries, settings),
   Storage (JSON backups). */
(function () {
  'use strict';

  var CFG = window.CUECARD_CLOUD_CONFIG || {};
  var cloud = null, session = null, pending = null;
  var syncing = false, dirty = false, lastSyncAt = 0, lastError = '', timer = null;

  function app() { return window.CueCardApp; }
  function sdk() { return window.WorkBuddyCloud; }
  // The cloud service enforces an exact Origin match, so sync only works on the app's release domain.
  // On any other host (localhost, a mirror deploy) the app stays fully usable offline; just say so.
  function originOk() { return !!CFG.endpoint && CFG.endpoint === location.origin; }
  function usable() { return !!sdk() && !!CFG.endpoint && !!CFG.publishableKey && originOk(); }
  function msgOf(e) { return (e && (e.message || e.error_description)) || (typeof e === 'string' ? e : 'Unknown error'); }
  function fail(res, what) {
    if (res && res.error) throw new Error(msgOf(res.error));
    return res ? res.data : null;
  }
  function iso(ms) { return new Date(ms || 0).toISOString(); }
  function ts(v) { var t = Date.parse(v); return isNaN(t) ? 0 : t; }

  function init() {
    if (cloud) return cloud;
    if (!usable()) return null;
    cloud = sdk().createWorkBuddyCloud({
      endpoint: CFG.endpoint,
      oauthRelayBaseUrl: CFG.oauthRelayBaseUrl,
      publishableKey: CFG.publishableKey
    });
    return cloud;
  }

  /* ---------- session ---------- */
  async function getSession() {
    if (!init()) { session = null; return null; }
    try {
      var r = await cloud.auth.getSession();
      session = (r && !r.error && r.data) ? r.data : null;
    } catch (e) { session = null; }
    return session;
  }
  async function ensure() {
    if (!init()) { if (app()) app().toast('云功能未加载，联网后重试'); return null; }
    var s = await getSession();
    if (!s) { if (app() && app().openLogin) app().openLogin(); return null; }
    return s;
  }
  async function signOut() {
    if (!cloud) { session = null; paint(); return; }
    try { await cloud.auth.signOut(); } catch (e) {}
    session = null; pending = null; lastSyncAt = 0;
    paint();
    if (app()) app().toast('已退出登录');
  }

  /* ---------- auth: phone / email OTP ---------- */
  async function sendCode(kind, to) {
    if (!init()) return { error: '云功能未加载，联网后重试' };
    var payload = kind === 'phone' ? { phone: to } : { email: to };
    try {
      var r = await cloud.auth.sendOtp(payload);
      if (r.error) return { error: msgOf(r.error) };
      pending = { kind: kind, to: to, verificationId: r.data.verificationId, isExistingUser: r.data.isExistingUser };
      return { ok: true };
    } catch (e) { return { error: msgOf(e) }; }
  }
  async function verifyCode(to, token) {
    if (!init()) return { error: '云功能未加载，联网后重试' };
    if (!pending || pending.to !== to) {
      return { error: '请先为这个' + (pending && pending.kind === 'phone' ? '手机号' : '邮箱') + '获取验证码' };
    }
    var base = pending.kind === 'phone' ? { phone: pending.to } : { email: pending.to };
    var body = {
      verificationId: pending.verificationId,
      isExistingUser: pending.isExistingUser,
      token: String(token || '').trim()
    };
    for (var k in base) body[k] = base[k];
    try {
      var r = await cloud.auth.verifyOtp(body);
      if (r.error) return { error: msgOf(r.error) };
      pending = null;
      await getSession();
      paint();
      return { ok: true, user: session && session.user };
    } catch (e) { return { error: msgOf(e) }; }
  }
  function clearPending() { pending = null; }

  /* ---------- database: pull / merge / push ---------- */
  async function pull() {
    var db = cloud.database;
    var q = fail(await db.from('cue_questions').select('local_id,section_id,qtext,answer,updated_at'), 'questions');
    var iv = fail(await db.from('cue_interviews').select('local_id,iv_name,created_at'), 'interviews');
    var en = fail(await db.from('cue_entries').select('local_id,interview_local_id,section_id,question_local_id,plan_local_id,entry_text,asked_at'), 'entries');
    var se = fail(await db.from('cue_settings').select('payload,updated_at'), 'settings');
    var tb = fail(await db.from('cue_tombstones').select('kind,local_id,deleted_at'), 'tombstones');
    return { questions: q || [], interviews: iv || [], entries: en || [], settings: se || [], tombstones: tb || [] };
  }

  /* Deletions travel as tombstones, so a delete on one device is not resurrected by another. */
  function ensureDead(st) {
    if (!st.dead) st.dead = {};
    var kinds = ['q', 'i', 'e'], i;
    for (i = 0; i < kinds.length; i++) if (!st.dead[kinds[i]]) st.dead[kinds[i]] = {};
  }
  function applyTombstones(st, list) {
    ensureDead(st);
    var changed = false, i, n;
    for (i = 0; i < list.length; i++) {
      var t = list[i], map = st.dead[t.kind];
      if (!map) continue;
      var when = ts(t.deleted_at);
      if (!map[t.local_id] || map[t.local_id] < when) { map[t.local_id] = when; changed = true; }
    }
    n = st.questions.length;
    st.questions = st.questions.filter(function (q) { return !st.dead.q[q.id]; });
    if (st.questions.length !== n) changed = true;
    for (i = 0; i < st.interviews.length; i++) {
      var iv = st.interviews[i], m = iv.entries.length;
      iv.entries = iv.entries.filter(function (e) { return !st.dead.e[e.id]; });
      if (iv.entries.length !== m) changed = true;
    }
    n = st.interviews.length;
    st.interviews = st.interviews.filter(function (v) { return !st.dead.i[v.id]; });
    if (st.interviews.length !== n) changed = true;
    return changed;
  }

  function merge(st, remote) {
    var changed = false, i;
    ensureDead(st);

    var qById = {};
    for (i = 0; i < st.questions.length; i++) qById[st.questions[i].id] = st.questions[i];
    for (i = 0; i < remote.questions.length; i++) {
      var r = remote.questions[i], local = qById[r.local_id], rts = ts(r.updated_at);
      // Deleted here and not edited elsewhere since: stay deleted. A newer remote edit wins.
      if (st.dead.q[r.local_id] && st.dead.q[r.local_id] >= rts) continue;
      if (!local) {
        st.questions.push({ id: r.local_id, sectionId: r.section_id, text: r.qtext, answer: r.answer || '', updatedAt: rts });
        qById[r.local_id] = st.questions[st.questions.length - 1];
        delete st.dead.q[r.local_id];
        changed = true;
      } else if (rts > (local.updatedAt || 0)) {
        local.text = r.qtext; local.answer = r.answer || ''; local.updatedAt = rts;
        changed = true;
      }
    }

    var ivById = {};
    for (i = 0; i < st.interviews.length; i++) ivById[st.interviews[i].id] = st.interviews[i];
    for (i = 0; i < remote.interviews.length; i++) {
      var ri = remote.interviews[i];
      if (ivById[ri.local_id] || st.dead.i[ri.local_id]) continue;
      var made = { id: ri.local_id, name: ri.iv_name || 'Interview', createdAt: ri.created_at || Date.now(), plan: {}, entries: [] };
      st.interviews.push(made);
      ivById[ri.local_id] = made;
      changed = true;
    }

    for (i = 0; i < remote.entries.length; i++) {
      var re = remote.entries[i], iv = ivById[re.interview_local_id];
      if (!iv || st.dead.e[re.local_id]) continue;
      var seen = false;
      for (var j = 0; j < iv.entries.length; j++) if (iv.entries[j].id === re.local_id) { seen = true; break; }
      if (seen) continue;
      iv.entries.push({
        id: re.local_id,
        sectionId: re.section_id,
        planQid: re.plan_local_id || null,
        questionId: re.question_local_id || re.plan_local_id || null,
        text: re.entry_text,
        ts: re.asked_at || Date.now()
      });
      changed = true;
    }

    if (remote.settings.length) {
      var rs = remote.settings[0], rsts = ts(rs.updated_at);
      if (rsts > (st.settings.__ts || 0) && rs.payload) {
        st.settings = rs.payload;
        st.settings.__ts = rsts;
        changed = true;
      }
    }

    if (!st.currentId || !ivById[st.currentId]) {
      if (st.interviews.length) { st.currentId = st.interviews[st.interviews.length - 1].id; changed = true; }
    }
    return changed;
  }

  async function push(st) {
    var db = cloud.database, i;

    var qrows = st.questions.map(function (q) {
      return { local_id: q.id, section_id: q.sectionId, qtext: q.text, answer: q.answer || '', updated_at: iso(q.updatedAt) };
    });
    if (qrows.length) fail(await db.from('cue_questions').upsert(qrows, { onConflict: 'owner_id,local_id' }), 'questions');

    var irows = st.interviews.map(function (v) {
      return { local_id: v.id, iv_name: v.name, created_at: v.createdAt || Date.now() };
    });
    if (irows.length) fail(await db.from('cue_interviews').upsert(irows, { onConflict: 'owner_id,local_id' }), 'interviews');

    var erows = [], eids = [];
    st.interviews.forEach(function (v) {
      v.entries.forEach(function (e) {
        eids.push(e.id);
        erows.push({
          local_id: e.id,
          interview_local_id: v.id,
          section_id: e.sectionId || null,
          question_local_id: e.questionId || null,
          plan_local_id: e.planQid || null,
          entry_text: e.text || '',
          asked_at: e.ts || Date.now()
        });
      });
    });
    if (erows.length) fail(await db.from('cue_entries').upsert(erows, { onConflict: 'owner_id,local_id' }), 'entries');

    var tb = [], kinds = ['q', 'i', 'e'];
    kinds.forEach(function (k) {
      var m = st.dead && st.dead[k] ? st.dead[k] : {};
      Object.keys(m).forEach(function (id) { tb.push({ kind: k, local_id: id, deleted_at: iso(m[id]) }); });
    });
    if (tb.length) fail(await db.from('cue_tombstones').upsert(tb, { onConflict: 'owner_id,kind,local_id' }), 'tombstones');

    var payload = st.settings || {};
    fail(await db.from('cue_settings').upsert(
      [{ payload: payload, updated_at: iso(payload.__ts) }],
      { onConflict: 'owner_id' }
    ), 'settings');
  }

  async function sync(manual) {
    if (!init()) { lastError = '云功能未加载'; if (manual && app()) app().toast('云功能未加载，联网后重试'); return false; }
    var s = await getSession();
    if (!s) { if (manual && app() && app().openLogin) app().openLogin(); return false; }
    if (syncing) return false;
    syncing = true; paint();
    try {
      var st = app().getState();
      var remote = await pull();
      var changed = applyTombstones(st, remote.tombstones || []);
      if (merge(st, remote)) changed = true;
      if (changed) app().save();
      await push(st);
      lastSyncAt = Date.now(); lastError = ''; dirty = false;
      if (changed) app().render();
      if (manual) app().toast('已同步');
      return true;
    } catch (e) {
      lastError = msgOf(e);
      if (manual) app().toast('同步失败：' + lastError);
      return false;
    } finally {
      syncing = false; paint();
    }
  }

  function markDirty() {
    if (syncing) return;
    if (!dirty) { dirty = true; paint(); }
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { if (dirty) sync(false); }, 2500);
  }

  /* ---------- storage: JSON backups ---------- */
  function backupName() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'cuecard-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.json';
  }
  async function backup() {
    var s = await ensure(); if (!s) return;
    try {
      var path = cloud.storage.userPath(s.user.id, 'backups/' + backupName());
      var body = new Blob([JSON.stringify(app().getState())], { type: 'application/json' });
      var r = await cloud.storage.upload(path, body, { contentType: 'application/json', upsert: false });
      if (r && r.error) { app().toast('备份失败：' + msgOf(r.error)); return; }
      app().toast('已上传云端备份');
    } catch (e) { app().toast('备份失败：' + msgOf(e)); }
  }
  async function listBackups() {
    var s = await ensure(); if (!s) return [];
    try {
      var prefix = cloud.storage.userPath(s.user.id, 'backups');
      var r = await cloud.storage.list(prefix, { limit: 20, sortBy: { column: 'name', order: 'desc' } });
      if (r && r.error) { app().toast('读取备份失败：' + msgOf(r.error)); return []; }
      var items = (r && r.data && (r.data.items || r.data)) || [];
      return items.map(function (it) {
        var nm = String(it.name || it.key || '');
        var path = nm.indexOf('users/') === 0 ? nm : (nm.indexOf('backups/') === 0 ? cloud.storage.userPath(s.user.id, nm) : prefix + '/' + nm);
        return { name: nm.split('/').pop(), path: path, size: it.size || 0, updated: it.updated_at || it.created_at || '' };
      }).filter(function (x) { return x.name; });
    } catch (e) { app().toast('读取备份失败：' + msgOf(e)); return []; }
  }
  async function restore(path) {
    var s = await ensure(); if (!s) return;
    try {
      var r = await cloud.storage.download(path);
      if (r && r.error) { app().toast('下载失败：' + msgOf(r.error)); return; }
      var blob = r.data;
      var text = typeof blob === 'string' ? blob : await blob.text();
      var st = JSON.parse(text);
      if (!app().validState(st)) { app().toast('这个文件不是有效的备份'); return; }
      app().replaceState(st);
      app().toast('已从云端备份恢复');
      sync(false);
    } catch (e) { app().toast('恢复失败：' + msgOf(e)); }
  }

  /* ---------- status UI ---------- */
  function pillHtml() {
    if (!usable()) return '<i class="dot off"></i><span>离线</span>';
    if (!session) return '<i class="dot off"></i><span>未登录</span>';
    if (syncing) return '<i class="dot busy"></i><span>同步中</span>';
    if (lastError) return '<i class="dot err"></i><span>同步失败</span>';
    if (dirty) return '<i class="dot busy"></i><span>待同步</span>';
    return '<i class="dot ok"></i><span>已同步</span>';
  }
  function paint() {
    var el = document.getElementById('cloud-pill');
    if (el) el.innerHTML = pillHtml();
    if (app() && app().getTab && app().getTab() === 'settings') app().render();
  }

  function statusText() {
    if (!originOk()) return '此域名与云服务绑定的发布域名不一致，云同步不可用。题库和记录仍保存在本机，可用导出/导入备份。';
    if (!usable()) return '云功能未加载（当前离线且未缓存 SDK）。联网打开一次后即可使用。';
    if (!session) return '登录后，题库和采访记录会在云端保存，换设备或清缓存都不会丢。';
    if (syncing) return '正在同步…';
    if (lastError) return '上次同步失败：' + lastError;
    if (dirty) return '有改动待同步…';
    if (!lastSyncAt) return '已登录，等待首次同步…';
    return '已同步 · ' + new Date(lastSyncAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function label() {
    if (!session) return '';
    var u = session.user || {};
    var n = u.name || (u.phone ? '已登录' : (u.email ? '已登录' : '已登录'));
    return n;
  }

  async function start() {
    if (!init()) { paint(); return; }
    await getSession();
    paint();
    if (session) {
      try { await sync(false); } catch (e) {}
    }
    window.addEventListener('online', function () { if (session) sync(false); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && session && dirty) sync(false); });
    // Multi-device: pull on a timer too, so another device's changes show up without a local edit.
    setInterval(function () {
      if (session && !document.hidden && navigator.onLine !== false) sync(false);
    }, 20000);
  }

  window.CueCardCloud = {
    start: start,
    sync: function () { return sync(true); },
    markDirty: markDirty,
    signOut: signOut,
    sendCode: sendCode,
    verifyCode: verifyCode,
    clearPending: clearPending,
    backup: backup,
    listBackups: listBackups,
    restore: restore,
    hasSession: function () { return !!session; },
    isUsable: usable,
    originOk: originOk,
    statusText: statusText,
    label: label,
    pillHtml: pillHtml
  };
})();
