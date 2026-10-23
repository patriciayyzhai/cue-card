(function () {
  'use strict';

  /* ---------- constants + helpers ---------- */
  var KEY = 'cuecard.v1';
  var STAGES = [{ id: 'rapid', name: 'Rapid Fire' }, { id: 'long', name: 'Longer Q&A' }];
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var uid = function (p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var norm = function (s) { return String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[?\uFF1F.!\uFF01\s]+$/, '').trim(); };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var fmtDate = function (ts) { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

  function icon(paths, extra) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"' + (extra || '') + '>' + paths.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>';
  }
  var ICON = {
    shuffle: icon(['M16 3h5v5', 'M4 20 21 3', 'M21 16v5h-5', 'M15 15l6 6', 'M4 4l5 5']),
    edit: icon(['M12 20h9', 'M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z']),
    trash: icon(['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6']),
    plus: icon(['M12 5v14', 'M5 12h14']),
    x: icon(['M18 6 6 18', 'M6 6l12 12']),
    check: icon(['M20 6 9 17l-5-5']),
    swap: icon(['M23 4v6h-6', 'M1 20v-6h6', 'M3.5 9a9 9 0 0114.8-3.4L23 10', 'M1 14l4.7 4.4A9 9 0 0020.5 15']),
    chev: icon(['M6 9l6 6 6-6'], ' class="chev"'),
    plan: icon(['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2', 'M9 3h6v4H9z', 'M9 14l2 2 4-4']),
    record: icon(['M12 8v4l3 2', 'M21 12a9 9 0 11-18 0 9 9 0 0118 0']),
    bank: icon(['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6']),
    settings: icon(['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'])
  };

  /* ---------- state ---------- */
  var state = null;
  var storageOk = true;
  var ui = { tab: 'plan', stage: 'rapid', bankSec: 'all', bankQuery: '', openIv: {}, revealed: {}, pretext: false };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; } catch (e) { storageOk = false; }
    if (window.CueCardCloud) window.CueCardCloud.markDirty();
  }
  function loadSaved() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return validState(s) ? s : null;
    } catch (e) { return null; }
  }
  function validState(s) {
    return !!s && s.v === 1 && Array.isArray(s.sections) && Array.isArray(s.questions) && Array.isArray(s.interviews) &&
      s.settings && s.settings.roundMax && typeof s.settings.roundMax.rapid === 'number' && typeof s.settings.roundMax.long === 'number';
  }
  function buildFresh() {
    state = {
      v: 1, seq: 0,
      sections: clone(window.SEED.sections),
      questions: clone(window.SEED.questions),
      settings: { roundMax: { rapid: 6, long: 4 }, preferLeastUsed: true },
      interviews: [], currentId: null,
      dead: { q: {}, i: {}, e: {} }
    };
    newInterview();
    return state;
  }

  /* Deletion tombstones: ids removed on this device must not be resurrected by another device. */
  function ensureDead() {
    if (!state.dead) state.dead = {};
    ['q', 'i', 'e'].forEach(function (k) { if (!state.dead[k]) state.dead[k] = {}; });
  }
  function markDead(kind, id) { ensureDead(); state.dead[kind][id] = Date.now(); }
  function markDiffDead(prev) {
    ensureDead();
    if (!prev) return;
    var now = Date.now(), nq = {}, ni = {}, ne = {};
    state.questions.forEach(function (q) { nq[q.id] = 1; });
    state.interviews.forEach(function (iv) { ni[iv.id] = 1; iv.entries.forEach(function (e) { ne[e.id] = 1; }); });
    prev.questions.forEach(function (q) { if (!nq[q.id]) state.dead.q[q.id] = now; });
    (prev.interviews || []).forEach(function (iv) {
      if (!ni[iv.id]) state.dead.i[iv.id] = now;
      (iv.entries || []).forEach(function (e) { if (!ne[e.id]) state.dead.e[e.id] = now; });
    });
  }
  function adoptState(next) {
    var prev = state;
    state = next;
    ensureDead();
    markDiffDead(prev);
    save(); render();
  }

  var cur = function () {
    var iv = state.interviews.filter(function (i) { return i.id === state.currentId; })[0];
    return iv || state.interviews[state.interviews.length - 1];
  };
  var secsOf = function (stage) { return state.sections.filter(function (s) { return s.stage === stage; }); };
  var secById = function (id) { return state.sections.filter(function (s) { return s.id === id; })[0]; };
  var qById = function (id) { return state.questions.filter(function (q) { return q.id === id; })[0]; };
  var isChecked = function (iv, qid) { return iv.entries.some(function (e) { return e.planQid === qid; }); };

  function usage() {
    var m = {};
    state.interviews.forEach(function (iv) {
      iv.entries.forEach(function (e) { if (e.questionId) m[e.questionId] = (m[e.questionId] || 0) + 1; });
    });
    return m;
  }

  /* ---------- shuffle logic ---------- */
  // Split the round cap across sections one question at a time, so no section is starved.
  function allocation(stage) {
    var secs = secsOf(stage), cap = state.settings.roundMax[stage], alloc = {}, total = 0, moved = true;
    secs.forEach(function (s) { alloc[s.id] = 0; });
    while (total < cap && moved) {
      moved = false;
      for (var i = 0; i < secs.length && total < cap; i++) {
        if (alloc[secs[i].id] < secs[i].max) { alloc[secs[i].id]++; total++; moved = true; }
      }
    }
    return alloc;
  }
  // Weighted random: less-asked questions are much more likely, but never certain.
  function wpick(pool, used) {
    var w = pool.map(function (q) { return state.settings.preferLeastUsed ? 1 / Math.pow(1 + (used[q.id] || 0), 2) : 1; });
    var r = Math.random() * w.reduce(function (a, b) { return a + b; }, 0);
    for (var i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  function shuffleSection(iv, sec, n) {
    var planned = iv.plan[sec.id] || [];
    var keep = planned.filter(function (id) { return isChecked(iv, id); });
    var avoid = planned.filter(function (id) { return !isChecked(iv, id); });
    var asked = {};
    iv.entries.forEach(function (e) { asked[e.questionId] = true; });
    var used = usage();
    var pool = state.questions.filter(function (q) { return q.sectionId === sec.id && keep.indexOf(q.id) < 0 && !asked[q.id]; });
    var fresh = pool.filter(function (q) { return avoid.indexOf(q.id) < 0; });
    var rest = pool.filter(function (q) { return avoid.indexOf(q.id) >= 0; });
    var need = Math.max(0, n - keep.length), picks = [], q;
    while (need > 0 && fresh.length) { q = wpick(fresh, used); picks.push(q.id); fresh = fresh.filter(function (x) { return x.id !== q.id; }); need--; }
    while (need > 0 && rest.length) { q = wpick(rest, used); picks.push(q.id); rest = rest.filter(function (x) { return x.id !== q.id; }); need--; }
    iv.plan[sec.id] = keep.concat(picks);
  }
  function shuffleStage(iv, stage) {
    var alloc = allocation(stage);
    secsOf(stage).forEach(function (s) { shuffleSection(iv, s, alloc[s.id]); });
  }
  function newInterview() {
    state.seq = (state.seq || 0) + 1;
    var iv = { id: uid('i'), name: 'Interview ' + state.seq, createdAt: Date.now(), plan: {}, entries: [] };
    state.interviews.push(iv);
    state.currentId = iv.id;
    STAGES.forEach(function (st) { shuffleStage(iv, st.id); });
    return iv;
  }
  function swapOne(secId, qid) {
    var iv = cur(), list = iv.plan[secId] || [], idx = list.indexOf(qid);
    if (idx < 0) return false;
    var asked = {};
    iv.entries.forEach(function (e) { asked[e.questionId] = true; });
    var pool = state.questions.filter(function (q) { return q.sectionId === secId && list.indexOf(q.id) < 0 && !asked[q.id]; });
    if (!pool.length) return false;
    list[idx] = wpick(pool, usage()).id;
    return true;
  }

  /* ---------- data mutations ---------- */
  function addQuestion(sectionId, text, answer) {
    var q = { id: uid('q'), sectionId: sectionId, text: text.trim(), answer: (answer || '').trim(), updatedAt: Date.now() };
    state.questions.push(q);
    return q;
  }
  function findByText(sectionId, text) {
    return state.questions.filter(function (q) { return q.sectionId === sectionId && norm(q.text) === norm(text); })[0];
  }
  // Record a question that was actually asked. New wording is added to the bank automatically.
  function recordAsked(iv, sectionId, text, entry) {
    var clean = text.trim(), q = findByText(sectionId, clean), added = false;
    if (!q) { q = addQuestion(sectionId, clean, ''); added = true; }
    if (entry) {
      entry.text = q.text; entry.questionId = q.id;
    } else {
      var linked = (iv.plan[sectionId] || []).indexOf(q.id) >= 0 && !isChecked(iv, q.id);
      iv.entries.push({ id: uid('e'), sectionId: sectionId, planQid: linked ? q.id : null, questionId: q.id, text: q.text, ts: Date.now() });
    }
    return added;
  }
  function toggleAsked(secId, qid) {
    var iv = cur(), i = -1;
    iv.entries.forEach(function (e, k) { if (e.planQid === qid) i = k; });
    if (i >= 0) { iv.entries.splice(i, 1); return; }
    var q = qById(qid);
    if (!q) return;
    iv.entries.push({ id: uid('e'), sectionId: secId, planQid: qid, questionId: qid, text: q.text, ts: Date.now() });
  }
  function deleteQuestion(qid) {
    markDead('q', qid);
    state.questions = state.questions.filter(function (q) { return q.id !== qid; });
    state.interviews.forEach(function (iv) {
      Object.keys(iv.plan).forEach(function (sid) { iv.plan[sid] = iv.plan[sid].filter(function (id) { return id !== qid; }); });
    });
  }
  function entryOf(ivId, eId) {
    var iv = state.interviews.filter(function (i) { return i.id === ivId; })[0];
    return { iv: iv, entry: iv && iv.entries.filter(function (e) { return e.id === eId; })[0] };
  }

  /* ---------- toast + sheet ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function closeSheet() {
    $('#sheet-root').innerHTML = '';
    $('#sheet-root')._actions = null;
    document.body.classList.remove('noscroll');
  }
  function openSheet(cfg) {
    var root = $('#sheet-root');
    root.innerHTML = '<div class="scrim" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(cfg.title) + '">' +
      '<div class="grab"></div><h2>' + esc(cfg.title) + '</h2><div>' + (cfg.body || '') + '</div>' +
      '<div class="sheet-actions">' + cfg.actions.map(function (a, i) {
        return '<button class="btn ' + (a.kind || '') + '" data-sheet-action="' + i + '">' + esc(a.label) + '</button>';
      }).join('') + '</div></div>';
    root._actions = cfg.actions;
    document.body.classList.add('noscroll');
    if (cfg.onMount) cfg.onMount(root);
  }
  function confirmSheet(title, message, label, onYes, danger) {
    openSheet({
      title: title, body: '<p class="muted" style="margin:0">' + esc(message) + '</p>',
      actions: [{ label: 'Cancel' }, { label: label, kind: danger ? 'danger' : 'primary', onClick: onYes }]
    });
  }
  function sectionOptions(selected) {
    return STAGES.map(function (st) {
      return '<optgroup label="' + esc(st.name) + '">' + secsOf(st.id).map(function (s) {
        return '<option value="' + s.id + '"' + (s.id === selected ? ' selected' : '') + '>' + esc(s.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }

  // Add / edit a bank question
  function questionSheet(qid, defSec) {
    var q = qid ? qById(qid) : null;
    openSheet({
      title: q ? 'Edit question' : 'Add question',
      body: '<label for="f-text">Question</label><textarea id="f-text" class="field" placeholder="Type the question">' + esc(q ? q.text : '') + '</textarea>' +
        '<label for="f-sec">Section</label><select id="f-sec" class="field">' + sectionOptions(q ? q.sectionId : defSec) + '</select>' +
        '<label for="f-ans">Answer / notes (optional, shown on the cue card)</label><textarea id="f-ans" class="field" style="min-height:64px">' + esc(q ? q.answer : '') + '</textarea>',
      actions: [{ label: 'Cancel' }, {
        label: 'Save', kind: 'primary', onClick: function (root) {
          var text = $('#f-text', root).value.trim();
          if (!text) { toast('Type a question first'); return false; }
          var sec = $('#f-sec', root).value, ans = $('#f-ans', root).value;
          if (q) { q.text = text; q.sectionId = sec; q.answer = ans.trim(); q.updatedAt = Date.now(); toast('Question updated'); }
          else { addQuestion(sec, text, ans); toast('Added to the bank'); }
          save(); render();
        }
      }]
    });
  }

  // Edit an entry in the record, or add a question you asked off-script
  function entrySheet(ivId, eId, defSec) {
    var found = eId ? entryOf(ivId, eId) : { iv: state.interviews.filter(function (i) { return i.id === ivId; })[0] };
    var entry = found.entry, iv = found.iv;
    if (!iv) return;
    var secId = entry ? entry.sectionId : defSec;
    openSheet({
      title: entry ? 'Edit what you asked' : 'Add a question you asked',
      body: '<label for="f-text">What you actually asked</label><textarea id="f-text" class="field" placeholder="Type the question as you asked it">' + esc(entry ? entry.text : '') + '</textarea>' +
        '<div id="f-hint" class="hint"></div>' +
        (entry ? '<p class="hint">Section: ' + esc((secById(entry.sectionId) || {}).name || '') + '</p>' :
          '<label for="f-sec">Section</label><select id="f-sec" class="field">' + sectionOptions(secId) + '</select>'),
      onMount: function (root) {
        var ta = $('#f-text', root), sel = $('#f-sec', root), hint = $('#f-hint', root);
        function upd() {
          var text = ta.value.trim(), sid = sel ? sel.value : secId;
          if (!text) { hint.textContent = ''; hint.className = 'hint'; return; }
          if (entry && norm(text) === norm(entry.text)) { hint.textContent = 'No change.'; hint.className = 'hint'; return; }
          if (findByText(sid, text)) { hint.textContent = 'Matches a question already in your bank.'; hint.className = 'hint'; }
          else { hint.textContent = 'New wording. Saving also adds it to your question bank.'; hint.className = 'hint new'; }
        }
        ta.addEventListener('input', upd);
        if (sel) sel.addEventListener('change', upd);
        upd();
      },
      actions: [{ label: 'Cancel' }, {
        label: 'Save', kind: 'primary', onClick: function (root) {
          var text = $('#f-text', root).value.trim();
          if (!text) { toast('Type the question first'); return false; }
          var sid = entry ? entry.sectionId : $('#f-sec', root).value;
          var added = recordAsked(iv, sid, text, entry);
          save(); render();
          toast(added ? 'Saved and added to the bank' : 'Saved');
        }
      }]
    });
  }

  function renameSheet(ivId) {
    var iv = state.interviews.filter(function (i) { return i.id === ivId; })[0];
    if (!iv) return;
    openSheet({
      title: 'Rename interview',
      body: '<label for="f-name">Name (e.g. family or location)</label><input id="f-name" class="field" value="' + esc(iv.name) + '" maxlength="60">',
      actions: [{ label: 'Cancel' }, {
        label: 'Save', kind: 'primary', onClick: function (root) {
          var v = $('#f-name', root).value.trim();
          if (!v) return false;
          iv.name = v; save(); render();
        }
      }]
    });
  }

  /* ---------- cloud: login + restore ---------- */
  function setSheetMsg(root, text, kind) {
    var m = $('#f-msg', root);
    if (!m) return;
    m.textContent = text || '';
    m.className = 'hint' + (kind ? ' ' + kind : '');
  }
  function setSheetErr(root, text) {
    var e = $('#f-err', root);
    if (!e) return;
    e.textContent = text || '';
    e.className = 'hint' + (text ? ' err' : '');
  }
  function loginSheet() {
    if (!window.CueCardCloud) return;
    if (!window.CueCardCloud.originOk()) { toast('此域名不支持云同步，数据保存在本机'); return; }
    if (!window.CueCardCloud.isUsable()) { toast('云功能未加载，联网后重试'); return; }
    openSheet({
      title: '登录',
      body: '<div class="seg" role="group" aria-label="登录方式">' +
        '<button data-act="otp-kind" data-kind="phone" aria-pressed="true">手机验证码</button>' +
        '<button data-act="otp-kind" data-kind="email" aria-pressed="false">邮箱验证码</button></div>' +
        '<label for="f-to" id="l-to">手机号</label>' +
        '<input id="f-to" class="field" type="tel" inputmode="numeric" autocomplete="tel" placeholder="11 位手机号">' +
        '<div id="f-err" class="hint"></div>' +
        '<label for="f-code">验证码</label>' +
        '<div class="row"><input id="f-code" class="field grow" inputmode="numeric" autocomplete="one-time-code" placeholder="验证码">' +
        '<button class="btn sm" type="button" data-act="otp-send">获取验证码</button></div>' +
        '<div id="f-msg" class="hint"></div>',
      onMount: function (root) {
        root._kind = 'phone';
        root._syncKind = function () {
          var ph = root._kind === 'phone', to = $('#f-to', root), lab = $('#l-to', root);
          lab.textContent = ph ? '手机号' : '邮箱';
          to.type = ph ? 'tel' : 'email';
          to.inputMode = ph ? 'numeric' : 'email';
          to.placeholder = ph ? '11 位手机号' : 'you@example.com';
        };
        $('#f-to', root).addEventListener('input', function () { setSheetErr(root, ''); });
        root._syncKind();
      },
      actions: [{ label: '取消' }, {
        label: '登录', kind: 'primary', onClick: function (root) { doVerify(root); return false; }
      }]
    });
  }
  async function doSend(root) {
    if (!root) return;
    var kind = root._kind || 'phone', to = $('#f-to', root).value.trim();
    if (kind === 'phone') {
      if (!/^1\d{10}$/.test(to)) { setSheetErr(root, '请输入正确的 11 位手机号'); return; }
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setSheetErr(root, '请输入正确的邮箱地址'); return; }
    setSheetErr(root, '');
    setSheetMsg(root, '正在发送…');
    var r = await window.CueCardCloud.sendCode(kind, to);
    if (r && r.error) { setSheetMsg(root, r.error, 'err'); return; }
    setSheetMsg(root, '验证码已发送，请查收后填入。');
  }
  async function doVerify(root) {
    if (!root) return;
    var to = $('#f-to', root).value.trim(), code = $('#f-code', root).value.trim();
    if (!to) { setSheetMsg(root, '请先填写手机号或邮箱', 'err'); return; }
    if (!code) { setSheetMsg(root, '请输入验证码', 'err'); return; }
    setSheetMsg(root, '正在登录…');
    var r = await window.CueCardCloud.verifyCode(to, code);
    if (r && r.error) { setSheetMsg(root, r.error, 'err'); return; }
    closeSheet();
    toast('已登录，正在同步…');
    render();
    window.CueCardCloud.sync();
  }
  function cloudRestoreSheet() {
    window.CueCardCloud.listBackups().then(function (items) {
      if (!items || !items.length) { toast('云端还没有备份'); return; }
      openSheet({
        title: '恢复云端备份',
        body: '<p class="small muted" style="margin-top:0">选择一个备份恢复，会替换本设备上的全部数据。</p>' +
          items.map(function (b, i) {
            return '<label class="pick"><input type="radio" name="bk" value="' + esc(b.path) + '"' + (i === 0 ? ' checked' : '') + '>' +
              '<span>' + esc(b.name) + '<small>' + esc(b.updated ? String(b.updated).slice(0, 16).replace('T', ' ') : '') + '</small></span></label>';
          }).join(''),
        actions: [{ label: 'Cancel' }, {
          label: '恢复', kind: 'primary', onClick: function (root) {
            var sel = root.querySelector('input[name=bk]:checked');
            if (!sel) return;
            window.CueCardCloud.restore(sel.value);
          }
        }]
      });
    });
  }
  function cloudCard() {
    var c = window.CueCardCloud;
    if (!c) return '';
    var on = c.hasSession();
    return '<h2 class="sec">云同步</h2><div class="card">' +
      (on ? '<div class="small muted" style="margin-bottom:8px">' + esc(c.label()) + '</div>' : '') +
      '<p class="small muted" style="margin:0">' + esc(c.statusText()) + '</p>' +
      '<div class="actions" style="margin-top:8px">' +
      (on
        ? '<button class="btn sm primary" data-act="cloud-sync">立即同步</button>' +
          '<button class="btn sm" data-act="cloud-backup">上传云端备份</button>' +
          '<button class="btn sm" data-act="cloud-restore">恢复备份</button>' +
          '<button class="btn sm danger" data-act="cloud-logout">退出登录</button>'
        : '<button class="btn sm primary" data-act="cloud-login">登录以启用云同步</button>') +
      '</div></div>';
  }

  /* ---------- views ---------- */
  function renderTabs() {
    var tabs = [['plan', 'Plan'], ['record', 'Record'], ['bank', 'Bank'], ['settings', 'Settings']];
    $('#tabs').innerHTML = tabs.map(function (t) {
      return '<button class="tab" data-act="tab" data-tab="' + t[0] + '"' + (ui.tab === t[0] ? ' aria-current="page"' : '') + '>' + ICON[t[0]] + '<span>' + t[1] + '</span></button>';
    }).join('');
  }

  function usedBadge(n) {
    return n === 0 ? '<span class="badge good">Never asked</span>' : '<span class="badge plain">Asked ' + n + '&times; overall</span>';
  }

  function planItem(iv, sec, qid, used) {
    var q = qById(qid);
    if (!q) return '';
    var entry = iv.entries.filter(function (e) { return e.planQid === qid; })[0];
    var edited = entry && entry.questionId !== qid;
    var text = entry ? entry.text : q.text;
    var tools = entry
      ? '<button class="icon-btn sm" data-act="edit-entry" data-i="' + iv.id + '" data-e="' + entry.id + '" aria-label="Edit what I asked">' + ICON.edit + '</button>'
      : '<button class="icon-btn sm" data-act="swap" data-s="' + sec.id + '" data-q="' + qid + '" aria-label="Swap for another question">' + ICON.swap + '</button>' +
        '<button class="icon-btn sm" data-act="unplan" data-s="' + sec.id + '" data-q="' + qid + '" aria-label="Remove from this interview">' + ICON.x + '</button>';
    var ans = '';
    if (q.answer && !edited) {
      ans = ui.revealed[qid] ? '<div class="answer">' + esc(q.answer) + '</div>' : '';
    }
    return '<li class="qitem' + (entry ? ' done' : '') + '">' +
      '<button class="check" data-act="toggle" data-s="' + sec.id + '" data-q="' + qid + '" aria-pressed="' + (entry ? 'true' : 'false') + '" aria-label="Mark as asked">' + (entry ? ICON.check : '') + '</button>' +
      '<div class="qbody"><p class="qtext">' + esc(text) + '</p>' +
      '<div class="qmeta">' + usedBadge(used[edited ? entry.questionId : qid] || 0) + (edited ? '<span class="badge warn">Edited</span>' : '') + '</div>' +
      (q.answer && !edited ? '<button class="link" data-act="reveal" data-q="' + qid + '">' + (ui.revealed[qid] ? 'Hide answer' : 'Show answer') + '</button>' : '') + ans +
      '</div><div class="qtools">' + tools + '</div></li>';
  }

  function renderPlan() {
    var iv = cur(), used = usage(), secs = secsOf(ui.stage), alloc = allocation(ui.stage);
    function stageStats(stId) {
      var ids = secsOf(stId).map(function (s) { return s.id; });
      return iv.entries.filter(function (e) { return ids.indexOf(e.sectionId) >= 0; }).length;
    }
    var planned = secs.reduce(function (n, s) { return n + (iv.plan[s.id] || []).length; }, 0);
    var asked = stageStats(ui.stage);

    var seg = '<div class="seg" role="group" aria-label="Round">' + STAGES.map(function (st) {
      return '<button data-act="stage" data-stage="' + st.id + '" aria-pressed="' + (ui.stage === st.id) + '">' + st.name +
        '<small>' + stageStats(st.id) + ' asked &middot; cap ' + state.settings.roundMax[st.id] + '</small></button>';
    }).join('') + '</div>';

    var head = '<div class="ivbar"><div class="grow"><div class="name">' + esc(iv.name) + '</div>' +
      '<div class="small muted">' + planned + ' suggested &middot; ' + asked + ' asked this round</div></div>' +
      '<button class="btn sm" data-act="new-iv">New interview</button></div>';

    var pre = '<div class="card pretext"><button class="row" style="width:100%;justify-content:space-between;min-height:36px" data-act="pretext"><b>Opening question</b>' +
      (ui.pretext ? ICON.chev.replace('class="chev"', 'class="chev" style="transform:rotate(180deg)"') : ICON.chev) + '</button>' +
      (ui.pretext ? '<p>' + esc(window.SEED.pretext) + '</p>' : '') + '</div>';

    var cards = secs.map(function (s) {
      var list = iv.plan[s.id] || [];
      var items = list.map(function (id) { return planItem(iv, s, id, used); }).join('');
      var emptyMsg = alloc[s.id] === 0 ? 'Nothing suggested: this section is capped at 0 (or the round cap was used up). See Settings.' : 'No questions left in this section. Add some in the Bank tab.';
      return '<section class="card"><div class="sec-head"><div class="grow"><h3>' + esc(s.name) + '</h3><p>' + esc(s.hint) + '</p></div>' +
        '<span class="badge">' + list.length + ' / ' + alloc[s.id] + '</span>' +
        '<button class="icon-btn sm" data-act="shuffle-sec" data-s="' + s.id + '" aria-label="Shuffle ' + esc(s.name) + '">' + ICON.shuffle + '</button></div>' +
        (items ? '<ul class="qlist">' + items + '</ul>' : '<p class="empty small">' + emptyMsg + '</p>') +
        '<div style="margin-top:10px"><button class="btn ghost block sm" data-act="adlib" data-s="' + s.id + '">' + ICON.plus + ' I asked something else</button></div></section>';
    }).join('');

    var warn = storageOk ? '' : '<div class="card" style="border-color:var(--warn)"><b>Saving is blocked in this browser.</b><div class="small muted">Your changes will be lost on reload. Turn off private browsing, or use Export in Settings.</div></div>';

    return warn + head + seg + pre + cards +
      '<button class="fab" data-act="shuffle-all" aria-label="Shuffle this round">' + ICON.shuffle + 'Shuffle</button>';
  }

  function coverageHtml() {
    var used = usage();
    return STAGES.map(function (st) {
      return '<h2 class="sec">Coverage &middot; ' + st.name + '</h2><div class="card">' + secsOf(st.id).map(function (s) {
        var qs = state.questions.filter(function (q) { return q.sectionId === s.id; });
        var counts = qs.map(function (q) { return used[q.id] || 0; });
        var covered = counts.filter(function (c) { return c > 0; }).length;
        var total = counts.reduce(function (a, b) { return a + b; }, 0);
        var mx = counts.length ? Math.max.apply(null, counts) : 0;
        var skewed = total >= 4 && mx / total > 0.5;
        var pct = qs.length ? Math.round(covered / qs.length * 100) : 0;
        var top = skewed ? qs.filter(function (q) { return (used[q.id] || 0) === mx; })[0] : null;
        return '<div class="cov"><div class="cov-top"><b>' + esc(s.name) + '</b><span class="muted">' + covered + ' of ' + qs.length + ' used &middot; ' + total + ' asked</span></div>' +
          '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
          (skewed ? '<div class="small" style="margin-top:6px"><span class="badge warn">Skewed</span> "' + esc(top.text) + '" is ' + Math.round(mx / total * 100) + '% of this section.</div>' : '') + '</div>';
      }).join('') + '</div>';
    }).join('');
  }

  function renderRecord() {
    var ivs = state.interviews.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var list = ivs.map(function (iv) {
      var isCur = iv.id === state.currentId;
      var open = ui.openIv[iv.id] === undefined ? isCur : ui.openIv[iv.id];
      var body = '';
      if (open) {
        var groups = state.sections.map(function (s) {
          var es = iv.entries.filter(function (e) { return e.sectionId === s.id; });
          if (!es.length) return '';
          var stName = STAGES.filter(function (st) { return st.id === s.stage; })[0].name;
          return '<div class="sec-label">' + esc(stName) + ' &middot; ' + esc(s.name) + '</div>' + es.map(function (e) {
            var edited = e.planQid && e.questionId !== e.planQid;
            return '<div class="entry"><div class="grow"><p class="t">' + esc(e.text) + '</p><div class="qmeta">' +
              (!e.planQid ? '<span class="badge warn">Added by me</span>' : '') + (edited ? '<span class="badge warn">Edited</span>' : '') + '</div></div>' +
              '<button class="icon-btn sm" data-act="edit-entry" data-i="' + iv.id + '" data-e="' + e.id + '" aria-label="Edit">' + ICON.edit + '</button>' +
              '<button class="icon-btn sm" data-act="del-entry" data-i="' + iv.id + '" data-e="' + e.id + '" aria-label="Delete entry">' + ICON.trash + '</button></div>';
          }).join('');
        }).join('');
        body = (groups || '<p class="empty small">Nothing recorded yet. Tick questions on the Plan tab as you ask them.</p>') +
          '<div class="actions"><button class="btn sm" data-act="add-entry" data-i="' + iv.id + '">' + ICON.plus + ' Add entry</button>' +
          '<button class="btn sm" data-act="rename-iv" data-i="' + iv.id + '">Rename</button>' +
          (isCur ? '' : '<button class="btn sm" data-act="resume-iv" data-i="' + iv.id + '">Resume</button>') +
          '<button class="btn sm danger" data-act="del-iv" data-i="' + iv.id + '">Delete</button></div>';
      }
      return '<div class="card"><button class="iv-head" data-act="toggle-iv" data-i="' + iv.id + '" aria-expanded="' + open + '"><div class="grow"><b>' + esc(iv.name) + '</b>' +
        '<div class="small muted">' + fmtDate(iv.createdAt) + ' &middot; ' + iv.entries.length + ' asked</div></div>' +
        (isCur ? '<span class="badge good">Current</span>' : '') + ICON.chev + '</button>' + body + '</div>';
    }).join('');
    return coverageHtml() + '<h2 class="sec">Interviews</h2>' + list;
  }

  function renderBank() {
    var opts = '<option value="all">All sections</option>' + STAGES.map(function (st) {
      return '<optgroup label="' + esc(st.name) + '">' + secsOf(st.id).map(function (s) {
        return '<option value="' + s.id + '"' + (ui.bankSec === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    return '<div class="filters"><input id="bank-q" class="field" type="search" placeholder="Search questions" value="' + esc(ui.bankQuery) + '" autocomplete="off">' +
      '<div class="row"><select id="bank-sec" class="field grow">' + opts + '</select>' +
      '<button class="btn primary" data-act="bank-add">' + ICON.plus + ' Add</button></div></div><div id="bank-list"></div>';
  }
  function renderBankList() {
    var used = usage(), q = norm(ui.bankQuery), html = '';
    STAGES.forEach(function (st) {
      secsOf(st.id).forEach(function (s) {
        if (ui.bankSec !== 'all' && ui.bankSec !== s.id) return;
        var qs = state.questions.filter(function (x) {
          return x.sectionId === s.id && (!q || norm(x.text).indexOf(q) >= 0 || norm(x.answer || '').indexOf(q) >= 0);
        });
        if (!qs.length && (q || ui.bankSec === 'all')) return;
        html += '<h2 class="sec">' + esc(st.name) + ' &middot; ' + esc(s.name) + ' (' + qs.length + ')</h2><div class="card">' +
          (qs.length ? qs.map(function (x) {
            return '<div class="bitem"><div class="grow"><p class="t">' + esc(x.text) + '</p>' + (x.answer ? '<p class="a">' + esc(x.answer) + '</p>' : '') +
              '<div class="qmeta"><span class="badge plain">Asked ' + (used[x.id] || 0) + '&times;</span></div></div>' +
              '<button class="icon-btn sm" data-act="bank-edit" data-q="' + x.id + '" aria-label="Edit">' + ICON.edit + '</button>' +
              '<button class="icon-btn sm" data-act="bank-del" data-q="' + x.id + '" aria-label="Delete">' + ICON.trash + '</button></div>';
          }).join('') : '<p class="empty small">No questions here yet.</p>') + '</div>';
      });
    });
    $('#bank-list').innerHTML = html || '<p class="empty">No questions match.</p>';
  }

  function stepper(kind, id, val) {
    return '<span class="stepper"><button data-act="step" data-kind="' + kind + '" data-id="' + id + '" data-d="-1" aria-label="Decrease">&minus;</button><b>' + val +
      '</b><button data-act="step" data-kind="' + kind + '" data-id="' + id + '" data-d="1" aria-label="Increase">+</button></span>';
  }
  function renderSettings() {
    var stagesHtml = STAGES.map(function (st) {
      var secs = secsOf(st.id), sum = secs.reduce(function (n, s) { return n + s.max; }, 0), cap = state.settings.roundMax[st.id];
      return '<h2 class="sec">' + st.name + '</h2><div class="card">' +
        '<div class="setrow"><div class="grow"><b>Max questions this round</b><div class="small muted">Sections add up to ' + sum + '. Shuffle suggests up to ' + Math.min(sum, cap) + '.</div></div>' + stepper('round', st.id, cap) + '</div>' +
        secs.map(function (s) {
          return '<div class="setrow"><div class="grow">' + esc(s.name) + '<div class="small muted">Max in this section</div></div>' + stepper('sec', s.id, s.max) + '</div>';
        }).join('') + '</div>';
    }).join('');
    return stagesHtml + '<h2 class="sec">Shuffle behaviour</h2><div class="card"><div class="setrow"><div class="grow"><b>Favour questions I\'ve asked least</b>' +
      '<div class="small muted">Keeps variety up across interviews. Questions already ticked this interview are never replaced.</div></div>' +
      '<button class="switch" role="switch" data-act="pref" aria-checked="' + state.settings.preferLeastUsed + '" aria-label="Favour least-asked questions"></button></div></div>' +
      cloudCard() +
      '<h2 class="sec">Data</h2><div class="card"><p class="small muted" style="margin-top:0">Questions and records are saved in this browser, and synced to the cloud when you are signed in. Export writes a local file you can keep or move to another device.</p>' +
      '<div class="actions" style="margin-top:0"><button class="btn sm" data-act="export">Export backup</button><button class="btn sm" data-act="import">Import backup</button>' +
      '<button class="btn sm danger" data-act="clear-records">Clear records</button><button class="btn sm danger" data-act="reset">Reset everything</button></div></div>';
  }

  function render() {
    var y = window.scrollY;
    renderTabs();
    $('#view').innerHTML = { plan: renderPlan, record: renderRecord, bank: renderBank, settings: renderSettings }[ui.tab]();
    if (ui.tab === 'bank') renderBankList();
    window.scrollTo(0, y);
  }

  /* ---------- events ---------- */
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  document.addEventListener('click', function (ev) {
    var sa = ev.target.closest('[data-sheet-action]');
    if (sa) {
      var root = $('#sheet-root'), a = root._actions && root._actions[+sa.dataset.sheetAction];
      if (a) { var keep = a.onClick ? a.onClick(root) : undefined; if (keep !== false) closeSheet(); }
      return;
    }
    var t = ev.target.closest('[data-act]');
    if (!t) return;
    var d = t.dataset, iv;
    switch (d.act) {
      case 'sheet-close': closeSheet(); break;
      case 'tab': $('#toast').hidden = true; ui.tab = d.tab; window.scrollTo(0, 0); render(); window.scrollTo(0, 0); break;
      case 'stage': ui.stage = d.stage; render(); break;
      case 'pretext': ui.pretext = !ui.pretext; render(); break;
      case 'reveal': ui.revealed[d.q] = !ui.revealed[d.q]; render(); break;
      case 'toggle': toggleAsked(d.s, d.q); save(); render(); break;
      case 'unplan':
        iv = cur(); iv.plan[d.s] = (iv.plan[d.s] || []).filter(function (id) { return id !== d.q; }); save(); render(); break;
      case 'swap':
        if (swapOne(d.s, d.q)) { save(); render(); } else toast('No other questions left in this section'); break;
      case 'shuffle-sec': {
        var sec = secById(d.s), n = allocation(sec.stage)[sec.id];
        shuffleSection(cur(), sec, n); save(); render(); toast('Shuffled ' + sec.name); break;
      }
      case 'shuffle-all':
        shuffleStage(cur(), ui.stage); save(); render(); toast('Shuffled. Ticked questions stayed put.'); break;
      case 'new-iv':
        confirmSheet('Start a new interview?', 'The current one stays in the Record tab. You will get a fresh set of suggestions.', 'Start new', function () {
          newInterview(); save(); ui.stage = 'rapid'; render(); window.scrollTo(0, 0); toast('Started ' + cur().name);
        }); break;
      case 'adlib': entrySheet(state.currentId, null, d.s); break;
      case 'edit-entry': entrySheet(d.i, d.e); break;
      case 'add-entry': entrySheet(d.i, null, secsOf(ui.stage)[0].id); break;
      case 'del-entry': {
        var f = entryOf(d.i, d.e);
        confirmSheet('Delete this entry?', '"' + f.entry.text + '" will be removed from this interview record. The question stays in your bank.', 'Delete', function () {
          markDead('e', d.e);
          f.iv.entries = f.iv.entries.filter(function (e) { return e.id !== d.e; }); save(); render();
        }, true); break;
      }
      case 'toggle-iv': {
        var o = ui.openIv[d.i] === undefined ? d.i === state.currentId : ui.openIv[d.i];
        ui.openIv[d.i] = !o; render(); break;
      }
      case 'rename-iv': renameSheet(d.i); break;
      case 'resume-iv': state.currentId = d.i; save(); ui.tab = 'plan'; render(); window.scrollTo(0, 0); toast('Resumed'); break;
      case 'del-iv': {
        var target = state.interviews.filter(function (i) { return i.id === d.i; })[0];
        confirmSheet('Delete ' + target.name + '?', 'Its record (' + target.entries.length + ' asked) is removed and no longer counts toward variety. Questions stay in the bank.', 'Delete', function () {
          markDead('i', d.i);
          (target.entries || []).forEach(function (e) { markDead('e', e.id); });
          state.interviews = state.interviews.filter(function (i) { return i.id !== d.i; });
          if (!state.interviews.length) newInterview();
          else if (state.currentId === d.i) state.currentId = state.interviews[state.interviews.length - 1].id;
          save(); render();
        }, true); break;
      }
      case 'bank-add': questionSheet(null, ui.bankSec !== 'all' ? ui.bankSec : secsOf('rapid')[0].id); break;
      case 'bank-edit': questionSheet(d.q); break;
      case 'bank-del': {
        var q = qById(d.q);
        confirmSheet('Delete this question?', '"' + q.text + '" leaves the bank and any current suggestions. Past records keep their wording.', 'Delete', function () {
          deleteQuestion(d.q); save(); render();
        }, true); break;
      }
      case 'step': {
        var delta = +d.d;
        if (d.kind === 'round') state.settings.roundMax[d.id] = clamp(state.settings.roundMax[d.id] + delta, 1, 30);
        else { var s = secById(d.id); s.max = clamp(s.max + delta, 0, 15); }
        state.settings.__ts = Date.now();
        save(); render(); break;
      }
      case 'pref':
        state.settings.preferLeastUsed = !state.settings.preferLeastUsed;
        state.settings.__ts = Date.now();
        save(); render(); break;
      case 'export': {
        var stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        download('cue-card-backup-' + stamp + '.json', JSON.stringify(state, null, 2)); toast('Backup downloaded'); break;
      }
      case 'import': $('#import-file').click(); break;
      case 'cloud-login': loginSheet(); break;
      case 'cloud-sync': window.CueCardCloud.sync(); break;
      case 'cloud-backup': window.CueCardCloud.backup(); break;
      case 'cloud-restore': cloudRestoreSheet(); break;
      case 'cloud-logout':
        confirmSheet('退出登录？', '本设备上的数据会保留，只是不再同步到云端。', '退出登录', function () {
          window.CueCardCloud.signOut(); render();
        }, true); break;
      case 'otp-kind': {
        var sheet = $('#sheet-root');
        if (sheet) {
          sheet._kind = d.kind;
          var btns = sheet.querySelectorAll('[data-act=otp-kind]');
          for (var bi = 0; bi < btns.length; bi++) btns[bi].setAttribute('aria-pressed', btns[bi].dataset.kind === d.kind);
          if (sheet._syncKind) sheet._syncKind();
          setSheetErr(sheet, '');
        }
        break;
      }
      case 'otp-send': doSend($('#sheet-root')); break;
      case 'clear-records':
        confirmSheet('Clear all interview records?', 'Removes every interview and resets the variety counts. Your question bank and settings stay.', 'Clear records', function () {
          state.interviews.forEach(function (v) { markDead('i', v.id); v.entries.forEach(function (e) { markDead('e', e.id); }); });
          state.interviews = []; state.currentId = null; state.seq = 0; newInterview(); save(); render(); toast('Records cleared');
        }, true); break;
      case 'reset':
        confirmSheet('Reset everything?', 'Restores the original questions from your document, removes all records and any questions you added. This cannot be undone.', 'Reset', function () {
          var prev = state;
          buildFresh();
          markDiffDead(prev);
          save(); ui.stage = 'rapid'; render(); toast('Reset to the original set');
        }, true); break;
    }
  });

  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'bank-sec') { ui.bankSec = ev.target.value; renderBankList(); }
    if (ev.target.id === 'import-file') {
      var file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var s = JSON.parse(rd.result);
          if (!validState(s)) throw new Error('bad');
          confirmSheet('Replace current data?', 'This backup holds ' + s.questions.length + ' questions and ' + s.interviews.length + ' interviews. It replaces what is on this device.', 'Import', function () {
            adoptState(s);
            if (!state.interviews.length) newInterview();
            save(); render(); toast('Backup imported');
          });
        } catch (e) { toast('That file is not a valid backup'); }
      };
      rd.readAsText(file);
    }
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'bank-q') { ui.bankQuery = ev.target.value; renderBankList(); }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeSheet(); });

  /* ---------- boot ---------- */
  window.CueCardApp = {
    render: render,
    save: save,
    toast: toast,
    validState: validState,
    getState: function () { return state; },
    replaceState: function (s) { adoptState(s); },
    getTab: function () { return ui.tab; },
    openLogin: loginSheet
  };

  state = loadSaved() || buildFresh();
  ensureDead();
  save();
  render();

  if (window.CueCardCloud) window.CueCardCloud.start();

  var bf = document.getElementById('bootfail');
  if (bf) bf.remove();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
