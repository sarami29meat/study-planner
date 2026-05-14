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
  return { subjects: [], logs: [], settings: { geminiApiKey: '' } };
}

// ── State ─────────────────────────────────
const state = {
  view: 'home',
  detailSubjectId: null,
  logSubjectId: null,
  logUnitId: null,
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

  // Build today tasks from all subjects
  const todayTasks = subjects.flatMap(s => {
    const u = currentUnit(s);
    if (!u) return [];
    const rec = s.aiPlan?.dailyHoursRecommended || 1;
    return [{ subject: s.name, unit: u.name, method: u.studyMethod, hours: rec }];
  });

  let html = `
    <div style="padding-bottom:16px">
      <div class="today-card">
        <div class="today-date">${dateStr}</div>
        <div class="today-title">今日やること</div>
        <div class="today-sub">${subjects.length > 0 ? 'AIが提案する本日の学習' : 'まず科目を追加しよう！'}</div>
        ${todayTasks.length > 0 ? `
          <div class="today-task-list">
            ${todayTasks.map(t => `
              <div class="today-task-item">
                <div class="today-task-dot"></div>
                <div class="today-task-text">${t.subject} — ${t.unit}</div>
                <div class="today-task-time">${t.hours}時間</div>
              </div>
            `).join('')}
          </div>` : `<div class="today-empty">科目タブから科目を追加してください</div>`}
      </div>
  `;

  if (subjects.length > 0) {
    html += `<div class="card"><div class="card-title">科目の進捗</div>`;
    subjects.forEach(s => {
      const pct = subjectProgress(s);
      const todayMin = todayLoggedMinutes(s.id);
      html += `
        <div style="margin-bottom:14px">
          <div class="flex-between mb8">
            <div>
              <div style="font-weight:700;font-size:15px">${s.name}</div>
              <div class="text-small">${s.goal}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:20px;font-weight:700;color:var(--primary)">${pct}%</div>
              <div class="text-small">今日 ${minutesToHM(todayMin)}</div>
            </div>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="text-small mt4">残り ${daysLeft(s.deadline)} 日</div>
        </div>`;
    });
    html += `</div>`;

    // Recent logs
    const recent = [...state.data.logs]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
    if (recent.length > 0) {
      html += `<div class="card"><div class="card-title">最近の記録</div>`;
      recent.forEach(l => {
        const s = state.data.subjects.find(s => s.id === l.subjectId);
        const u = s?.units.find(u => u.id === l.unitId);
        if (!s) return;
        html += `
          <div class="log-entry">
            <div class="log-entry-icon">📖</div>
            <div class="log-entry-body">
              <div class="log-entry-title">${s.name} — ${u?.name || '不明'}</div>
              <div class="log-entry-sub">${formatDate(l.date)}${l.notes ? ' · ' + l.notes : ''}</div>
            </div>
            <div class="log-entry-time">${minutesToHM(l.minutes)}</div>
          </div>`;
      });
      html += `</div>`;
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
        <div class="empty-title">科目がありません</div>
        <div class="empty-sub">右上の＋ボタンで科目を追加してください。<br>AIが最適な学習プランを作ります。</div>
        <button class="btn btn-primary mt16" onclick="showAddSubject()">科目を追加</button>
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

    <button class="detail-ai-btn" onclick="runAIPlan('${s.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      ${s.aiPlan ? 'AIプランを再生成' : 'AIで学習プランを作成'}
    </button>`;

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
    html += `<div class="text-small text-center" style="padding:20px 0">単元を追加してください</div>`;
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
  const key = state.data.settings.geminiApiKey;
  const masked = key ? key.slice(0, 8) + '••••••••' : '未設定';

  el.innerHTML = `
    <div class="page-header"><div class="page-title">設定<span>.</span></div></div>

    <div style="padding:0 16px">
      <div class="settings-section">
        <div class="settings-section-title">Gemini API</div>
        <div class="card" style="margin:0">
          <div class="form-group" style="margin-bottom:12px">
            <label class="form-label">APIキー</label>
            <input type="password" class="form-input" id="api-key-input"
              placeholder="AIzaSy..." value="${key}">
          </div>
          <div class="text-small mb8" style="line-height:1.5">
            <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--primary)">Google AI Studio</a> で無料取得できます
          </div>
          <button class="btn btn-primary btn-full" onclick="saveApiKey()">保存</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">データ</div>
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
            iPhoneでホーム画面に追加すると<br>アプリとして使えます
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
    <div class="form-group">
      <label class="form-label">科目名</label>
      <input type="text" class="form-input" id="ns-name" placeholder="例: 英語、数学、プログラミング">
    </div>
    <div class="form-group">
      <label class="form-label">目標</label>
      <input type="text" class="form-input" id="ns-goal" placeholder="例: TOEIC 800点、応用情報合格">
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
    <div class="form-group">
      <div class="flex-between mb8">
        <label class="form-label" style="margin-bottom:0">学習単元（1行ずつ）</label>
        <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px" onclick="suggestUnitsAI()">
          ✨ AIに提案してもらう
        </button>
      </div>
      <textarea class="form-textarea" id="ns-units" placeholder="空欄でもOK。AIボタンで自動生成できます。&#10;または手動で1行ずつ入力：&#10;文法&#10;語彙&#10;リスニング" style="height:120px"></textarea>
    </div>
    <button class="btn btn-primary btn-full" onclick="addSubject()">追加する</button>
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
  const deadline = getDateFromSelects('ns-dl');
  const hoursPerDay = parseFloat(document.getElementById('ns-hours').value) || 2;
  const unitsRaw = document.getElementById('ns-units').value;

  if (!name) { showToast('科目名を入力してください'); return; }
  if (!goal) { showToast('目標を入力してください'); return; }
  if (!deadline) { showToast('期限を入力してください'); return; }

  const units = unitsRaw.split('\n')
    .map(l => l.trim()).filter(Boolean)
    .map((name, i) => ({
      id: uid(), name, order: i,
      estimatedHours: 0, studyMethod: '',
      status: 'not_started'
    }));

  const subject = {
    id: uid(), name, goal, deadline, hoursPerDay,
    createdAt: Date.now(), units, aiPlan: null
  };

  state.data.subjects.push(subject);
  saveData(state.data);
  hideSheet();
  navigate('detail', { subjectId: subject.id });
  showToast('✓ 科目を追加しました');
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
      <div class="ai-overview" style="margin-bottom:16px">
        <div class="ai-overview-title">📖 学習方法</div>
        ${u.studyMethod}
      </div>` : ''}
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

// ── Gemini AI ─────────────────────────────
async function runAIPlan(subjectId) {
  const apiKey = state.data.settings.geminiApiKey;
  if (!apiKey) {
    showToast('設定タブでGemini APIキーを設定してください');
    navigate('settings');
    return;
  }

  const s = state.data.subjects.find(s => s.id === subjectId);
  if (!s) return;

  // 単元がなければまずAIに生成させる
  if (s.units.length === 0) {
    await generateUnitsAndPlan(s, apiKey);
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
1日の目安学習時間: ${s.hoursPerDay}時間

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
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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

    const data = await res.json();
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
  const apiKey = state.data.settings.geminiApiKey;
  if (!apiKey) { showToast('設定タブでGemini APIキーを設定してください'); return; }

  const name = document.getElementById('ns-name').value.trim();
  const goal = document.getElementById('ns-goal').value.trim();
  if (!name) { showToast('先に科目名を入力してください'); return; }

  showAILoading(true);
  try {
    const units = await fetchSuggestedUnits(name, goal || '習得・マスター', apiKey);
    document.getElementById('ns-units').value = units.map(u => u.name).join('\n');
    showAILoading(false);
    showToast(`✨ ${units.length}個の単元を提案しました`);
  } catch (e) {
    showAILoading(false);
    showToast('エラー: ' + e.message);
  }
}

// 単元ゼロの科目に対してAIが単元生成→プラン生成
async function generateUnitsAndPlan(s, apiKey) {
  showAILoading(true);
  try {
    const units = await fetchSuggestedUnits(s.name, s.goal, apiKey);
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

async function fetchSuggestedUnits(subjectName, goal, apiKey) {
  const prompt = `あなたは優秀な学習コーチです。
科目「${subjectName}」で「${goal}」を達成するために必要な学習単元を、
初心者から目標達成までの順序で網羅的にリストアップしてください。
各分野の定番教材・カリキュラムを参考に、抜け漏れなく列挙してください。

以下のJSON形式のみで回答してください（説明文不要）:
{
  "units": [
    {"name": "単元名（簡潔に）", "estimatedHours": 5}
  ]
}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
  const data = await res.json();
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
  document.getElementById('sheet').classList.add('hidden');
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
