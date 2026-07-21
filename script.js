// ==========================================
// КЛЮЧІ ДОСТУПУ (Вже вставлені)
// ==========================================
const SUPABASE_URL = "https://evuoulaybxtrrhpsfvja.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2dW91bGF5Ynh0cnJocHNmdmphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NTE3NzYsImV4cCI6MjEwMDEyNzc3Nn0.I6AW6Pl9EO4c7scRmAAWV8OcMx_-YLR2wfBL0MJvkK0";
const ADMIN_SERVER_URL = "https://pedalos-adminsystem.onrender.com";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const STAGES = [
    { key: "clean", label: "Клін" }, { key: "translate", label: "Переклад" },
    { key: "edit", label: "Редактура" }, { key: "typeset", label: "Тайп" }, { key: "qc", label: "QC" }
];

let session = null, myProfile = null, myRoles = [], allRoles = [], allProfiles = [], myTitles = [], selectedTitleId = null, titleMembers = [], chapters = [], statuses = [];
let myJobPostings = [], unseenApplicationsByPosting = {}, notifyPollTimer = null;

function isAdmin() { return myRoles.includes('admin'); }
function isNewbie() { return myRoles.includes('newbie'); }
function isCuratorOf(titleId) { return isAdmin() || titleMembers.some(m => m.title_id === titleId && m.user_id === myProfile.id && m.role_key === 'title_curator'); }
function isAnyCurator() { return isAdmin() || myRoles.includes('title_curator') || myRoles.some(r => r.includes('curator')); }

// --- AUTH ---
document.getElementById('loginBtn').onclick = async () => {
    const login = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const email = `${login.toLowerCase().replace(/\s+/g, '_')}@pedalos.team`; 
    
    const errEl = document.getElementById('loginError');
    errEl.classList.add('hidden');

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { 
        errEl.textContent = 'Помилка: Невірний логін або пароль'; 
        errEl.classList.remove('hidden'); 
        return; 
    }
    session = data.session; await afterLogin();
};

// --- МЕНЮ ПРОФІЛЮ (дропдаун) ---
document.getElementById('userMenuTrigger').onclick = (e) => {
    e.stopPropagation();
    document.getElementById('userMenuDropdown').classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
    const dd = document.getElementById('userMenuDropdown');
    const trigger = document.getElementById('userMenuTrigger');
    if (!dd.classList.contains('hidden') && !dd.contains(e.target) && !trigger.contains(e.target)) {
        dd.classList.add('hidden');
    }
});
document.getElementById('userMenuProfileBtn').onclick = () => {
    document.getElementById('userMenuDropdown').classList.add('hidden');
    switchTab('profile');
};
document.getElementById('userMenuLogoutBtn').onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function afterLogin() {
    const { data: { user } } = await sb.auth.getUser();
    const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();
    const { data: roles } = await sb.from('user_roles').select('role_key').eq('user_id', user.id);
    const { data: rolesCatalog } = await sb.from('roles').select('*');

    myProfile = profile; 
    myRoles = (roles || []).map(r => r.role_key); 
    allRoles = rolesCatalog || [];

    if (myProfile.must_change_password) {
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('forcePasswordScreen').classList.remove('hidden');
        return;
    }

    enterApp();
}

function enterApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('forcePasswordScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    document.getElementById('userNameLabel').textContent = myProfile.display_name;
    document.getElementById('homeUserName').textContent = myProfile.display_name;

    document.getElementById('userRoleBadges').innerHTML = myRoles.map(r => {
        const label = allRoles.find(x => x.key === r)?.label || r;
        return `<span class="role-badge">${label}</span>`;
    }).join('');

    if (isAnyCurator()) document.getElementById('curatorTabBtn').classList.remove('hidden');

    if (isNewbie()) {
        document.getElementById('homeTabBtn').classList.add('hidden');
        document.getElementById('titlesTabBtn').classList.add('hidden');
        document.getElementById('curatorTabBtn').classList.add('hidden');
        document.getElementById('jobsTabBtn').classList.add('hidden');
        document.querySelectorAll('.tab-btn, .tab-panel').forEach(e => e.classList.remove('active'));
        document.getElementById('tabWelcome').classList.add('active');
    }

    loadData();

    if (notifyPollTimer) clearInterval(notifyPollTimer);
    notifyPollTimer = setInterval(refreshJobNotifications, 20000);
}

