// ──────────────────────────────────────────
//  StudyPath — app.js
// ──────────────────────────────────────────

// ── Storage ──────────────────────────────
const STORAGE_KEY = 'studypath_v1';

function loadData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultData();
  } catch { return defaultData(); }
}
function saveData(d) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}
function defaultData() {
  return { subjects: [], logs: [], settings: { geminiApiKey: '', groqApiKey: '', workerUrl: '', busyDays: [] } };
}

// ── State ─────────────────────────────────
const state = {
  view: 'home',
  detailSubjectId: null,
  logSubjectId: null,
  logUnitId: null,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  data: loadData(),
};

// ── Utils ─────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function today() {
  return new Date().toISOString().split('T')[0];
}
function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
}
function daysLeft(deadline) {
  const diff = new Date(deadline + 'T00:00:00') - new Date(today() + 'T00:00:00');
  return Math.max(0, Math.ceil(diff / 86400000));
}
function minutesToHM(min) {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}時間${m}分` : `${h}時間`;
}
function totalLoggedMinutes(subjectId, unitId = null) {
  return state.data.logs
    .filter(l => l.subjectId === subjectId && (!unitId || l.unitId === unitId))
    .reduce((s, l) => s + l.minutes, 0);
}
function subjectProgress(subject) {
  const totalEst = subject.units.reduce((s, u) => s + (u.estimatedHours || 0), 0) * 60;
  if (totalEst === 0) return 0;
  const logged = totalLoggedMinutes(subject.id);
  return Math.min(100, Math.round((logged / totalEst) * 100));
}
function todayLoggedMinutes(subjectId) {
  return state.data.logs
    .filter(l => l.subjectId === subjectId && l.date === today())
    .reduce((s, l) => s + l.minutes, 0);
}
function currentUnit(subject) {
  const done = new Set(
    state.data.logs.filter(l => l.subjectId === subject.id).map(l => l.unitId)
  );
  const sorted = [...subject.units].sort((a, b) => a.order - b.order);
  return sorted.find(u => u.status !== 'completed') || sorted[sorted.length - 1] || null;
}

// ── Navigation ────────────────────────────
function navigate(view, opts = {}) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');

  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === view);
  });

  state.view = view;
  if (opts.subjectId !== undefined) state.detailSubjectId = opts.subjectId;

  renderView(view);
}

function renderView(view) {
  switch (view) {
    case 'home':     renderHome(); break;
    case 'subjects': renderSubjects(); break;
    case 'detail':   renderDetail(); break;
    case 'log':      renderLog(); break;
    case 'calendar': renderCalendar(); break;
    case 'history':  renderHistory(); break;
    case 'settings': renderSettings(); break;
  }
}

// ── Home ──────────────────────────────────
function renderHome() {
  const el = document.getElementById('view-home');
  const subjects = state.data.subjects;
  const now = new Date();
  const dateStr = now.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
  const { geminiApiKey, groqApiKey, workerUrl } = state.data.settings;
  const aiEnabled = geminiApiKey || groqApiKey || workerUrl;

  // Auto-rebuild stale schedules (unit IDs may have changed after AI plan regen)
  let homeScheduleChanged = false;
  subjects.forEach(s => {
    if (s.units.length > 0) {
      const unitIdSet = new Set(s.units.map(u => u.id));
      const isStale = (s.schedule || []).some(e => !unitIdSet.has(e.unitId));
      if (isStale || !s.schedule || s.schedule.length === 0) {
        s.schedule = generateSchedule(s);
        homeScheduleChanged = true;
      }
    }
  });
  if (homeScheduleChanged) saveData(state.data);

  // Today's schedule entries (only valid unit IDs)
  const todaySchedule = [];
  subjects.forEach(s => {
    const unitIdSet = new Set(s.units.map(u => u.id));
    (s.schedule || []).filter(e => e.date === today() && unitIdSet.has(e.unitId)).forEach(e => {
      todaySchedule.push({ subjectId: s.id, unitId: e.unitId, subjectName: s.name, unitName: e.unitName, minutes: e.minutes });
    });
  });

  // Fallback: current unit per subject if no schedule for today
  const todayTasks = todaySchedule.length > 0 ? todaySchedule : subjects.flatMap(s => {
    const u = currentUnit(s);
    if (!u) return [];
    return [{ subjectId: s.id, unitId: u.id, subjectName: s.name, unitName: u.name, minutes: (s.hoursPerDay || 2) * 60 }];
  });

  // This week strip
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today() + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().split('T')[0];
    const hasTask = subjects.some(s => (s.schedule || []).some(e => e.date === ds));
    const logged = state.data.logs.filter(l => l.date === ds).reduce((s, l) => s + l.minutes, 0);
    const isBusy = (state.data.settings.busyDays || []).includes(ds);
    return { ds, day: d.getDate(), dow: ['日','月','火','水','木','金','土'][d.getDay()], isToday: ds === today(), hasTask, logged, isBusy };
  });

  let html = `<div style="padding-bottom:24px">`;

  // ── API key banner ──
  if (!aiEnabled) {
    html += `
      <div onclick="navigate('settings')" style="margin:12px 16px 0;background:linear-gradient(135deg,#fff3cd,#ffe69c);border-radius:14px;padding:13px 16px;display:flex;align-items:center;gap:12px;border:1.5px solid #ffd000;cursor:pointer">
        <div style="font-size:22px">🤖</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px">AI機能を有効にしよう</div>
          <div style="font-size:12px;color:#7a6000;margin-top:2px">タップして設定 → Groq APIキーを貼り付けるだけ</div>
        </div>
        <div style="font-size:20px;color:#7a6000">›</div>
      </div>`;
  }

  // ── Main study card ──
  if (subjects.length === 0) {
    html += `
      <div style="margin:16px 16px 0;background:linear-gradient(135deg,var(--primary),var(--primary-dark));border-radius:22px;padding:24px;color:white;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">📚</div>
        <div style="font-size:20px;font-weight:700;margin-bottom:8px">学習を始めよう</div>
        <div style="font-size:14px;opacity:0.85;margin-bottom:20px">科目を追加するだけで、AIが学習プランを自動作成します</div>
        <button onclick="navigate('subjects');setTimeout(showAddSubject,100)"
          style="background:white;color:var(--primary);border:none;border-radius:14px;padding:14px 28px;font-size:16px;font-weight:700;cursor:pointer;width:100%">
          ＋ 最初の科目を追加する
        </button>
      </div>`;
  } else if (todayTasks.length > 0) {
    const first = todayTasks[0];
    html += `
      <div style="margin:16px 16px 0;background:linear-gradient(135deg,var(--primary),var(--primary-dark));border-radius:22px;padding:20px;color:white;box-shadow:0 8px 24px rgba(108,92,231,0.35)">
        <div style="font-size:12px;opacity:0.75;margin-bottom:4px">${dateStr}</div>
        <div style="font-size:13px;opacity:0.85;margin-bottom:2px">今日学ぶこと</div>
        <div style="font-size:20px;font-weight:700;margin-bottom:2px;line-height:1.3">${first.unitName}</div>
        <div style="font-size:13px;opacity:0.75;margin-bottom:16px">${first.subjectName} · ${minutesToHM(first.minutes)}</div>
        <button onclick="showUnitPicker('${first.subjectId}')"
          style="background:white;color:var(--primary);border:none;border-radius:14px;padding:14px;font-size:16px;font-weight:700;cursor:pointer;width:100%;display:flex;align-items:center;justify-content:center;gap:8px">
          <span>🎓</span> 学習を開始する
        </button>
        ${todayTasks.length > 1 ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.2)">
          ${todayTasks.slice(1).map(t => `
            <div onclick="showUnitPicker('${t.subjectId}')" style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">
              <div style="width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.5)"></div>
              <div style="font-size:13px;opacity:0.85;flex:1">${t.subjectName} — ${t.unitName}</div>
              <div style="font-size:12px;opacity:0.65">${minutesToHM(t.minutes)}</div>
            </div>`).join('')}
        </div>` : ''}
      </div>`;
  }

  // ── Week strip ──
  html += `
    <div style="margin:12px 16px 0">
      <div style="font-size:12px;font-weight:700;color:var(--subtext);margin-bottom:8px;letter-spacing:0.5px;text-transform:uppercase">今週のスケジュール</div>
      <div style="display:flex;gap:6px">
        ${weekDays.map(w => `
          <div onclick="navigate('calendar')" style="flex:1;text-align:center;cursor:pointer">
            <div style="font-size:10px;color:${w.dow==='日'?'#e17055':w.dow==='土'?'#0984e3':'var(--subtext)'};margin-bottom:4px">${w.dow}</div>
            <div style="width:100%;aspect-ratio:1;border-radius:10px;display:flex;align-items:center;justify-content:center;
              background:${w.logged>0?'#d4f5ed':w.isBusy?'#ffeaea':w.hasTask?'#f0eeff':'var(--card)'};
              border:${w.isToday?'2px solid var(--primary)':'1.5px solid var(--border)'};
              font-size:13px;font-weight:${w.isToday?'700':'500'};
              color:${w.logged>0?'#00b894':w.isBusy?'#e17055':w.isToday?'var(--primary)':'var(--text)'}">
              ${w.day}
            </div>
            <div style="font-size:9px;margin-top:3px;color:${w.logged>0?'#00b894':w.hasTask?'var(--primary)':'transparent'}">
              ${w.logged>0?'✓':w.hasTask?'●':'·'}
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  // ── Progress ──
  if (subjects.length > 0) {
    html += `
      <div style="margin:12px 16px 0;background:var(--card);border-radius:16px;padding:16px;box-shadow:0 2px 12px rgba(108,92,231,0.06)">
        <div style="font-size:12px;font-weight:700;color:var(--subtext);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:12px">進捗</div>
        ${subjects.map(s => {
          const pct = subjectProgress(s);
          const cu = currentUnit(s);
          return `
            <div onclick="navigate('detail',{subjectId:'${s.id}'})" style="margin-bottom:14px;cursor:pointer">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
                <div>
                  <div style="font-weight:700;font-size:15px">${s.name}</div>
                  ${cu ? `<div style="font-size:12px;color:var(--subtext);margin-top:1px">次: ${cu.name}</div>` : ''}
                </div>
                <div style="text-align:right">
                  <div style="font-size:22px;font-weight:700;color:var(--primary)">${pct}%</div>
                  <div style="font-size:11px;color:var(--subtext)">残り${daysLeft(s.deadline)}日</div>
                </div>
              </div>
              <div class="progress-bar" style="height:8px"><div class="progress-fill" style="width:${pct}%"></div></div>
            </div>`;
        }).join('')}
      </div>`;

    // Recent logs
    const recent = [...state.data.logs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
    if (recent.length > 0) {
      html += `
        <div style="margin:12px 16px 0;background:var(--card);border-radius:16px;padding:16px;box-shadow:0 2px 12px rgba(108,92,231,0.06)">
          <div style="font-size:12px;font-weight:700;color:var(--subtext);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:10px">最近の記録</div>
          ${recent.map(l => {
            const s = state.data.subjects.find(s => s.id === l.subjectId);
            const u = s?.units.find(u => u.id === l.unitId);
            if (!s) return '';
            return `
              <div class="log-entry">
                <div class="log-entry-icon">📖</div>
                <div class="log-entry-body">
                  <div class="log-entry-title">${s.name} — ${u?.name||'不明'}</div>
                  <div class="log-entry-sub">${formatDate(l.date)}</div>
                </div>
                <div class="log-entry-time">${minutesToHM(l.minutes)}</div>
              </div>`;
          }).join('')}
        </div>`;
    }
  }

  html += `</div>`;
  el.innerHTML = html;
}

