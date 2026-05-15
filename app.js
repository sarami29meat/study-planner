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
  return { subjects: [], logs: [], settings: { geminiApiKey: '', groqApiKey: '', workerUrl: '' } };
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

  let html = `<div style="padding-bottom:16px">`;

  if (!state.data.settings.geminiApiKey) {
    html += `
      <div onclick="navigate('settings')" class="api-key-banner">
        <div class="api-key-banner-icon">🤖</div>
        <div class="api-key-banner-body">
          <div class="api-key-banner-title">AI機能を有効にしよう</div>
          <div class="api-key-banner-sub">タップして無料のAPIキーを設定（3ステップ・無料）</div>
        </div>
        <div class="api-key-banner-arrow">›</div>
      </div>`;
  }

  html += `
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
          </div>` : subjects.length === 0 ? `
          <div class="today-empty-cta">
            <div style="font-size:13px;opacity:0.9;margin-bottom:10px">科目を追加するだけで、AIが学習プランを自動作成します</div>
            <button class="today-add-btn" onclick="navigate('subjects');setTimeout(showAddSubject,100)">
              ＋ 最初の科目を追加する
            </button>
          </div>` : `<div class="today-empty">学習を記録すると今日のタスクが表示されます</div>`}
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
  const deadline = getDateFromSelects('ns-dl');
  const hoursPerDay = parseFloat(document.getElementById('ns-hours').value) || 2;

  if (!name) { showToast('科目名を入力してください'); return; }
  if (!goal) { showToast('目標を入力してください'); return; }
  if (!deadline) { showToast('期限を入力してください'); return; }

  const subject = {
    id: uid(), name, goal, deadline, hoursPerDay,
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
    const units = await fetchSuggestedUnits(s.name, s.goal);
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

async function fetchSuggestedUnits(subjectName, goal) {
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