document.getElementById('forcePasswordBtn').onclick = async () => {
    const p1 = document.getElementById('newPassword1').value;
    const p2 = document.getElementById('newPassword2').value;
    const errEl = document.getElementById('forcePasswordError');
    errEl.classList.add('hidden');

    if (p1.length < 6) { errEl.textContent = 'Пароль має містити щонайменше 6 символів'; errEl.classList.remove('hidden'); return; }
    if (p1 !== p2) { errEl.textContent = 'Паролі не збігаються — введи однаково в обидва поля'; errEl.classList.remove('hidden'); return; }

    const { error: updateErr } = await sb.auth.updateUser({ password: p1 });
    if (updateErr) { errEl.textContent = updateErr.message; errEl.classList.remove('hidden'); return; }

    await sb.from('profiles').update({ must_change_password: false }).eq('id', myProfile.id);
    myProfile.must_change_password = false;
    enterApp();
};

// --- TABS ---
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn, .tab-panel').forEach(e => e.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');
    document.getElementById('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)).classList.add('active');
    if (tabName === 'home') loadHome();
    if (tabName === 'jobs') loadJobs();
    if (tabName === 'profile') loadProfile();
}
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
});

// --- ГОЛОВНА (зведення по команді) ---
async function loadHome() {
    const { data: allChapters } = await sb.from('chapters').select('id, number, title_id');
    const { data: allStatuses } = await sb.from('stage_status').select('chapter_id, stage, status, updated_at');

    const byChapter = {};
    (allStatuses || []).forEach(s => {
        if (!byChapter[s.chapter_id]) byChapter[s.chapter_id] = [];
        byChapter[s.chapter_id].push(s);
    });

    const completed = [];
    (allChapters || []).forEach(ch => {
        const rows = byChapter[ch.id] || [];
        if (rows.length === STAGES.length && rows.every(r => r.status === 'done')) {
            const completedAt = rows.reduce((max, r) => {
                const d = new Date(r.updated_at);
                return d > max ? d : max;
            }, new Date(0));
            completed.push({ chapter: ch, completedAt });
        }
    });
    completed.sort((a, b) => b.completedAt - a.completedAt);

    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const completedLastMonth = completed.filter(c => c.completedAt >= monthAgo).length;
    document.getElementById('homeCompletedCount').textContent = completedLastMonth;

    const lastLabel = document.getElementById('homeLastChapter');
    const lastDate = document.getElementById('homeLastChapterDate');
    if (completed.length > 0) {
        const last = completed[0];
        const tName = (allTitlesCache.find(t => t.id === last.chapter.title_id) || {}).name || `#${last.chapter.title_id}`;
        lastLabel.textContent = `${tName} — Розділ ${last.chapter.number}`;
        lastDate.textContent = last.completedAt.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } else {
        lastLabel.textContent = 'Ще немає завершених розділів';
        lastDate.textContent = '';
    }
}

// --- DATA LOAD ---
let allTitlesCache = [];
async function loadData() {
    const { data: t } = await sb.from('titles').select('*').order('name');
    myTitles = t || [];
    allTitlesCache = myTitles;
    const sel = document.getElementById('titleSelect');
    sel.innerHTML = myTitles.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    document.getElementById('noTitleState').classList.toggle('hidden', myTitles.length > 0);
    
    if (myTitles.length > 0) {
        selectedTitleId = myTitles[0].id;
        sel.value = selectedTitleId;
        await loadTitleData();
    }
    if (isAnyCurator()) await loadCuratorDashboard();
    await refreshJobNotifications();
    if (!isNewbie()) await loadHome();
}