// ── Subjects ──────────────────────────────
function renderSubjects() {
  const el = document.getElementById('view-subjects');
  const subjects = state.data.subjects;

  let html = `
    <div class="page-header">
      <div class="page-title">科目<span>.</span></div>
      <button class="header-btn" onclick="showAddSubject()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>`;

  if (subjects.length === 0) {
    html += `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <div class="empty-title">まず科目を追加してみよう！</div>
        <div class="empty-sub">科目名・目標・期限を入れるだけで、<br><strong>AIが単元・学習順序・勉強法を自動で作成</strong>します。</div>
        <button class="btn btn-primary mt16" onclick="showAddSubject()" style="font-size:16px;padding:14px 28px">
          ✨ 最初の科目を追加する
        </button>
        <div style="font-size:12px;color:var(--subtext);margin-top:8px">無料で使えます・登録不要</div>
      </div>`;
  } else {
    subjects.forEach(s => {
      const pct = subjectProgress(s);
      const cu = currentUnit(s);
      html += `
        <div class="subject-card" onclick="navigate('detail', {subjectId:'${s.id}'})">
          <div class="subject-card-top">
            <div>
              <div class="subject-name">${s.name}</div>
              <div class="subject-goal">目標: ${s.goal}</div>
              <div class="subject-deadline">期限: ${formatDate(s.deadline)} (残${daysLeft(s.deadline)}日)</div>
            </div>
            <div class="subject-badge">${pct}%</div>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          ${cu ? `<div class="text-small mt8">今取り組み中: ${cu.name}</div>` : ''}
          <div class="subject-stats">
            <div class="subject-stat">
              <div class="subject-stat-val">${s.units.length}</div>
              <div class="subject-stat-lbl">単元数</div>
            </div>
            <div class="subject-stat">
              <div class="subject-stat-val">${minutesToHM(totalLoggedMinutes(s.id))}</div>
              <div class="subject-stat-lbl">累計学習</div>
            </div>
            <div class="subject-stat">
              <div class="subject-stat-val">${s.aiPlan ? '✓' : '—'}</div>
              <div class="subject-stat-lbl">AIプラン</div>
            </div>
          </div>
        </div>`;
    });
  }

  el.innerHTML = html;
}

// ── Detail ────────────────────────────────
function renderDetail() {
  const el = document.getElementById('view-detail');
  const s = state.data.subjects.find(s => s.id === state.detailSubjectId);
  if (!s) { navigate('subjects'); return; }

  const pct = subjectProgress(s);
  const totalEst = s.units.reduce((sum, u) => sum + (u.estimatedHours || 0), 0);
  const rec = s.aiPlan?.dailyHoursRecommended || '—';

  let html = `
    <div class="detail-hero">
      <button class="detail-hero-back" onclick="navigate('subjects')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        科目一覧
      </button>
      <div class="detail-subject-name">${s.name}</div>
      <div class="detail-goal">${s.goal}</div>
      <div class="detail-meta">
        <div class="detail-meta-item">
          <div class="detail-meta-val">${daysLeft(s.deadline)}</div>
          <div class="detail-meta-lbl">日後に期限</div>
        </div>
        <div class="detail-meta-item">
          <div class="detail-meta-val">${pct}%</div>
          <div class="detail-meta-lbl">達成率</div>
        </div>
        <div class="detail-meta-item">
          <div class="detail-meta-val">${rec}</div>
          <div class="detail-meta-lbl">推奨h/日</div>
        </div>
      </div>
      <div style="margin-top:14px">
        <div class="progress-bar" style="height:8px;background:rgba(255,255,255,0.25)">
          <div class="progress-fill" style="width:${pct}%;background:rgba(255,255,255,0.9)"></div>
        </div>
      </div>
    </div>

    ${s.units.length > 0 ? `
    <button class="detail-ai-btn" onclick="runAIPlan('${s.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      AIプランを再生成
    </button>` : ''}`;

  if (s.aiPlan?.overview) {
    html += `
      <div style="margin:0 16px 12px">
        <div class="ai-overview">
          <div class="ai-overview-title">✨ AIからのアドバイス</div>
          ${s.aiPlan.overview}
        </div>
      </div>`;
  }

  // Units
  const sorted = [...s.units].sort((a, b) => a.order - b.order);
  const cu = currentUnit(s);

  html += `
    <div class="card">
      <div class="flex-between mb8">
        <div class="card-title" style="margin-bottom:0">学習単元 (${s.units.length})</div>
        <button class="btn btn-secondary" style="padding:6px 12px;font-size:12px" onclick="showAddUnit('${s.id}')">
          + 追加
        </button>
      </div>`;

  if (sorted.length === 0) {
    html += `
      <div class="ai-omakase-card" onclick="runAIPlan('${s.id}')">
        <div class="ai-omakase-icon">🤖</div>
        <div class="ai-omakase-body">
          <div class="ai-omakase-title">AIにおまかせで学習プランを作成</div>
          <div class="ai-omakase-desc">タップするだけで、この科目に必要な単元・学習順序・勉強法をAIが自動で作成します</div>
          <div class="ai-omakase-btn">✨ AIプランを作成する（無料）</div>
        </div>
      </div>`;
  } else {
    sorted.forEach((u, i) => {
      const logged = totalLoggedMinutes(s.id, u.id);
      const est = (u.estimatedHours || 0) * 60;
      const isDone = u.status === 'completed' || (est > 0 && logged >= est);
      const isCurrent = cu && cu.id === u.id;
      const orderClass = isDone ? 'done' : isCurrent ? 'current' : '';

      html += `
        <div class="unit-item" onclick="showUnitDetail('${s.id}','${u.id}')">
          <div class="unit-order ${orderClass}">${isDone ? '✓' : i + 1}</div>
          <div class="unit-body">
            <div class="unit-name">${u.name}</div>
            ${u.studyMethod ? `<div class="unit-method">${u.studyMethod}</div>` : ''}
          </div>
          <div class="unit-hours">
            ${logged > 0 ? minutesToHM(logged) : '—'}
            ${est > 0 ? `<span>/ ${u.estimatedHours}h</span>` : ''}
          </div>
        </div>`;
    });
  }

  html += `</div>`;

  // Danger zone
  html += `
    <div style="padding:0 16px 32px">
      <button class="btn btn-danger btn-full" onclick="deleteSubject('${s.id}')">
        この科目を削除
      </button>
    </div>`;

  el.innerHTML = html;
}