document.getElementById('titleSelect').onchange = async (e) => { selectedTitleId = parseInt(e.target.value); await loadTitleData(); };

// --- ДЕТАЛІ ТАЙТЛА (Робоча зона) ---
async function loadTitleData() {
    document.getElementById('titleContent').classList.remove('hidden');
    const { data: mem } = await sb.from('title_members').select('*').eq('title_id', selectedTitleId);
    titleMembers = mem || [];
    const { data: profs } = await sb.from('profiles').select('*').eq('is_active', true);
    allProfiles = profs || [];

    const wrap = document.getElementById('titleMembers');
    const curator = isCuratorOf(selectedTitleId);
    document.getElementById('addMemberControls').classList.toggle('hidden', !curator);

    wrap.innerHTML = titleMembers.map(m => {
        const p = allProfiles.find(x => x.id === m.user_id);
        const rLabel = allRoles.find(r => r.key === m.role_key)?.label || m.role_key;
        let btn = curator ? `<button onclick="removeMember('${m.user_id}', '${m.role_key}')">✕</button>` : '';
        return `<span class="chip">${p ? p.display_name : '...'} · ${rLabel} ${btn}</span>`;
    }).join('');

    if (curator) {
        document.getElementById('addMemberUser').innerHTML = allProfiles.map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');
        document.getElementById('addMemberRole').innerHTML = allRoles.filter(r=>r.key !== 'admin').map(r => `<option value="${r.key}">${r.label}</option>`).join('');
    }

    const { data: ch } = await sb.from('chapters').select('*').eq('title_id', selectedTitleId).order('number');
    chapters = ch || [];
    const { data: st } = chapters.length ? await sb.from('stage_status').select('*').in('chapter_id', chapters.map(c=>c.id)) : {data:[]};
    statuses = st || [];
    
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';
    chapters.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })).forEach(ch => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><span class="chapter-label">Розділ ${ch.number}</span></td>`;
        
        STAGES.forEach(stage => {
            const td = document.createElement('td');
            const row = statuses.find(s => s.chapter_id === ch.id && s.stage === stage.key);
            const status = row ? row.status : 'not_started';
            const assignee = row && row.assignee ? row.assignee : '—';
            td.innerHTML = `<div class="cell-badge status-${status}" onclick="openPopover(${ch.id}, '${stage.key}', '${assignee}', '${status}')">
                <span class="cell-status-label">${status === 'not_started' ? 'Не почато' : status === 'in_progress' ? 'В процесі' : 'Готово'}</span>
                <span class="cell-assignee">${assignee}</span>
            </div>`;
            tr.appendChild(td);
        });

        const delTd = document.createElement('td');
        delTd.innerHTML = curator ? `<button onclick="deleteChapter(${ch.id})" class="text-gray-500 hover:text-red-400 text-xs px-2">✕</button>` : '';
        tr.appendChild(delTd);
        tbody.appendChild(tr);
    });
}

document.getElementById('addMemberBtn').onclick = async () => {
    const user_id = document.getElementById('addMemberUser').value;
    const role_key = document.getElementById('addMemberRole').value;
    await sb.from('title_members').insert({ title_id: selectedTitleId, user_id, role_key });
    await loadTitleData();
};

window.removeMember = async (uid, rKey) => {
    await sb.from('title_members').delete().eq('title_id', selectedTitleId).eq('user_id', uid).eq('role_key', rKey);
    await loadTitleData();
};

document.getElementById('addChapterBtn').onclick = async () => {
    const num = document.getElementById('newChapterNumber').value.trim();
    if (!num) return;
    const { data: nc } = await sb.from('chapters').insert({ number: num, title_id: selectedTitleId }).select().single();
    if (nc) {
        const rows = STAGES.map(s => ({ chapter_id: nc.id, stage: s.key, status: 'not_started' }));
        await sb.from('stage_status').insert(rows);
    }
    document.getElementById('newChapterNumber').value = '';
    await loadTitleData();
};

window.deleteChapter = async (id) => {
    if(!confirm('Видалити розділ?')) return;
    await sb.from('chapters').delete().eq('id', id);
    await loadTitleData();
};

// --- ПОПАП ---
let activeCell = null;
window.openPopover = (chapterId, stageKey, assignee, status) => {
    activeCell = { chapterId, stageKey };
    const cNum = chapters.find(c => c.id === chapterId)?.number;
    const sLab = STAGES.find(s => s.key === stageKey)?.label;
    document.getElementById('popoverTitle').textContent = `Розділ ${cNum} — ${sLab}`;
    
    const assigneeSelect = document.getElementById('popoverAssignee');
    const membersHere = titleMembers.filter(m => m.title_id === selectedTitleId);
    assigneeSelect.innerHTML = '<option value="">— не призначено —</option>' + membersHere.map(m => {
        const name = allProfiles.find(p => p.id === m.user_id)?.display_name || m.user_id;
        return `<option value="${name}">${name}</option>`;
    }).join('');
    
    assigneeSelect.value = assignee !== '—' ? assignee : '';
    document.getElementById('popoverStatus').value = status;
    document.getElementById('popoverBackdrop').classList.remove('hidden');
};

document.getElementById('popoverClose').onclick = () => document.getElementById('popoverBackdrop').classList.add('hidden');
document.getElementById('popoverBackdrop').addEventListener('click', (e) => { if (e.target.id === 'popoverBackdrop') document.getElementById('popoverBackdrop').classList.add('hidden'); });

document.getElementById('popoverSave').onclick = async () => {
    await sb.from('stage_status').upsert({
        chapter_id: activeCell.chapterId, stage: activeCell.stageKey,
        assignee: document.getElementById('popoverAssignee').value || null,
        status: document.getElementById('popoverStatus').value
    }, { onConflict: 'chapter_id,stage' });
    document.getElementById('popoverBackdrop').classList.add('hidden');
    await loadTitleData();
    if(isAnyCurator()) await loadCuratorDashboard(); 
};

// --- КЕРУВАННЯ ТАЙТЛАМИ (Аналітика) ---
async function loadCuratorDashboard() {
    document.getElementById('createTitleForm').classList.toggle('hidden', !isAdmin());
    const tbody = document.getElementById('curatorTitlesTableBody');
    tbody.innerHTML = '';
    
    const { data: allStatuses } = await sb.from('stage_status').select('updated_at, status, stage, chapter_id');
    const { data: allChapters } = await sb.from('chapters').select('id, title_id, number');

    myTitles.forEach(title => {
        const titleChapters = allChapters.filter(c => c.title_id === title.id);
        const chapIds = titleChapters.map(c => c.id);
        const titleStatuses = allStatuses.filter(s => chapIds.includes(s.chapter_id));
        
        titleStatuses.sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
        const lastUpdate = titleStatuses.length > 0 ? new Date(titleStatuses[0].updated_at).toLocaleString('uk-UA', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}) : 'Ще порожньо';
        
        let activeStage = 'Не визначено';
        const active = titleStatuses.find(s => s.status === 'in_progress');
        if (active) {
            const cNum = titleChapters.find(c => c.id === active.chapter_id)?.number;
            const sLabel = STAGES.find(x => x.key === active.stage)?.label;
            activeStage = `Розділ ${cNum} — ${sLabel}`;
        }

        const canEditDL = isAdmin();
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-bold">${title.name}</td>
            <td>
                ${canEditDL ? `<input type="text" class="w-24 bg-transparent border-b border-gray-600 px-1 text-xs text-center" value="${title.deadline_info || 'без'}" id="dl-${title.id}">
                <button onclick="updateDeadline(${title.id})" class="text-xs text-indigo-400 hover:text-indigo-300 ml-1">💾</button>` : `<span class="text-xs">${title.deadline_info || 'без'}</span>`}
            </td>
            <td class="text-xs text-gray-400">${lastUpdate}</td>
            <td class="text-xs text-yellow-400">${activeStage}</td>
        `;
        tbody.appendChild(tr);
    });
}

window.updateDeadline = async (id) => {
    const val = document.getElementById(`dl-${id}`).value;
    await sb.from('titles').update({ deadline_info: val }).eq('id', id);
    alert('Дедлайн збережено');
};

document.getElementById('addTitleBtn').onclick = async () => {
    const name = document.getElementById('newTitleName').value.trim();
    const dl = document.getElementById('newTitleDeadline').value.trim() || 'без';
    if (!name) return;
    await sb.from('titles').insert({ name, deadline_info: dl });
    document.getElementById('newTitleName').value = '';
    document.getElementById('newTitleDeadline').value = '';
    await loadData();
};

// --- БІРЖА ---
async function refreshJobNotifications() {
    unseenApplicationsByPosting = {};
    if (!myProfile) return;

    const { data: postings } = await sb.from('job_postings').select('id').eq('created_by', myProfile.id);
    myJobPostings = postings || [];
    const postingIds = myJobPostings.map(p => p.id);

    let unseenTotal = 0;
    if (postingIds.length) {
        const { data: unseen } = await sb.from('job_applications')
            .select('id, posting_id')
            .in('posting_id', postingIds)
            .eq('seen_by_curator', false);
        (unseen || []).forEach(a => {
            unseenApplicationsByPosting[a.posting_id] = (unseenApplicationsByPosting[a.posting_id] || 0) + 1;
            unseenTotal++;
        });
    }

    const navBadge = document.getElementById('jobsNavBadge');
    navBadge.textContent = '!';
    navBadge.classList.toggle('hidden', unseenTotal === 0);
}