function openLogForUnit(subjectId, unitId) {
  state.logSubjectId = subjectId;
  state.logUnitId = unitId;
  hideSheet();
  navigate('log');
}

// ── Log ───────────────────────────────────
function renderLog() {
  const el = document.getElementById('view-log');
  const subjects = state.data.subjects;

  if (subjects.length === 0) {
    el.innerHTML = `
      <div class="page-header"><div class="page-title">記録<span>.</span></div></div>
      <div class="empty-state">
        <div class="empty-icon">⏱</div>
        <div class="empty-title">科目を先に追加してください</div>
        <button class="btn btn-primary mt16" onclick="navigate('subjects')">科目タブへ</button>
      </div>`;
    return;
  }

  if (!state.logSubjectId || !subjects.find(s => s.id === state.logSubjectId)) {
    state.logSubjectId = subjects[0].id;
  }

  const s = subjects.find(s => s.id === state.logSubjectId);
  const units = s ? s.units : [];
  if (!state.logUnitId || !units.find(u => u.id === state.logUnitId)) {
    const cu = s ? currentUnit(s) : null;
    state.logUnitId = cu?.id || units[0]?.id || null;
  }

  let html = `
    <div class="page-header"><div class="page-title">記録<span>.</span></div></div>
    <div class="log-subject-selector">
      ${subjects.map(sub => `
        <div class="log-subject-chip ${sub.id === state.logSubjectId ? 'active' : ''}"
          onclick="selectLogSubject('${sub.id}')">${sub.name}</div>
      `).join('')}
    </div>
    <div class="card">
      <div class="form-group">
        <label class="form-label">単元</label>
        <select class="form-select" id="log-unit-select" onchange="state.logUnitId=this.value">
          ${units.map(u => `<option value="${u.id}" ${u.id === state.logUnitId ? 'selected' : ''}>${u.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">学習時間（分）</label>
        <input type="number" class="form-input" id="log-minutes" placeholder="例: 45" min="1" max="720">
      </div>
      <div class="form-group">
        <label class="form-label">日付（yyyy / mm / dd）</label>
        ${buildDateSelects('log-d', today())}
      </div>
      <div class="form-group">
        <label class="form-label">メモ（任意）</label>
        <textarea class="form-textarea" id="log-notes" placeholder="今日学んだこと、気づきなど…"></textarea>
      </div>
      <button class="btn btn-primary btn-full" onclick="saveLog()">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        記録を保存
      </button>
    </div>`;

  el.innerHTML = html;
}

function selectLogSubject(id) {
  state.logSubjectId = id;
  state.logUnitId = null;
  renderLog();
}

function saveLog() {
  const minutes = parseInt(document.getElementById('log-minutes').value);
  const date = getDateFromSelects('log-d');
  const notes = document.getElementById('log-notes').value.trim();

  if (!state.logUnitId) { showToast('単元を選択してください'); return; }
  if (!minutes || minutes < 1) { showToast('学習時間を入力してください'); return; }
  if (!date) { showToast('日付を選択してください'); return; }

  state.data.logs.push({
    id: uid(), subjectId: state.logSubjectId, unitId: state.logUnitId,
    date, minutes, notes, createdAt: Date.now()
  });
  saveData(state.data);
  showToast('✓ 記録しました！');
  navigate('home');
}

// ── Schedule generation ───────────────────
function generateSchedule(subject) {
  if (!subject.units.length) return [];
  const busyDays = state.data.settings.busyDays || [];
  const sortedUnits = [...subject.units].sort((a, b) => a.order - b.order);
  const hoursPerDay = subject.hoursPerDay || 2;
  const schedule = [];

  let cur = new Date(today() + 'T00:00:00');
  const deadline = new Date(subject.deadline + 'T00:00:00');

  for (const unit of sortedUnits) {
    let remaining = (unit.estimatedHours || 2) * 60; // in minutes
    while (remaining > 0 && cur <= deadline) {
      const ds = cur.toISOString().split('T')[0];
      if (!busyDays.includes(ds)) {
        const mins = Math.min(hoursPerDay * 60, remaining);
        schedule.push({ date: ds, unitId: unit.id, unitName: unit.name, minutes: mins });
        remaining -= mins;
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  return schedule;
}

function rebuildAllSchedules() {
  state.data.subjects.forEach(s => { s.schedule = generateSchedule(s); });
  saveData(state.data);
}

// ── Calendar ──────────────────────────────
function renderCalendar() {
  const el = document.getElementById('view-calendar');
  const busyDays = state.data.settings.busyDays || [];
  const year = state.calendarYear;
  const month = state.calendarMonth;

  // Auto-generate schedules for subjects that have units but no schedule
  let scheduleGenerated = false;
  state.data.subjects.forEach(s => {
    if (s.units.length > 0 && (!s.schedule || s.schedule.length === 0)) {
      s.schedule = generateSchedule(s);
      scheduleGenerated = true;
    }
  });
  if (scheduleGenerated) saveData(state.data);

  // Collect all schedule entries for this month
  const scheduleMap = {}; // date → [{subjectName, unitName, minutes}]
  state.data.subjects.forEach(s => {
    (s.schedule || []).forEach(e => {
      if (!scheduleMap[e.date]) scheduleMap[e.date] = [];
      scheduleMap[e.date].push({ subjectName: s.name, unitName: e.unitName, minutes: e.minutes });
    });
  });

  // Logged days
  const loggedMap = {};
  state.data.logs.forEach(l => {
    if (!loggedMap[l.date]) loggedMap[l.date] = 0;
    loggedMap[l.date] += l.minutes;
  });

  const monthName = new Date(year, month, 1).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = today();

  let html = `
    <div class="page-header">
      <div class="page-title">予定<span>.</span></div>
    </div>
    <div style="padding:0 16px 8px">
      <div style="background:#f0eeff;border-radius:12px;padding:10px 14px;font-size:13px;color:var(--primary);line-height:1.5;margin-bottom:12px">
        📅 日付をタップして<strong>予定あり</strong>にマーク。学習スケジュールが自動的に調整されます。
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <button onclick="calNavMonth(-1)" style="background:none;border:1.5px solid var(--border);border-radius:10px;padding:6px 14px;font-size:18px;cursor:pointer">‹</button>
        <div style="font-size:16px;font-weight:700">${monthName}</div>
        <button onclick="calNavMonth(1)" style="background:none;border:1.5px solid var(--border);border-radius:10px;padding:6px 14px;font-size:18px;cursor:pointer">›</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:4px">
        ${['日','月','火','水','木','金','土'].map((d,i) => `
          <div style="text-align:center;font-size:11px;font-weight:700;color:${i===0?'#e17055':i===6?'#0984e3':'var(--subtext)'};padding:4px 0">${d}</div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">
        ${Array(firstDay).fill('<div></div>').join('')}
        ${Array.from({length: daysInMonth}, (_, i) => {
          const d = i + 1;
          const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const isBusy = busyDays.includes(ds);
          const isToday = ds === todayStr;
          const tasks = scheduleMap[ds] || [];
          const logged = loggedMap[ds] || 0;
          const dow = (firstDay + i) % 7;

          let bg = 'white', border = '1.5px solid var(--border)', color = dow===0?'#e17055':dow===6?'#0984e3':'var(--text)';
          if (isToday) { border = '2px solid var(--primary)'; }
          if (isBusy) { bg = '#ffeaea'; color = '#e17055'; border = '1.5px solid #fab1a0'; }
          else if (tasks.length) { bg = '#f0eeff'; border = '1.5px solid var(--primary-light)'; }
          if (logged > 0) { bg = '#d4f5ed'; border = '1.5px solid #00b894'; }

          return `
            <div onclick="calTapDay('${ds}')" style="background:${bg};border:${border};border-radius:10px;padding:6px 4px;min-height:54px;cursor:pointer;position:relative">
              <div style="font-size:13px;font-weight:${isToday?'700':'500'};color:${color};text-align:center">${d}</div>
              ${isBusy ? `<div style="font-size:9px;text-align:center;color:#e17055;margin-top:2px">予定あり</div>` : ''}
              ${!isBusy && tasks.length ? `<div style="font-size:9px;text-align:center;color:var(--primary);margin-top:2px;line-height:1.3">${tasks[0].unitName.slice(0,6)}${tasks[0].unitName.length>6?'…':''}</div>` : ''}
              ${logged > 0 ? `<div style="font-size:9px;text-align:center;color:#00b894;margin-top:2px">${minutesToHM(logged)}</div>` : ''}
            </div>`;
        }).join('')}
      </div>

      <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:5px;font-size:11px"><div style="width:12px;height:12px;background:#f0eeff;border:1.5px solid var(--primary-light);border-radius:3px"></div>学習予定</div>
        <div style="display:flex;align-items:center;gap:5px;font-size:11px"><div style="width:12px;height:12px;background:#d4f5ed;border:1.5px solid #00b894;border-radius:3px"></div>記録済み</div>
        <div style="display:flex;align-items:center;gap:5px;font-size:11px"><div style="width:12px;height:12px;background:#ffeaea;border:1.5px solid #fab1a0;border-radius:3px"></div>予定あり</div>
      </div>
    </div>`;

  // Week ahead detail
  const upcoming = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(todayStr + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().split('T')[0];
    if (scheduleMap[ds]) upcoming.push({ date: ds, tasks: scheduleMap[ds] });
  }

  if (upcoming.length) {
    html += `<div class="card" style="margin-top:4px"><div class="card-title">今後2週間の学習予定</div>`;
    upcoming.forEach(({ date, tasks }) => {
      const isBusy = busyDays.includes(date);
      if (isBusy) return;
      html += `
        <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="width:44px;text-align:center;flex-shrink:0">
            <div style="font-size:18px;font-weight:700;color:var(--primary)">${new Date(date+'T00:00:00').getDate()}</div>
            <div style="font-size:10px;color:var(--subtext)">${new Date(date+'T00:00:00').toLocaleDateString('ja-JP',{weekday:'short'})}</div>
          </div>
          <div style="flex:1">
            ${tasks.map(t => `
              <div style="font-size:13px;font-weight:600">${t.subjectName}</div>
              <div style="font-size:12px;color:var(--subtext)">${t.unitName} · ${minutesToHM(t.minutes)}</div>
            `).join('')}
          </div>
        </div>`;
    });
    html += `</div>`;
  }

  if (!state.data.subjects.length || !state.data.subjects.some(s => s.schedule?.length)) {
    html += `
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <div class="empty-title">スケジュールがありません</div>
        <div class="empty-sub">科目を追加してAIプランを作成すると<br>ここに学習スケジュールが表示されます</div>
      </div>`;
  }

  el.innerHTML = html;
}

function calNavMonth(delta) {
  state.calendarMonth += delta;
  if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear--; }
  if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear++; }
  renderCalendar();
}

function calTapDay(date) {
  const busyDays = state.data.settings.busyDays || [];
  const scheduleMap = {};
  state.data.subjects.forEach(s => {
    (s.schedule || []).forEach(e => {
      if (!scheduleMap[e.date]) scheduleMap[e.date] = [];
      scheduleMap[e.date].push({ subjectId: s.id, unitId: e.unitId, unitName: e.unitName, subjectName: s.name });
    });
  });

  const isBusy = busyDays.includes(date);
  const tasks = scheduleMap[date] || [];
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

  showSheet(`
    <div class="sheet-title">📅 ${dateLabel}</div>
    ${isBusy ? `
      <div style="background:#ffeaea;border-radius:12px;padding:12px;margin-bottom:14px;color:#e17055;font-weight:600;text-align:center">
        この日は予定あり
      </div>` : tasks.length ? `
      <div style="margin-bottom:14px">
        <div style="font-size:13px;font-weight:700;margin-bottom:8px">📚 この日の学習予定</div>
        ${tasks.map(t => `
          <div style="background:#f0eeff;border-radius:10px;padding:12px;margin-bottom:8px">
            <div style="font-size:14px;font-weight:700;color:var(--primary)">${t.subjectName}</div>
            <div style="font-size:13px;margin-top:2px">${t.unitName}</div>
            <button onclick="hideSheet();showUnitLesson('${t.subjectId}','${t.unitId}')"
              style="margin-top:10px;background:var(--primary);color:white;border:none;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;width:100%">
              🎓 今日学習する
            </button>
          </div>`).join('')}
      </div>` : `
      <div style="text-align:center;padding:20px 0;color:var(--subtext);font-size:14px">
        この日の学習予定はありません
      </div>`}
    <div style="display:flex;gap:8px">
      <button onclick="toggleBusyDay('${date}')" class="btn ${isBusy ? 'btn-secondary' : 'btn-danger'}" style="flex:1">
        ${isBusy ? '✓ 予定ありを解除' : '× この日は予定あり'}
      </button>
      <button onclick="hideSheet()" class="btn btn-secondary" style="flex:1">閉じる</button>
    </div>
  `);
}

function toggleBusyDay(date) {
  if (!state.data.settings.busyDays) state.data.settings.busyDays = [];
  const idx = state.data.settings.busyDays.indexOf(date);
  if (idx >= 0) {
    state.data.settings.busyDays.splice(idx, 1);
    showToast('予定を解除しました');
  } else {
    state.data.settings.busyDays.push(date);
    showToast('予定ありに設定しました');
  }
  // Rebuild all schedules to skip busy days
  rebuildAllSchedules();
  hideSheet();
  renderCalendar();
}

// ── History ───────────────────────────────
function renderHistory() {
  const el = document.getElementById('view-history');
  const logs = [...state.data.logs].sort((a, b) => b.createdAt - a.createdAt);

  let html = `<div class="page-header"><div class="page-title">履歴<span>.</span></div></div>`;

  if (logs.length === 0) {
    html += `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">まだ記録がありません</div></div>`;
  } else {
    // Group by date
    const byDate = {};
    logs.forEach(l => {
      if (!byDate[l.date]) byDate[l.date] = [];
      byDate[l.date].push(l);
    });

    Object.entries(byDate).forEach(([date, dayLogs]) => {
      const total = dayLogs.reduce((s, l) => s + l.minutes, 0);
      html += `
        <div style="padding:8px 16px 4px">
          <div class="flex-between">
            <div style="font-weight:700;font-size:15px">${formatDate(date)}</div>
            <div class="badge badge-primary">${minutesToHM(total)}</div>
          </div>
        </div>
        <div class="card" style="padding:0">`;

      dayLogs.forEach(l => {
        const s = state.data.subjects.find(s => s.id === l.subjectId);
        const u = s?.units.find(u => u.id === l.unitId);
        html += `
          <div class="log-entry">
            <div class="log-entry-icon">📖</div>
            <div class="log-entry-body">
              <div class="log-entry-title">${s?.name || '削除済み'} — ${u?.name || '不明'}</div>
              ${l.notes ? `<div class="log-entry-sub">${l.notes}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <div class="log-entry-time">${minutesToHM(l.minutes)}</div>
              <button onclick="deleteLog('${l.id}')" style="background:none;border:none;color:var(--subtext);cursor:pointer;font-size:12px">削除</button>
            </div>
          </div>`;
      });
      html += `</div>`;
    });
  }

  el.innerHTML = html;
}

function deleteLog(id) {
  state.data.logs = state.data.logs.filter(l => l.id !== id);
  saveData(state.data);
  renderHistory();
  showToast('削除しました');
}

// ── Settings ──────────────────────────────
function renderSettings() {
  const el = document.getElementById('view-settings');
  const key = state.data.settings.geminiApiKey || '';
  const groqKey = state.data.settings.groqApiKey || '';
  const workerUrl = state.data.settings.workerUrl || '';
  const aiEnabled = key || groqKey || workerUrl;
  const activeMode = workerUrl ? 'Workerモード' : groqKey ? 'Groqモード' : key ? 'Geminiモード' : '';

  el.innerHTML = `
    <div class="page-header"><div class="page-title">設定<span>.</span></div></div>
    <div style="padding:0 16px 32px">

      ${!aiEnabled ? `
      <div style="background:linear-gradient(135deg,#fff3cd,#ffe69c);border-radius:16px;padding:16px;margin-bottom:20px;border:1.5px solid #ffd000">
        <div style="font-size:15px;font-weight:700;margin-bottom:4px">⚠️ AI機能が使えません</div>
        <div style="font-size:13px;color:#7a6000;line-height:1.5">下のいずれかのAIキーを設定してください。</div>
      </div>` : `
      <div style="background:#d4f5ed;border-radius:16px;padding:16px;margin-bottom:20px">
        <div style="font-size:15px;font-weight:700;color:#00b894">✅ AI機能が使えます（${activeMode}）</div>
      </div>`}

      <div class="settings-section">
        <div class="settings-section-title">⚡ Groq APIキー <span style="background:#00b894;color:white;font-size:10px;padding:2px 7px;border-radius:20px;margin-left:6px;font-weight:700">おすすめ・簡単</span></div>
        <div class="card" style="margin:0">
          <div style="font-size:13px;line-height:1.7;color:var(--text);margin-bottom:12px">
            GeminiのかわりにGroqという無料AIサービスを使う方法です。<strong>登録が簡単</strong>で、1日14,400回まで無料で使えます。
          </div>
          <div class="card" style="margin:0 0 12px;padding:0;background:#f8f8f8">
            ${[
              ['1','groq.com にアクセス','ブラウザで開いてGoogleアカウントでログイン'],
              ['2','「API Keys」→「Create API key」','左メニューからAPI Keysを選んでキーを作成'],
              ['3','コピーして下に貼り付ける','「gsk_...」で始まる文字列をコピーして保存'],
            ].map(([n, title, desc]) => `
              <div style="display:flex;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border)">
                <div style="width:24px;height:24px;border-radius:50%;background:var(--success);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0">${n}</div>
                <div>
                  <div style="font-weight:700;font-size:13px">${title}</div>
                  <div style="font-size:12px;color:var(--subtext);margin-top:2px">${desc}</div>
                </div>
              </div>`).join('')}
            <div style="padding:12px 14px">
              <a href="https://console.groq.com/keys" target="_blank"
                style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#00b894,#00cec9);color:white;border-radius:12px;padding:12px;font-weight:700;font-size:14px;text-decoration:none">
                🔗 Groq Console を開く
              </a>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <input type="password" class="form-input" id="groq-key-input"
              placeholder="gsk_... をここに貼り付ける" value="${groqKey}">
          </div>
          <button class="btn btn-primary btn-full" style="background:linear-gradient(135deg,#00b894,#00cec9)" onclick="saveGroqKey()">Groqキーを保存する</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">🤖 AIキーって何？</div>
        <div class="card" style="margin:0;padding:16px">
          <div style="font-size:14px;line-height:1.8;color:var(--text)">
            このアプリはGoogleのAI（Gemini）を使って、あなたの科目に合った学習プランを自動で作ります。<br><br>
            AIを使うには「AIキー」と呼ばれる<strong>通行証のような文字列</strong>が必要です。<br><br>
            Googleアカウントさえあれば<strong style="color:var(--success)">完全無料</strong>で取得でき、クレジットカードも不要です。個人利用なら無料枠で十分です。
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">📋 取得手順（3ステップ）</div>
        <div class="card" style="margin:0;padding:0">
          ${[
            ['1', '下のボタンをタップ', 'Google AI Studioというページが開きます（Googleアカウントでログイン）'],
            ['2', '「Create API key」を押す', '青いボタンを押すだけ。数秒で「AIzaSy...」から始まる文字列が表示されます'],
            ['3', 'コピーして下に貼り付ける', 'その文字列をコピーして、このページ下の入力欄に貼り付けて「保存」を押すだけ'],
          ].map(([n, title, desc]) => `
            <div style="display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border)">
              <div style="width:28px;height:28px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0">${n}</div>
              <div>
                <div style="font-weight:700;font-size:14px">${title}</div>
                <div style="font-size:12px;color:var(--subtext);margin-top:2px;line-height:1.4">${desc}</div>
              </div>
            </div>`).join('')}
          <div style="padding:14px 16px">
            <a href="https://aistudio.google.com/app/apikey" target="_blank"
              style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;border-radius:12px;padding:13px;font-weight:700;font-size:15px;text-decoration:none">
              🔗 Google AI Studio を開く
            </a>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">🔑 AIキーを入力</div>
        <div class="card" style="margin:0">
          <div class="form-group" style="margin-bottom:12px">
            <input type="password" class="form-input" id="api-key-input"
              placeholder="AIzaSy... をここに貼り付ける" value="${key}">
          </div>
          <div style="font-size:12px;color:var(--subtext);margin-bottom:12px;line-height:1.5">
            🔒 キーはこの端末の中だけに保存されます。外部に送信されることはありません。
          </div>
          <button class="btn btn-primary btn-full" onclick="saveApiKey()">保存する</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">⚡ Cloudflare Worker URL（上級者向け）</div>
        <div class="card" style="margin:0">
          <div style="font-size:13px;line-height:1.6;color:var(--subtext);margin-bottom:12px">
            Cloudflare WorkerのURLを設定すると、<strong>APIキーをこの端末に保存せずに</strong>AI機能を使えます。<br>
            設定するとAPIキー欄は不要になります。（自分でWorkerをデプロイした場合のみ）
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <input type="url" class="form-input" id="worker-url-input"
              placeholder="https://studypath-api.xxx.workers.dev"
              value="${workerUrl}">
          </div>
          <button class="btn btn-primary btn-full" onclick="saveWorkerUrl()">Worker URLを保存</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">データ管理</div>
        <div class="card" style="margin:0">
          <div class="text-small" style="margin-bottom:12px">
            科目数: ${state.data.subjects.length} ／ 記録数: ${state.data.logs.length}
          </div>
          <button class="btn btn-danger btn-full" onclick="confirmClearAll()">すべてのデータを削除</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">アプリ情報</div>
        <div class="card" style="margin:0">
          <div class="text-small" style="line-height:1.8">
            <strong>StudyPath</strong> v1.0<br>
            📱 iPhoneでホーム画面に追加するとアプリとして使えます<br>
            （Safari → 共有ボタン → ホーム画面に追加）
          </div>
        </div>
      </div>
    </div>`;
}

function saveApiKey() {
  const key = document.getElementById('api-key-input').value.trim();
  state.data.settings.geminiApiKey = key;
  saveData(state.data);
  showToast('✓ APIキーを保存しました');
  renderSettings();
}

function saveGroqKey() {
  const key = document.getElementById('groq-key-input').value.trim();
  state.data.settings.groqApiKey = key;
  saveData(state.data);
  showToast(key ? '✓ Groq APIキーを保存しました' : 'Groqキーをクリアしました');
  renderSettings();
}

function saveWorkerUrl() {
  const url = document.getElementById('worker-url-input').value.trim();
  state.data.settings.workerUrl = url;
  saveData(state.data);
  showToast(url ? '✓ Worker URLを保存しました' : 'Worker URLをクリアしました');
  renderSettings();
}

function confirmClearAll() {
  if (confirm('すべての科目・記録を削除します。よろしいですか？')) {
    state.data = defaultData();
    saveData(state.data);
    navigate('home');
    showToast('データを削除しました');
  }
}

// ── Add Subject Sheet ─────────────────────
function buildDateSelects(prefix, defaultISO) {
  const [dy, dm, dd] = defaultISO.split('-').map(Number);
  const thisYear = new Date().getFullYear();
  const years = Array.from({length: 10}, (_, i) => thisYear + i);
  const months = Array.from({length: 12}, (_, i) => i + 1);
  const days = Array.from({length: 31}, (_, i) => i + 1);
  const pad = n => String(n).padStart(2, '0');

  return `
    <div style="display:flex;gap:6px;align-items:center">
      <select class="form-select" id="${prefix}-year" style="flex:3">
        ${years.map(y => `<option value="${y}" ${y===dy?'selected':''}>${y}</option>`).join('')}
      </select>
      <span style="color:var(--subtext);font-weight:600">/</span>
      <select class="form-select" id="${prefix}-month" style="flex:2">
        ${months.map(m => `<option value="${pad(m)}" ${m===dm?'selected':''}>${pad(m)}</option>`).join('')}
      </select>
      <span style="color:var(--subtext);font-weight:600">/</span>
      <select class="form-select" id="${prefix}-day" style="flex:2">
        ${days.map(d => `<option value="${pad(d)}" ${d===dd?'selected':''}>${pad(d)}</option>`).join('')}
      </select>
    </div>`;
}

function getDateFromSelects(prefix) {
  const y = document.getElementById(`${prefix}-year`).value;
  const m = document.getElementById(`${prefix}-month`).value;
  const d = document.getElementById(`${prefix}-day`).value;
  return `${y}-${m}-${d}`;
}

function showAddSubject() {
  const def = getDefaultDeadline();
  showSheet(`
    <div class="sheet-title">科目を追加</div>
    <div style="background:#f0eeff;border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--primary);line-height:1.5">
      🤖 追加するだけで<strong>AIが単元・学習順序・勉強法を自動作成</strong>します
    </div>
    <div class="form-group">
      <label class="form-label">科目名</label>
      <input type="text" class="form-input" id="ns-name" placeholder="例: 英語、数学、プログラミング">
    </div>
    <div class="form-group">
      <label class="form-label">目標</label>
      <input type="text" class="form-input" id="ns-goal" placeholder="例: TOEIC 800点、応用情報合格">
    </div>
    <div class="form-group">
      <label class="form-label">今の自分のレベル <span style="color:var(--subtext);font-weight:400">（任意）</span></label>
      <input type="text" class="form-input" id="ns-level" placeholder="例: プログラミング未経験 / C言語は知っている / 基礎はわかる">
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label class="form-label">期限（yyyy / mm / dd）</label>
        ${buildDateSelects('ns-dl', def)}
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">1日の目安（時間）</label>
        <input type="number" class="form-input" id="ns-hours" value="2" min="0.5" max="12" step="0.5">
      </div>
    </div>
    <button class="btn btn-primary btn-full" onclick="addSubject()">追加してAIプランを自動作成 →</button>
  `);
}

function getDefaultDeadline() {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().split('T')[0];
}

function addSubject() {
  const name = document.getElementById('ns-name').value.trim();
  const goal = document.getElementById('ns-goal').value.trim();
  const level = document.getElementById('ns-level').value.trim();
  const deadline = getDateFromSelects('ns-dl');
  const hoursPerDay = parseFloat(document.getElementById('ns-hours').value) || 2;

  if (!name) { showToast('科目名を入力してください'); return; }
  if (!goal) { showToast('目標を入力してください'); return; }
  if (!deadline) { showToast('期限を入力してください'); return; }

  const subject = {
    id: uid(), name, goal, level, deadline, hoursPerDay,
    createdAt: Date.now(), units: [], aiPlan: null
  };

  state.data.subjects.push(subject);
  saveData(state.data);
  hideSheet();
  navigate('detail', { subjectId: subject.id });
  showToast('✓ 科目を追加しました');

  // APIキーまたはWorker URLが設定済みなら自動でAIプラン生成
  const { geminiApiKey, groqApiKey, workerUrl } = state.data.settings;
  if (geminiApiKey || groqApiKey || workerUrl) {
    setTimeout(() => runAIPlan(subject.id), 400);
  }
}

// ── Add Unit Sheet ────────────────────────
function showAddUnit(subjectId) {
  showSheet(`
    <div class="sheet-title">単元を追加</div>
    <div class="form-group">
      <label class="form-label">単元名</label>
      <input type="text" class="form-input" id="nu-name" placeholder="例: 過去形、語彙Ch.1">
    </div>
    <div class="form-group">
      <label class="form-label">目安時間（時間）</label>
      <input type="number" class="form-input" id="nu-hours" placeholder="例: 5" min="0" step="0.5">
    </div>
    <button class="btn btn-primary btn-full" onclick="addUnit('${subjectId}')">追加</button>
  `);
}

function addUnit(subjectId) {
  const name = document.getElementById('nu-name').value.trim();
  const hours = parseFloat(document.getElementById('nu-hours').value) || 0;
  if (!name) { showToast('単元名を入力してください'); return; }

  const s = state.data.subjects.find(s => s.id === subjectId);
  if (!s) return;
  const maxOrder = s.units.reduce((m, u) => Math.max(m, u.order), -1);
  s.units.push({ id: uid(), name, order: maxOrder + 1, estimatedHours: hours, studyMethod: '', status: 'not_started' });
  saveData(state.data);
  hideSheet();
  renderDetail();
  showToast('✓ 単元を追加しました');
}

// ── Unit Picker Sheet ─────────────────────
function showUnitPicker(subjectId) {
  const s = state.data.subjects.find(s => s.id === subjectId);
  if (!s) return;
  const sorted = [...s.units].sort((a, b) => a.order - b.order);
  const statusLabel = { not_started: '未着手', in_progress: '学習中', completed: '完了' };
  const statusColor = { not_started: 'var(--subtext)', in_progress: 'var(--primary)', completed: '#00b894' };
  const statusIcon  = { not_started: '○', in_progress: '▶', completed: '✓' };

  showSheet(`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <button onclick="hideSheet()" style="background:none;border:none;font-size:22px;cursor:pointer;padding:0;line-height:1;color:var(--primary)">←</button>
      <div>
        <div style="font-size:17px;font-weight:700">${s.name}</div>
        <div style="font-size:12px;color:var(--subtext)">単元を選んで学習を開始</div>
      </div>
    </div>
    ${sorted.map(u => `
      <div onclick="showUnitLesson('${s.id}','${u.id}')"
        style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:var(--bg);margin-bottom:8px;cursor:pointer;border:1.5px solid var(--border)">
        <div style="width:32px;height:32px;border-radius:50%;background:${u.status==='completed'?'#d4f5ed':u.status==='in_progress'?'#f0eeff':'var(--card)'};display:flex;align-items:center;justify-content:center;font-size:16px;color:${statusColor[u.status]||'var(--subtext)'};font-weight:700;flex-shrink:0">
          ${statusIcon[u.status]||'○'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;line-height:1.3">${u.name}</div>
          <div style="font-size:12px;color:${statusColor[u.status]||'var(--subtext)'};margin-top:2px">
            ${statusLabel[u.status]||'未着手'}${u.estimatedHours ? ' · ' + u.estimatedHours + '時間' : ''}
          </div>
        </div>
        <div style="color:var(--subtext);font-size:18px">›</div>
      </div>`).join('')}
  `);
}

// ── Unit Detail Sheet ────────────────────
function showUnitDetail(subjectId, unitId) {
  const s = state.data.subjects.find(s => s.id === subjectId);
  if (!s) return;
  const u = s.units.find(u => u.id === unitId);
  if (!u) return;
  const logged = totalLoggedMinutes(subjectId, unitId);
  const statusOpts = [
    { value: 'not_started', label: '未着手' },
    { value: 'in_progress', label: '学習中' },
    { value: 'completed', label: '完了' },
  ];

  showSheet(`
    <div class="sheet-title">${u.name}</div>
    ${u.studyMethod ? `
      <div class="ai-overview" style="margin-bottom:12px">
        <div class="ai-overview-title">📖 学習方法</div>
        ${u.studyMethod}
      </div>` : ''}
    <button class="btn btn-full" onclick="showUnitLesson('${subjectId}','${unitId}')"
      style="margin-bottom:14px;background:linear-gradient(135deg,#6C5CE7,#a29bfe);color:white;font-weight:700;font-size:15px;padding:14px;border-radius:14px;border:none">
      🎓 AIに解説してもらう
    </button>
    <div class="form-group">
      <label class="form-label">ステータス</label>
      <select class="form-select" id="ud-status">
        ${statusOpts.map(o => `<option value="${o.value}" ${u.status === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">目安時間（時間）</label>
      <input type="number" class="form-input" id="ud-hours" value="${u.estimatedHours || ''}" min="0" step="0.5">
    </div>
    <div class="text-small mb8">累計学習: ${minutesToHM(logged)}</div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" style="flex:1" onclick="updateUnit('${subjectId}','${unitId}')">保存</button>
      <button class="btn btn-danger" style="flex:1" onclick="deleteUnit('${subjectId}','${unitId}')">削除</button>
    </div>
  `);
}

async function fetchWikipediaImage(query) {
  try {
    const url = `https://ja.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(query)}&prop=pageimages&pithumbsize=600&format=json&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    const pages = Object.values(data.query?.pages || {});
    return pages[0]?.thumbnail?.source || null;
  } catch { return null; }
}

async function showUnitLesson(subjectId, unitId) {
  const s = state.data.subjects.find(s => s.id === subjectId);
  const u = s?.units.find(u => u.id === unitId);
  if (!s || !u) {
    showToast('単元が見つかりません。ホームに戻り直してみてください。');
    return;
  }

  // Show sheet in lesson mode
  showSheet(`
    <div style="text-align:center;padding:40px 0;color:var(--subtext)">
      <div class="spinner" style="margin:0 auto 16px"></div>
      <div>AIが解説を生成中…</div>
    </div>`);
  document.getElementById('sheet').classList.add('lesson-mode');
  document.getElementById('sheet').scrollTop = 0;

  const level = s.level ? `\n学習者のレベル: ${s.level}（このレベルに合わせて内容を調整すること）` : '';
  const prompt = `あなたは優秀な学習コーチ兼講師です。
科目「${s.name}」（目標: ${s.goal}）の単元「${u.name}」について、この単元だけで学習が完結できる充実したコンテンツを生成してください。${level}

以下のJSON形式のみで回答してください（説明文不要）:
{
  "summary": "この単元で何を・なぜ学ぶかの概要（3文）",
  "isHardware": false,
  "imageQuery": "日本語Wikipediaで画像検索するための最適なキーワード（1〜3語）",
  "videoQuery": "YouTubeで検索する日本語クエリ（具体的に・例: C言語 変数 入門 解説）",
  "objectives": ["学習目標1（〜できる）","学習目標2","学習目標3"],
  "partsNeeded": ["必要な部品・材料（ハードウェア単元のみ。不要なら空配列）"],
  "steps": [
    {
      "title": "ステップのタイトル",
      "description": "具体的な手順の説明（ハードウェアなら配線・操作手順、ソフトウェアなら実装手順）",
      "tip": "つまずきやすいポイント・注意点（あれば）"
    }
  ],
  "circuitDiagram": "回路図や配線図をASCIIアートで表現（ハードウェア単元のみ。不要なら空文字）",
  "concepts": [
    {
      "title": "概念・用語名",
      "body": "その概念の詳しい説明（100〜150字）",
      "example": "具体例・コード例・図解の代わりとなるテキスト（あれば）"
    }
  ],
  "exercises": [
    {"question": "練習問題（考えさせる問い）", "answer": "模範解答（具体的に）"},
    {"question": "練習問題2", "answer": "模範解答2"},
    {"question": "練習問題3", "answer": "模範解答3"}
  ],
  "quiz": [
    {"q": "4択クイズの問題文", "choices": ["選択肢A","選択肢B","選択肢C","選択肢D"], "answer": 0},
    {"q": "クイズ2", "choices": ["A","B","C","D"], "answer": 1},
    {"q": "クイズ3", "choices": ["A","B","C","D"], "answer": 2}
  ],
  "nextStep": "この単元を終えたら次に何をすべきか（1〜2文）"
}

重要な指示:
- isHardware: ブレッドボード・回路・配線・マイコン・センサー・抵抗・はんだなど物理的な作業を含む単元はtrue
- steps: 必ず5〜8ステップで、ハードウェアなら「〇番ピンに△を接続」レベルの具体的な配線手順、ソフトウェアなら実際に書くコードを含む実装手順
- circuitDiagram: ハードウェア単元では必ずASCIIアートで回路図を描くこと（例: [LED]---[220Ω]---[GND]）
- partsNeeded: ハードウェア単元では実際に必要な部品を全て列挙すること`;

  try {
    const [aiData, imgSrc] = await Promise.all([
      callGemini(prompt),
      fetchWikipediaImage(u.name)
    ]);

    const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const lesson = parseJSON(text);

    // If AI suggested a better image query and we got no image, try that
    let finalImg = imgSrc;
    if (!finalImg && lesson.imageQuery) {
      finalImg = await fetchWikipediaImage(lesson.imageQuery);
    }

    const ytQuery = encodeURIComponent(lesson.videoQuery || `${u.name} ${s.name} 解説`);
    const isHW = lesson.isHardware === true;

    document.getElementById('sheet-content').innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <button onclick="closeLessonMode('${subjectId}','${unitId}')"
          style="background:none;border:none;font-size:22px;cursor:pointer;padding:0;line-height:1;color:var(--primary)">←</button>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:700;line-height:1.3">${u.name}</div>
          ${isHW ? `<div style="font-size:11px;font-weight:700;color:#e17055;margin-top:2px">🔧 ハードウェア実践単元</div>` : ''}
        </div>
      </div>

      ${finalImg ? `<img src="${finalImg}" alt="${u.name}"
        style="width:100%;border-radius:14px;object-fit:cover;max-height:200px;margin-bottom:12px">` : ''}

      ${isHW && lesson.partsNeeded?.length ? `
      <div style="background:#fff8f0;border:1.5px solid #fdcb6e;border-radius:12px;padding:12px;margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;color:#e17055;margin-bottom:8px">🛒 必要な部品・材料</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${lesson.partsNeeded.map(p => `<span style="background:white;border:1px solid #fdcb6e;border-radius:20px;padding:4px 10px;font-size:12px;color:#e17055;font-weight:600">${p}</span>`).join('')}
        </div>
      </div>` : ''}

      <div style="display:flex;gap:8px;margin-bottom:14px">
        <a href="https://www.youtube.com/results?search_query=${ytQuery}" target="_blank"
          style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:#ff0000;color:white;border-radius:12px;padding:10px;text-decoration:none;font-weight:700;font-size:12px">
          <svg viewBox="0 0 24 24" fill="white" width="16" height="16"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>
          YouTube
        </a>
        ${isHW ? `
        <a href="https://falstad.com/circuit/circuitjs.html" target="_blank"
          style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:#0984e3;color:white;border-radius:12px;padding:10px;text-decoration:none;font-weight:700;font-size:12px">
          ⚡ 回路シミュレーター
        </a>` : ''}
      </div>

      <div style="background:#f0eeff;border-radius:12px;padding:12px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:5px">📌 この単元について</div>
        <div style="font-size:13px;line-height:1.7">${lesson.summary || ''}</div>
        ${lesson.objectives?.length ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          <div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:5px">学習目標</div>
          ${lesson.objectives.map(o => `<div style="font-size:12px;line-height:1.6">✓ ${o}</div>`).join('')}
        </div>` : ''}
      </div>

      ${lesson.steps?.length ? `
      <div style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px">${isHW ? '🔧 実践手順' : '📋 学習ステップ'}</div>
        ${lesson.steps.map((step, i) => `
          <div style="display:flex;gap:10px;margin-bottom:10px">
            <div style="width:28px;height:28px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;margin-top:2px">${i+1}</div>
            <div style="flex:1;background:var(--card);border-radius:12px;padding:10px 12px;border:1.5px solid var(--border)">
              <div style="font-size:13px;font-weight:700;margin-bottom:4px">${step.title}</div>
              <div style="font-size:13px;line-height:1.6;color:var(--text)">${step.description}</div>
              ${step.tip ? `<div style="margin-top:6px;padding:6px 8px;background:#fff8f0;border-radius:8px;font-size:11px;color:#e17055;line-height:1.5">💡 ${step.tip}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>` : ''}

      ${isHW && lesson.circuitDiagram ? `
      <div style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px">📐 回路図</div>
        <div style="background:#1a1a2e;border-radius:12px;padding:14px;overflow-x:auto">
          <pre style="font-family:monospace;font-size:12px;color:#a29bfe;line-height:1.8;margin:0;white-space:pre-wrap;word-break:break-all">${lesson.circuitDiagram}</pre>
        </div>
      </div>` : ''}

      ${lesson.concepts?.length ? `
      <div style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px">📘 重要概念</div>
        ${lesson.concepts.map(c => `
          <div style="border:1.5px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px">
            <div style="font-size:13px;font-weight:700;color:var(--primary);margin-bottom:6px">${c.title}</div>
            <div style="font-size:13px;line-height:1.7;margin-bottom:${c.example ? '8px' : '0'}">${c.body}</div>
            ${c.example ? `<div style="background:#1a1a2e;border-radius:8px;padding:8px;font-size:12px;color:#a29bfe;font-family:monospace;line-height:1.6;white-space:pre-wrap">${c.example}</div>` : ''}
          </div>`).join('')}
      </div>` : ''}

      ${lesson.exercises?.length ? `
      <div style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px">✏️ 練習問題</div>
        ${lesson.exercises.map((e, i) => `
          <div style="background:#f8f8f8;border-radius:12px;padding:12px;margin-bottom:10px">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px">Q${i+1}. ${e.question}</div>
            <details style="font-size:12px">
              <summary style="cursor:pointer;color:var(--primary);font-weight:700;user-select:none">答えを見る</summary>
              <div style="margin-top:8px;padding:8px;background:white;border-radius:8px;line-height:1.6;color:var(--text)">${e.answer}</div>
            </details>
          </div>`).join('')}
      </div>` : ''}

      ${lesson.quiz?.length ? `
      <div style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px">🧠 理解度チェック</div>
        ${lesson.quiz.map((q, qi) => `
          <div style="border:1.5px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px">
            <div style="font-size:13px;font-weight:600;margin-bottom:10px">Q${qi+1}. ${q.q}</div>
            <div id="quiz-${qi}-result"></div>
            ${(q.choices||[]).map((c, ci) => `
              <button onclick="checkQuiz(${qi},${ci},${q.answer})"
                style="width:100%;text-align:left;background:#f8f8f8;border:1.5px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:6px;font-size:12px;cursor:pointer" id="quiz-${qi}-btn-${ci}">
                ${['A','B','C','D'][ci]}. ${c}
              </button>`).join('')}
          </div>`).join('')}
      </div>` : ''}

      ${lesson.nextStep ? `
      <div style="background:linear-gradient(135deg,#00b894,#00cec9);border-radius:12px;padding:12px;margin-bottom:16px;color:white">
        <div style="font-size:11px;font-weight:700;opacity:0.85;margin-bottom:4px">🚀 次のステップ</div>
        <div style="font-size:13px;line-height:1.6">${lesson.nextStep}</div>
      </div>` : ''}

      <div style="border-top:1.5px solid var(--border);padding-top:16px;margin-top:4px;display:flex;flex-direction:column;gap:10px">
        ${(() => {
          const sorted = [...s.units].sort((a, b) => a.order - b.order);
          const idx = sorted.findIndex(x => x.id === u.id);
          const nextUnit = sorted[idx + 1] || null;
          return nextUnit
            ? `<button onclick="showUnitLesson('${s.id}','${nextUnit.id}')"
                style="background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;width:100%">
                次の単元へ → ${nextUnit.name}
              </button>`
            : '';
        })()}
        <div style="display:flex;gap:8px">
          <button onclick="openLogForUnit('${s.id}','${u.id}')"
            style="flex:1;background:#f0eeff;color:var(--primary);border:none;border-radius:14px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">
            📝 学習を記録する
          </button>
          <button onclick="closeLessonMode('${subjectId}','${unitId}')"
            style="flex:1;background:var(--card);color:var(--text);border:1.5px solid var(--border);border-radius:14px;padding:12px;font-size:14px;font-weight:600;cursor:pointer">
            ← 単元一覧
          </button>
        </div>
      </div>`;

    document.getElementById('sheet').scrollTop = 0;
  } catch (e) {
    document.getElementById('sheet-content').innerHTML = `
      <div class="sheet-title">${u.name}</div>
      <div style="color:var(--danger);padding:20px 0">エラー: ${e.message}</div>
      <button class="btn btn-secondary btn-full" onclick="closeLessonMode('${subjectId}','${unitId}')">← 戻る</button>`;
  }
}

function checkQuiz(quizIdx, choiceIdx, correctIdx) {
  // Disable all buttons for this question
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`quiz-${quizIdx}-btn-${i}`);
    if (!btn) continue;
    btn.disabled = true;
    if (i === correctIdx) {
      btn.style.background = '#d4f5ed';
      btn.style.borderColor = '#00b894';
      btn.style.color = '#00b894';
      btn.style.fontWeight = '700';
    } else if (i === choiceIdx && choiceIdx !== correctIdx) {
      btn.style.background = '#ffeaea';
      btn.style.borderColor = '#d63031';
      btn.style.color = '#d63031';
    }
  }
  const result = document.getElementById(`quiz-${quizIdx}-result`);
  if (result) {
    result.innerHTML = choiceIdx === correctIdx
      ? `<div style="color:#00b894;font-weight:700;font-size:13px;margin-bottom:8px">✅ 正解！</div>`
      : `<div style="color:#d63031;font-weight:700;font-size:13px;margin-bottom:8px">❌ 不正解。正解は ${['A','B','C','D'][correctIdx]} です。</div>`;
  }
}

function closeLessonMode(subjectId, unitId) {
  document.getElementById('sheet').classList.remove('lesson-mode');
  showUnitPicker(subjectId);
}

function updateUnit(subjectId, unitId) {
  const s = state.data.subjects.find(s => s.id === subjectId);
  const u = s?.units.find(u => u.id === unitId);
  if (!u) return;
  u.status = document.getElementById('ud-status').value;
  u.estimatedHours = parseFloat(document.getElementById('ud-hours').value) || 0;
  saveData(state.data);
  hideSheet();
  renderDetail();
  showToast('✓ 更新しました');
}

function deleteUnit(subjectId, unitId) {
  const s = state.data.subjects.find(s => s.id === subjectId);
  if (!s) return;
  s.units = s.units.filter(u => u.id !== unitId);
  saveData(state.data);
  hideSheet();
  renderDetail();
  showToast('削除しました');
}

// ── Delete Subject ────────────────────────
function deleteSubject(id) {
  if (!confirm('この科目と関連する記録をすべて削除しますか？')) return;
  state.data.subjects = state.data.subjects.filter(s => s.id !== id);
  state.data.logs = state.data.logs.filter(l => l.subjectId !== id);
  saveData(state.data);
  navigate('subjects');
  showToast('削除しました');
}

// ── AI API helper ─────────────────────────
// Priority: Worker URL > Groq API key > Gemini API key
async function callGemini(prompt) {
  const { geminiApiKey, groqApiKey, workerUrl } = state.data.settings;

  if (workerUrl) {
    // Cloudflare Worker (API key hidden server-side)
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Worker error ${res.status}`);
    }
    return res.json(); // Returns Gemini-format response
  }

  if (groqApiKey) {
    // Groq API (OpenAI-compatible, LLaMA 3 model)
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqApiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq error ${res.status}`);
    }
    const data = await res.json();
    // Normalize to Gemini-format so rest of code works unchanged
    const text = data.choices?.[0]?.message?.content || '{}';
    return { candidates: [{ content: { parts: [{ text }] } }] };
  }

  if (geminiApiKey) {
    // Direct Gemini call
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  throw new Error('APIキーが設定されていません');
}

// ── Gemini AI ─────────────────────────────
async function runAIPlan(subjectId) {
  const { geminiApiKey, groqApiKey, workerUrl } = state.data.settings;
  if (!geminiApiKey && !groqApiKey && !workerUrl) {
    showToast('設定タブでAPIキーを設定してください');
    navigate('settings');
    return;
  }

  const s = state.data.subjects.find(s => s.id === subjectId);
  if (!s) return;

  // 単元がなければまずAIに生成させる
  if (s.units.length === 0) {
    await generateUnitsAndPlan(s);
    return;
  }

  showAILoading(true);

  const deadline = s.deadline;
  const dl = daysLeft(deadline);
  const unitNames = s.units.map(u => u.name).join('、');

  const prompt = `あなたは優秀な学習コーチです。以下の情報をもとに最適な学習計画をJSON形式で作成してください。

科目: ${s.name}
目標: ${s.goal}
期限: ${deadline}（今日から${dl}日後）
学習単元: ${unitNames}
1日の目安学習時間: ${s.hoursPerDay}時間${s.level ? `
現在のレベル: ${s.level}（このレベルに合わせて単元の深さ・順序・時間配分を最適化すること）` : ''}

以下のJSON形式のみで回答してください（説明文不要）:
{
  "overview": "全体的な学習戦略と注意点（100字程度）",
  "dailyHoursRecommended": 2,
  "units": [
    {
      "name": "単元名（入力と完全一致させること）",
      "order": 1,
      "estimatedHours": 10,
      "studyMethod": "この単元の具体的な学習法（50字程度）"
    }
  ]
}

重要: unitsの名前は入力した単元名と完全一致させてください。orderは推奨学習順序(1から)。`;

  try {
    const data = await callGemini(prompt);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const plan = parseJSON(text);

    // Apply plan to subject
    s.aiPlan = {
      overview: plan.overview || '',
      dailyHoursRecommended: plan.dailyHoursRecommended || s.hoursPerDay,
      generatedAt: Date.now()
    };

    // Update units with AI data
    if (Array.isArray(plan.units)) {
      plan.units.forEach(pu => {
        const u = s.units.find(u => u.name === pu.name || u.name.includes(pu.name) || pu.name.includes(u.name));
        if (u) {
          u.order = pu.order ?? u.order;
          u.estimatedHours = pu.estimatedHours ?? u.estimatedHours;
          u.studyMethod = pu.studyMethod || u.studyMethod;
        }
      });
    }

    // Generate calendar schedule
    s.schedule = generateSchedule(s);
    saveData(state.data);
    showAILoading(false);
    renderDetail();
    showToast('✨ AIプランを作成しました');

  } catch (e) {
    showAILoading(false);
    console.error(e);
    showToast('エラー: ' + e.message);
  }
}

// フォームからAIに単元を提案してもらう（科目追加シート内）
async function suggestUnitsAI() {
  const { geminiApiKey, groqApiKey, workerUrl } = state.data.settings;
  if (!geminiApiKey && !groqApiKey && !workerUrl) { showToast('設定タブでAPIキーを設定してください'); return; }

  const name = document.getElementById('ns-name').value.trim();
  const goal = document.getElementById('ns-goal').value.trim();
  if (!name) { showToast('先に科目名を入力してください'); return; }

  showAILoading(true);
  try {
    const units = await fetchSuggestedUnits(name, goal || '習得・マスター');
    document.getElementById('ns-units').value = units.map(u => u.name).join('\n');
    showAILoading(false);
    showToast(`✨ ${units.length}個の単元を提案しました`);
  } catch (e) {
    showAILoading(false);
    showToast('エラー: ' + e.message);
  }
}

// 単元ゼロの科目に対してAIが単元生成→プラン生成
async function generateUnitsAndPlan(s) {
  showAILoading(true);
  try {
    const units = await fetchSuggestedUnits(s.name, s.goal, s.level || '');
    units.forEach((u, i) => {
      s.units.push({ id: uid(), name: u.name, order: i, estimatedHours: 0, studyMethod: '', status: 'not_started' });
    });
    saveData(state.data);
    showAILoading(false);
    showToast(`✨ ${units.length}個の単元を生成しました。続けてプランを作成します…`);
    // 少し待ってからプラン生成
    setTimeout(() => runAIPlan(s.id), 800);
  } catch (e) {
    showAILoading(false);
    showToast('エラー: ' + e.message);
  }
}

async function fetchSuggestedUnits(subjectName, goal, level = '') {
  const levelLine = level ? `\n学習者の現在のレベル: ${level}（このレベルを前提に、既知の内容は省略・圧縮し、必要な単元から始めること）` : '';
  const prompt = `あなたは優秀な学習コーチです。
科目「${subjectName}」で「${goal}」を達成するために必要な学習単元を、
目標達成までの順序で網羅的にリストアップしてください。
各分野の定番教材・カリキュラムを参考に、抜け漏れなく列挙してください。${levelLine}

以下のJSON形式のみで回答してください（説明文不要）:
{
  "units": [
    {"name": "単元名（簡潔に）", "estimatedHours": 5}
  ]
}`;

  const data = await callGemini(prompt);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = parseJSON(text);
  return parsed.units || [];
}

function parseJSON(text) {
  // Strip markdown code blocks if present
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(clean);
}

// ── Sheet / Overlay ───────────────────────
function showSheet(html) {
  document.getElementById('sheet-content').innerHTML = html;
  document.getElementById('sheet').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
}

function hideSheet() {
  const sheet = document.getElementById('sheet');
  sheet.classList.add('hidden');
  sheet.classList.remove('lesson-mode');
  document.getElementById('overlay').classList.add('hidden');
}

function showAILoading(show) {
  document.getElementById('ai-loading').classList.toggle('hidden', !show);
}

// ── Toast ─────────────────────────────────
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

// ── Boot ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Tab bar navigation
  document.getElementById('tabbar').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    const view = btn.dataset.view;
    if (view) navigate(view);
  });

  // Close sheet on overlay click
  document.getElementById('overlay').addEventListener('click', hideSheet);

  // Initial render
  renderView('home');
});