async function loadJobs() {
    const { data: tICurator } = await sb.from('title_members').select('title_id').eq('user_id', myProfile.id).eq('role_key', 'title_curator');
    const curT = (tICurator || []).map(t => myTitles.find(x => x.id === t.title_id)).filter(Boolean);
    const canPost = isAdmin() || curT.length > 0;
    
    document.getElementById('curatorJobForm').classList.toggle('hidden', !canPost);
    if (canPost) {
        document.getElementById('jobTitleSelect').innerHTML = (isAdmin() ? myTitles : curT).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
        document.getElementById('jobRoleSelect').innerHTML = allRoles.filter(r=>r.key!=='admin').map(r => `<option value="${r.key}">${r.label}</option>`).join('');
    }

    await refreshJobNotifications();

    const mySection = document.getElementById('myJobsSection');
    const myList = document.getElementById('myJobsList');
    myList.innerHTML = '';
    if (myJobPostings.length > 0) {
        const { data: myFullPostings } = await sb.from('job_postings').select('*').in('id', myJobPostings.map(p => p.id)).order('created_at', { ascending: false });
        mySection.classList.remove('hidden');
        (myFullPostings || []).forEach(job => {
            const tName = myTitles.find(t => t.id === job.title_id)?.name || `#${job.title_id}`;
            const rLab = allRoles.find(r => r.key === job.role_needed)?.label || job.role_needed;
            const unseen = unseenApplicationsByPosting[job.id] || 0;
            const card = document.createElement('div');
            card.className = 'sub-card p-4 job-card clickable';
            card.innerHTML = `
                ${unseen > 0 ? '<span class="notify-dot">!</span>' : ''}
                <div class="font-bold text-sm mb-1">${tName}</div>
                <div class="role-badge inline-block mb-2">${rLab}</div>
                <p class="text-xs text-gray-400 mb-1">${job.note || ''}</p>
                <p class="text-xs ${job.status === 'open' ? 'text-green-400' : 'text-gray-500'}">${job.status === 'open' ? 'Відкрита' : 'Закрита'}</p>
            `;
            card.onclick = () => openApplicantsPopover(job);
            myList.appendChild(card);
        });
    } else {
        mySection.classList.add('hidden');
    }

    const { data: jobs } = await sb.from('job_postings').select('*').eq('status', 'open').order('created_at', { ascending: false });
    const list = document.getElementById('jobsList');
    list.innerHTML = '';
    const openJobs = (jobs || []).filter(j => j.created_by !== myProfile.id);
    document.getElementById('jobsEmptyState').classList.toggle('hidden', openJobs.length > 0);

    openJobs.forEach(job => {
        const tName = myTitles.find(t => t.id === job.title_id)?.name || `#${job.title_id}`;
        const rLab = allRoles.find(r => r.key === job.role_needed)?.label || job.role_needed;
        const card = document.createElement('div');
        card.className = 'sub-card p-4';
        card.innerHTML = `
            <div class="font-bold text-sm mb-1">${tName}</div>
            <div class="role-badge inline-block mb-2">${rLab}</div>
            <p class="text-xs text-gray-400 mb-3">${job.note || ''}</p>
            <button class="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition">Відгукнутися</button>
        `;
        card.querySelector('button').onclick = async () => {
            const { error } = await sb.from('job_applications').insert({ posting_id: job.id, applicant_id: myProfile.id });
            if (error) return alert(error.code === '23505' ? 'Ти вже відгукнувся.' : error.message);
            alert('Відгук надіслано!');
        };
        list.appendChild(card);
    });
}
document.getElementById('createJobBtn').onclick = async () => {
    const title_id = parseInt(document.getElementById('jobTitleSelect').value);
    const role_needed = document.getElementById('jobRoleSelect').value;
    const note = document.getElementById('jobNote').value.trim();
    await sb.from('job_postings').insert({ title_id, role_needed, note, created_by: myProfile.id });
    document.getElementById('jobNote').value = '';
    await loadJobs();
};

// --- ПОПАП ЗАЯВНИКІВ ---
let activeJob = null;
async function openApplicantsPopover(job) {
    activeJob = job;
    const tName = myTitles.find(t => t.id === job.title_id)?.name || `#${job.title_id}`;
    const rLab = allRoles.find(r => r.key === job.role_needed)?.label || job.role_needed;
    document.getElementById('applicantsPopoverTitle').textContent = `${tName} — ${rLab}`;

    const { data: apps } = await sb.from('job_applications').select('*').eq('posting_id', job.id).order('created_at', { ascending: true });
    const applicantIds = (apps || []).map(a => a.applicant_id);

    let applicantProfiles = [];
    let applicantRolesMap = {};
    if (applicantIds.length) {
        const { data: profs } = await sb.from('profiles').select('*').in('id', applicantIds);
        applicantProfiles = profs || [];
        const { data: rolesRows } = await sb.from('user_roles').select('*').in('user_id', applicantIds);
        (rolesRows || []).forEach(r => {
            if (!applicantRolesMap[r.user_id]) applicantRolesMap[r.user_id] = [];
            applicantRolesMap[r.user_id].push(allRoles.find(x => x.key === r.role_key)?.label || r.role_key);
        });
    }

    const listEl = document.getElementById('applicantsList');
    listEl.innerHTML = '';
    document.getElementById('applicantsEmpty').classList.toggle('hidden', (apps || []).length > 0);

    (apps || []).forEach(a => {
        const p = applicantProfiles.find(x => x.id === a.applicant_id);
        const joined = p?.created_at ? new Date(p.created_at).toLocaleDateString('uk-UA') : '—';
        const roleLabels = applicantRolesMap[a.applicant_id] || [];
        const row = document.createElement('div');
        row.className = 'sub-card p-3';
        row.innerHTML = `
            <div class="font-semibold text-sm">${p ? p.display_name : 'Користувач видалений'}</div>
            <div class="text-xs text-gray-400 mb-1">У команді з: ${joined}</div>
            <div class="flex gap-1 flex-wrap">${roleLabels.map(l => `<span class="role-badge">${l}</span>`).join('') || '<span class="text-xs text-gray-500">без ролей</span>'}</div>
        `;
        listEl.appendChild(row);
    });

    document.getElementById('applicantsPopoverBackdrop').classList.remove('hidden');

    if ((apps || []).some(a => !a.seen_by_curator)) {
        await sb.from('job_applications').update({ seen_by_curator: true }).eq('posting_id', job.id).eq('seen_by_curator', false);
        await refreshJobNotifications();
        await loadJobs();
    }
}
document.getElementById('applicantsPopoverClose').onclick = () => document.getElementById('applicantsPopoverBackdrop').classList.add('hidden');
document.getElementById('applicantsPopoverBackdrop').addEventListener('click', (e) => { if (e.target.id === 'applicantsPopoverBackdrop') document.getElementById('applicantsPopoverBackdrop').classList.add('hidden'); });
document.getElementById('closeJobBtn').onclick = async () => {
    if (!activeJob) return;
    if (!confirm('Закрити цю заявку на біржі?')) return;
    await sb.from('job_postings').update({ status: 'closed' }).eq('id', activeJob.id);
    document.getElementById('applicantsPopoverBackdrop').classList.add('hidden');
    await loadJobs();
};

// --- ПРОФІЛЬ ---
async function loadProfile() {
    document.getElementById('profileName').textContent = myProfile.display_name;
    const joined = myProfile.created_at ? new Date(myProfile.created_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    document.getElementById('profileMeta').textContent = `У команді з ${joined}`;

    document.getElementById('profileRoleBadges').innerHTML = myRoles.map(r => {
        const label = allRoles.find(x => x.key === r)?.label || r;
        return `<span class="role-badge">${label}</span>`;
    }).join('') || '<span class="text-xs text-gray-500">Ролей ще не призначено</span>';

    const { data: myMemberships } = await sb.from('title_members').select('*').eq('user_id', myProfile.id);
    const wrap = document.getElementById('profileTitlesList');
    wrap.innerHTML = '';
    document.getElementById('profileTitlesEmpty').classList.toggle('hidden', (myMemberships || []).length > 0);

    const { data: allTitlesForProfile } = await sb.from('titles').select('*');
    (myMemberships || []).forEach(m => {
        const t = (allTitlesForProfile || []).find(x => x.id === m.title_id);
        const rLabel = allRoles.find(r => r.key === m.role_key)?.label || m.role_key;
        const row = document.createElement('div');
        row.className = 'sub-card p-3 flex items-center justify-between';
        row.innerHTML = `<span class="font-semibold text-sm">${t ? t.name : `#${m.title_id}`}</span><span class="role-badge">${rLabel}</span>`;
        wrap.appendChild(row);
    });

    const adminSection = document.getElementById('adminSectionInProfile');
    adminSection.classList.toggle('hidden', !isAdmin());
    if (isAdmin()) await loadAdmin();
}

// --- АДМІН-ПАНЕЛЬ ---
function adminHeaders() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` }; }

async function loadAdmin() {
    const rList = document.getElementById('systemRolesList');
    rList.innerHTML = allRoles.map(r => `<span class="chip">${r.label} <span class="id-tag">${r.key}</span></span>`).join('');

    const { data: everyProfile } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
    const allProfilesForAdmin = everyProfile || [];

    const { data: allUserRoles } = await sb.from('user_roles').select('*');
    const list = document.getElementById('usersList');
    list.innerHTML = '';

    allProfilesForAdmin.forEach(p => {
        const rolesForUser = allUserRoles.filter(r => r.user_id === p.id).map(r => r.role_key);
        const row = document.createElement('div');
        row.className = 'sub-card p-3 flex items-center justify-between flex-wrap gap-2';
        row.innerHTML = `
            <div>
                <div class="font-semibold text-sm">${p.display_name} ${p.is_active ? '' : '<span class="text-red-400 text-xs">(деактивовано)</span>'}</div>
                <div class="flex gap-1 flex-wrap mt-1" id="roles-${p.id}"></div>
            </div>
            <div class="flex gap-2 items-center">
                <select class="role-add-select max-w-[160px] text-xs" data-uid="${p.id}"></select>
                <button class="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded-lg transition deactivate-btn" data-active="${p.is_active}">${p.is_active ? 'Деактивувати' : 'Активувати'}</button>
                <button class="text-xs text-gray-500 hover:text-red-400 px-2 delete-btn">Видалити</button>
            </div>
        `;
        list.appendChild(row);

        const rolesWrap = row.querySelector(`#roles-${p.id}`);
        rolesForUser.forEach(rk => {
            const label = allRoles.find(r => r.key === rk)?.label || rk;
            const chip = document.createElement('span');
            chip.className = 'role-badge';
            chip.innerHTML = `${label} <button style="margin-left:4px;color:#f87171;cursor:pointer;">✕</button>`;
            chip.querySelector('button').onclick = async () => {
                await sb.from('user_roles').delete().eq('user_id', p.id).eq('role_key', rk);
                await loadAdmin();
            };
            rolesWrap.appendChild(chip);
        });

        const addSel = row.querySelector('.role-add-select');
        addSel.innerHTML = '<option value="">+ додати роль</option>' + allRoles.filter(r => !rolesForUser.includes(r.key)).map(r => `<option value="${r.key}">${r.label}</option>`).join('');
        addSel.onchange = async () => {
            if (!addSel.value) return;
            await sb.from('user_roles').insert({ user_id: p.id, role_key: addSel.value });
            await loadAdmin();
        };

        row.querySelector('.deactivate-btn').onclick = async () => {
            const nowActive = row.querySelector('.deactivate-btn').dataset.active === 'true';
            await fetch(`${ADMIN_SERVER_URL}/admin/deactivate-user/${p.id}`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ is_active: !nowActive }) });
            await loadData();
        };
        row.querySelector('.delete-btn').onclick = async () => {
            if (!confirm(`Видалити акаунт "${p.display_name}"? Дані неможливо відновити.`)) return;
            await fetch(`${ADMIN_SERVER_URL}/admin/delete-user/${p.id}`, { method: 'DELETE', headers: adminHeaders() });
            await loadData();
        };
    });
}

document.getElementById('createRoleBtn').onclick = async () => {
    const key = document.getElementById('newRoleKey').value.trim();
    const label = document.getElementById('newRoleLabel').value.trim();
    if(!key || !label) return;
    await sb.from('roles').insert({ key, label });
    document.getElementById('newRoleKey').value = ''; document.getElementById('newRoleLabel').value = '';
    const { data } = await sb.from('roles').select('*'); allRoles = data; 
    await loadAdmin();
};

document.getElementById('createUserBtn').onclick = async () => {
    const login = document.getElementById('newUserLogin').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const display_name = document.getElementById('newUserName').value.trim();
    const msg = document.getElementById('createUserMsg');
    
    msg.textContent = 'Створюємо...'; msg.className = 'text-xs mt-2 text-gray-400';
    
    const res = await fetch(`${ADMIN_SERVER_URL}/admin/create-user`, {
        method: 'POST', headers: adminHeaders(), body: JSON.stringify({ username: login, password, display_name })
    });
    const data = await res.json();
    
    if (data.error) { msg.textContent = data.error; msg.className = 'text-xs mt-2 text-red-400'; return; }
    
    msg.textContent = `Акаунт ${data.display_name} створено! Логін: ${data.username}`; 
    msg.className = 'text-xs mt-2 text-green-400';
    
    document.getElementById('newUserLogin').value = '';
    document.getElementById('newUserPassword').value = '';
    document.getElementById('newUserName').value = '';
    
    await loadData(); 
};

// Init
(async function init() {
    const { data } = await sb.auth.getSession();
    if (data.session) { session = data.session; await afterLogin(); }
})();