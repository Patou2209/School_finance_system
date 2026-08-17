// ============================================================================
// Logique frontend de l'espace ADMIN ECOLE
// ============================================================================
let currentUser = null
let currentSchool = null
let schoolYears = []
let trimesters = []
let classesCache = []

async function init() {
  const data = await guardAuth(['admin'])
  if (!data) return
  currentUser = data.user
  currentSchool = data.school
  document.getElementById('user-info').innerHTML = `<i class="fas fa-user-circle mr-1"></i>${escapeHtml(data.user.name)}`
  document.getElementById('school-name-label').textContent = data.school ? data.school.name : 'École'
  document.getElementById('perc-date').value = todayStr()

  setupTabs()
  await refreshCoreData()
  await loadDashboard()
  await loadYears()
  await loadClasses()
  await loadStaff()
  await loadFeesTable()
  populateStudentClassFilter()
  populatePerceptionSelectors()
  populateDebtSelectors()
  populateBudgetSelectors()
  buildReportTabs()
}

function setupTabs() {
  document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
    link.addEventListener('click', async () => {
      document.querySelectorAll('.nav-link[data-tab]').forEach(l => l.classList.remove('active'))
      link.classList.add('active')
      document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'))
      document.getElementById('tab-' + link.dataset.tab).classList.remove('hidden')
      if (link.dataset.tab === 'students') await loadStudents()
      if (link.dataset.tab === 'cashbook') await loadCashbook()
      if (link.dataset.tab === 'budget') await loadBudget()
      if (link.dataset.tab === 'perception') {
        currentPerceptionClass = null
        document.getElementById('perception-detail-view').classList.add('hidden')
        document.getElementById('perception-classes-view').classList.remove('hidden')
        await loadPerceptionClasses()
      }
      if (link.dataset.tab === 'debts') {
        currentDebtsClass = null
        document.getElementById('debts-detail-view').classList.add('hidden')
        document.getElementById('debts-classes-view').classList.remove('hidden')
        await loadDebtsClasses()
      }
    })
  })
}

async function refreshCoreData() {
  const yearsRes = await Api.get('/api/admin/school-years')
  schoolYears = yearsRes.school_years
  const trimRes = await Api.get('/api/admin/trimesters')
  trimesters = trimRes.trimesters
  const classesRes = await Api.get('/api/admin/classes')
  classesCache = classesRes.classes
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------
async function loadDashboard() {
  const d = await Api.get('/api/admin/dashboard')
  const stats = [
    { label: 'Classes', value: d.classes, icon: 'fa-chalkboard', color: 'text-blue-600' },
    { label: 'Élèves', value: d.students, icon: 'fa-user-graduate', color: 'text-indigo-600' },
    { label: 'Personnel', value: d.staff, icon: 'fa-users', color: 'text-purple-600' },
    { label: "Perçu aujourd'hui", value: fmtMoney(d.today_collected, currentSchool?.currency), icon: 'fa-calendar-day', color: 'text-green-600' },
    { label: 'Total perçu', value: fmtMoney(d.total_collected, currentSchool?.currency), icon: 'fa-coins', color: 'text-amber-600' }
  ]
  document.getElementById('dash-stats').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="flex items-center justify-between mb-2"><span class="text-xs font-medium text-slate-500">${s.label}</span><i class="fas ${s.icon} ${s.color}"></i></div>
      <p class="text-xl font-bold text-slate-800">${s.value}</p>
    </div>`).join('')
}

// ---------------------------------------------------------------------------
// ANNEES SCOLAIRES
// ---------------------------------------------------------------------------
async function loadYears() {
  const { school_years } = await Api.get('/api/admin/school-years')
  schoolYears = school_years
  const rows = await Promise.all(school_years.map(async y => {
    const { trimesters: ts } = await Api.get(`/api/admin/trimesters?school_year_id=${y.id}`)
    return `<tr>
      <td class="font-medium">${escapeHtml(y.label)}</td>
      <td>${y.is_current ? '<span class="badge badge-green">Année en cours</span>' : '<span class="badge badge-gray">Archivée</span>'}</td>
      <td>${ts.map(t => `<span class="badge badge-blue mr-1">${escapeHtml(t.name)}</span>`).join('')}</td>
      <td>${y.is_current ? '' : `<button onclick="setCurrentYear(${y.id})" class="text-blue-600 hover:underline text-xs font-semibold">Définir comme courante</button>`}</td>
    </tr>`
  }))
  document.getElementById('years-tbody').innerHTML = rows.join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-6">Aucune année scolaire</td></tr>'
}

function showCreateYearModal() {
  const nextStart = new Date().getFullYear()
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-calendar mr-2 text-blue-600"></i>Nouvelle année scolaire</h3>
      <form id="create-year-form" class="space-y-3">
        <div>
          <label class="text-xs font-medium text-slate-600">Année de début *</label>
          <input required type="number" id="cy-start-year" value="${nextStart}" min="2000" max="2100" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
          <p class="text-xs text-slate-400 mt-1">En RDC, une année scolaire couvre toujours deux années consécutives (ex : <span id="cy-preview" class="font-semibold">${nextStart}-${nextStart + 1}</span>)</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Début</label><input type="date" id="cy-start" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Fin</label><input type="date" id="cy-end" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="cy-current" checked> Définir comme année scolaire courante</label>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Créer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('cy-start-year').addEventListener('input', (e) => {
    const y = parseInt(e.target.value, 10)
    document.getElementById('cy-preview').textContent = isNaN(y) ? '—' : `${y}-${y + 1}`
  })
  document.getElementById('create-year-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const y = parseInt(document.getElementById('cy-start-year').value, 10)
      if (isNaN(y)) { toast('Année de début invalide', 'error'); return }
      const label = `${y}-${y + 1}`
      await Api.post('/api/admin/school-years', {
        label,
        start_date: document.getElementById('cy-start').value || null,
        end_date: document.getElementById('cy-end').value || null,
        set_current: document.getElementById('cy-current').checked
      })
      toast(`Année scolaire ${label} créée`, 'success')
      closeModal()
      await refreshCoreData()
      await loadYears()
      populatePerceptionSelectors(); populateDebtSelectors(); populateBudgetSelectors()
    } catch (err) { toast(err.message, 'error') }
  })
}

async function setCurrentYear(id) {
  try {
    await Api.patch(`/api/admin/school-years/${id}/set-current`)
    toast('Année scolaire courante mise à jour', 'success')
    await refreshCoreData()
    await loadYears()
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// CLASSES
// ---------------------------------------------------------------------------
async function loadClasses() {
  const { classes } = await Api.get('/api/admin/classes')
  classesCache = classes
  document.getElementById('classes-tbody').innerHTML = classes.map(cl => `
    <tr>
      <td class="font-medium">${escapeHtml(cl.name)}</td>
      <td>${escapeHtml(cl.level || '—')}</td>
      <td>${cl.student_count}</td>
      <td>${cl.teacher_count}</td>
      <td>${cl.percepteur_count}</td>
      <td>
        ${cl.login_email
          ? `<span class="text-xs text-slate-600">${escapeHtml(cl.login_email)}</span> ${cl.login_active ? '<span class="badge badge-green ml-1">Actif</span>' : '<span class="badge badge-gray ml-1">Inactif</span>'}`
          : '<span class="text-xs text-slate-400">—</span>'}
      </td>
      <td class="space-x-2 whitespace-nowrap">
        <button onclick="openClassAsAdmin(${cl.id})" class="text-emerald-600 hover:underline text-xs font-semibold"><i class="fas fa-door-open"></i> Ouvrir</button>
        <button onclick="viewClassDetail(${cl.id})" class="text-slate-700 hover:underline text-xs font-semibold"><i class="fas fa-eye"></i> Voir</button>
        <button onclick="manageClassAssignments(${cl.id}, '${escapeHtml(cl.name)}')" class="text-blue-600 hover:underline text-xs font-semibold"><i class="fas fa-user-plus"></i> Affecter</button>
        <button onclick="showClassLoginEditModal(${cl.id}, '${escapeHtml(cl.name)}', '${escapeHtml(cl.login_email || '')}')" class="text-amber-600 hover:underline text-xs font-semibold"><i class="fas fa-key"></i> Identifiants</button>
        <button onclick="deleteClass(${cl.id})" class="text-red-600 hover:underline text-xs font-semibold"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="text-center text-slate-400 py-6">Aucune classe créée</td></tr>'
}

async function openClassAsAdmin(classId) {
  try {
    await Api.post(`/api/admin/classes/${classId}/impersonate`)
    window.location.href = '/static/classe.html'
  } catch (err) { toast(err.message, 'error') }
}

function showClassLoginModal(className, email, password) {
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-key mr-2 text-amber-600"></i>Identifiants de connexion — ${escapeHtml(className)}</h3>
      <p class="text-sm text-slate-500 mb-4">Communiquez ces identifiants à la classe (ou au percepteur affecté) pour qu'elle puisse se connecter à son espace de consultation. Le mot de passe ne sera plus jamais affiché : notez-le maintenant.</p>
      <div class="bg-slate-50 rounded-lg p-4 space-y-2 text-sm mb-4">
        <div class="flex justify-between"><span class="text-slate-500">Email</span><span class="font-mono font-semibold">${escapeHtml(email)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Mot de passe</span><span class="font-mono font-semibold">${escapeHtml(password)}</span></div>
      </div>
      <div class="flex justify-end gap-2">
        <button onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold">J'ai noté, fermer</button>
      </div>
    </div>`)
}

function showClassLoginEditModal(classId, className, currentEmail) {
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-key mr-2 text-amber-600"></i>Identifiants de connexion — ${escapeHtml(className)}</h3>
      <p class="text-sm text-slate-500 mb-4">Définissez ou modifiez l'email et le mot de passe de connexion de cette classe. Laissez le mot de passe vide pour ne changer que l'email.</p>
      <form id="class-login-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Email de connexion *</label><input required type="email" id="cl-email" value="${escapeHtml(currentEmail)}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div><label class="text-xs font-medium text-slate-600">Nouveau mot de passe ${currentEmail ? '(laisser vide pour ne pas changer)' : '*'}</label><input ${currentEmail ? '' : 'required'} id="cl-password" placeholder="Min. 4 caractères" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('class-login-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const email = document.getElementById('cl-email').value
      const password = document.getElementById('cl-password').value
      const result = await Api.patch(`/api/admin/classes/${classId}/login`, { email, password: password || undefined })
      toast('Identifiants de la classe mis à jour', 'success')
      closeModal()
      await loadClasses()
      if (result.class_login && result.class_login.password) {
        showClassLoginModal(className, result.class_login.email, result.class_login.password)
      }
    } catch (err) { toast(err.message, 'error') }
  })
}

async function viewClassDetail(classId) {
  try {
    const data = await Api.get(`/api/admin/classes/${classId}/detail`)
    const cl = data.class
    openModal(`
      <div class="p-6 max-h-[80vh] overflow-y-auto">
        <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-chalkboard mr-2 text-blue-600"></i>${escapeHtml(cl.name)}</h3>
        <p class="text-sm text-slate-500 mb-4">${escapeHtml(cl.level || 'Niveau non précisé')}</p>

        <div class="grid grid-cols-3 gap-3 mb-5 text-center">
          <div class="bg-slate-50 rounded-lg p-3"><p class="text-xs text-slate-500">Élèves</p><p class="font-bold text-lg">${data.students.length}</p></div>
          <div class="bg-slate-50 rounded-lg p-3"><p class="text-xs text-slate-500">Enseignants</p><p class="font-bold text-lg">${data.teachers.length}</p></div>
          <div class="bg-slate-50 rounded-lg p-3"><p class="text-xs text-slate-500">Percepteurs</p><p class="font-bold text-lg">${data.percepteurs.length}</p></div>
        </div>

        <div class="mb-5">
          <p class="text-xs font-semibold text-slate-500 mb-2">Compte de connexion de la classe</p>
          ${data.login_account
            ? `<div class="bg-slate-50 rounded-lg px-3 py-2 text-sm flex justify-between items-center">
                 <span class="font-mono">${escapeHtml(data.login_account.email)}</span>
                 ${data.login_account.active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}
               </div>`
            : '<p class="text-xs text-slate-400">Aucun compte (utilisez le bouton "Mdp" pour en créer un)</p>'}
        </div>

        <div class="mb-5">
          <p class="text-xs font-semibold text-slate-500 mb-2">Frais scolaires fixés</p>
          <table class="data-table"><thead><tr><th>Trimestre</th><th>Montant</th></tr></thead>
            <tbody>${data.fee_structures.map(f => `<tr><td>${escapeHtml(f.trimester_name)}</td><td>${fmtMoney(f.montant, currentSchool?.currency)}</td></tr>`).join('') || '<tr><td colspan="2" class="text-center text-slate-400 py-3">Aucun frais fixé</td></tr>'}</tbody>
          </table>
        </div>

        <div class="mb-5">
          <p class="text-xs font-semibold text-slate-500 mb-2">Élèves (${data.students.length})</p>
          <table class="data-table"><thead><tr><th>Nom</th><th>Post-nom</th></tr></thead>
            <tbody>${data.students.map(s => `<tr><td class="font-medium">${escapeHtml(s.nom)}</td><td>${escapeHtml(s.post_nom)}</td></tr>`).join('') || '<tr><td colspan="2" class="text-center text-slate-400 py-3">Aucun élève</td></tr>'}</tbody>
          </table>
        </div>

        <div class="mb-2">
          <p class="text-xs font-semibold text-slate-500 mb-2">Derniers paiements (${data.recent_payments.length})</p>
          <table class="data-table"><thead><tr><th>Date</th><th>Élève</th><th>Montant</th><th>Reçu</th><th>Percepteur</th></tr></thead>
            <tbody>${data.recent_payments.map(p => `<tr><td>${fmtDate(p.date_paiement)}</td><td class="font-medium">${escapeHtml(p.nom)} ${escapeHtml(p.post_nom)}</td><td class="text-green-600">${fmtMoney(p.montant, currentSchool?.currency)}</td><td class="text-xs">${escapeHtml(p.receipt_number)}</td><td class="text-xs">${escapeHtml(p.percepteur_name)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-3">Aucun paiement enregistré</td></tr>'}</tbody>
          </table>
        </div>

        <div class="flex justify-end pt-3"><button onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg bg-slate-800 text-white font-semibold">Fermer</button></div>
      </div>`)
  } catch (err) { toast(err.message, 'error') }
}

const CLASS_ORDINALS = ['1ère', '2ème', '3ème', '4ème', '5ème', '6ème', '7ème','8ème']
const CLASS_LEVELS = ['CTEB', 'Humanitaire', 'Primaire']

function showCreateClassModal() {
  const currentYear = schoolYears.find(y => y.is_current) || schoolYears[0]
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-chalkboard mr-2 text-blue-600"></i>Nouvelle classe</h3>
      <form id="create-class-form" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Nom de la classe *</label>
            <select required id="cc-ordinal" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
              ${CLASS_ORDINALS.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
          </div>
          <div><label class="text-xs font-medium text-slate-600">Étiquette</label><input id="cc-label" placeholder="ex: A" maxlength="5" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Niveau</label>
          <select id="cc-level" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
            <option value="">— Choisir —</option>
            ${CLASS_LEVELS.map(l => `<option value="${l}">${l}</option>`).join('')}
          </select>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Année scolaire *</label>
          <select id="cc-year" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
            ${schoolYears.map(y => `<option value="${y.id}" ${currentYear && y.id === currentYear.id ? 'selected' : ''}>${escapeHtml(y.label)}</option>`).join('')}
          </select>
        </div>
        <hr>
        <p class="text-xs font-semibold text-slate-500">Identifiants de connexion de la classe</p>
        <div><label class="text-xs font-medium text-slate-600">Email de connexion *</label><input required type="email" id="cc-login-email" placeholder="6emea@ecole.local" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div><label class="text-xs font-medium text-slate-600">Mot de passe *</label><input required id="cc-login-password" placeholder="Min. 4 caractères" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Créer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('create-class-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const ordinal = document.getElementById('cc-ordinal').value
      const label = document.getElementById('cc-label').value.trim()
      const className = label ? `${ordinal} ${label}` : ordinal
      const loginEmail = document.getElementById('cc-login-email').value
      const loginPassword = document.getElementById('cc-login-password').value
      const result = await Api.post('/api/admin/classes', {
        name: className,
        level: document.getElementById('cc-level').value,
        school_year_id: document.getElementById('cc-year').value,
        login_email: loginEmail,
        login_password: loginPassword
      })
      toast('Classe créée', 'success')
      closeModal()
      await loadClasses()
      populateStudentClassFilter(); populatePerceptionSelectors(); populateDebtSelectors(); await loadFeesTable()
      if (result.class_login) {
        showClassLoginModal(className, result.class_login.email, result.class_login.password)
      }
    } catch (err) { toast(err.message, 'error') }
  })
}

async function deleteClass(id) {
  if (!confirm('Supprimer cette classe et tous ses élèves associés ?')) return
  try {
    await Api.del(`/api/admin/classes/${id}`)
    toast('Classe supprimée', 'success')
    await loadClasses()
    populateStudentClassFilter(); populatePerceptionSelectors(); populateDebtSelectors()
  } catch (err) { toast(err.message, 'error') }
}

async function manageClassAssignments(classId, className) {
  const [assignRes, staffRes] = await Promise.all([
    Api.get(`/api/admin/classes/${classId}/assignments`),
    Api.get('/api/admin/staff')
  ])
  const teachers = staffRes.staff.filter(s => s.role === 'enseignant')
  const percepteurs = staffRes.staff.filter(s => s.role === 'percepteur')

  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-user-plus mr-2 text-blue-600"></i>Affectations — ${escapeHtml(className)}</h3>

      <div class="mb-5">
        <p class="text-xs font-semibold text-slate-500 mb-2">Enseignants affectés</p>
        <div class="space-y-1 mb-2" id="assign-teachers-list">
          ${assignRes.teachers.map(t => `<div class="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded text-sm">
            <span>${escapeHtml(t.name)} ${t.is_titulaire ? '<span class="badge badge-blue ml-1">Titulaire</span>' : ''}</span>
            <button onclick="removeTeacherAssignment(${classId}, ${t.id}, '${escapeHtml(className)}')" class="text-red-500 text-xs"><i class="fas fa-times"></i></button>
          </div>`).join('') || '<p class="text-xs text-slate-400">Aucun enseignant affecté</p>'}
        </div>
        <div class="flex gap-2">
          <select id="add-teacher-select" class="flex-1 px-3 py-2 border rounded-lg text-sm">
            <option value="">— Choisir un enseignant —</option>
            ${teachers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
          </select>
          <button onclick="addTeacherAssignment(${classId}, '${escapeHtml(className)}')" class="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">Ajouter</button>
        </div>
      </div>

      <hr class="mb-5">

      <div>
        <p class="text-xs font-semibold text-slate-500 mb-2">Percepteurs affectés (au moins 1 requis pour percevoir)</p>
        <div class="space-y-1 mb-2" id="assign-percepteurs-list">
          ${assignRes.percepteurs.map(p => `<div class="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded text-sm">
            <span>${escapeHtml(p.name)}</span>
            <button onclick="removePercepteurAssignment(${classId}, ${p.id}, '${escapeHtml(className)}')" class="text-red-500 text-xs"><i class="fas fa-times"></i></button>
          </div>`).join('') || '<p class="text-xs text-slate-400">Aucun percepteur affecté</p>'}
        </div>
        <div class="flex gap-2">
          <select id="add-percepteur-select" class="flex-1 px-3 py-2 border rounded-lg text-sm">
            <option value="">— Choisir un percepteur —</option>
            ${percepteurs.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
          </select>
          <button onclick="addPercepteurAssignment(${classId}, '${escapeHtml(className)}')" class="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">Ajouter</button>
        </div>
      </div>

      <div class="flex justify-end pt-5"><button onclick="closeModal(); loadClasses();" class="px-4 py-2 text-sm rounded-lg bg-slate-800 text-white font-semibold">Fermer</button></div>
    </div>`)
}

async function addTeacherAssignment(classId, className) {
  const teacherId = document.getElementById('add-teacher-select').value
  if (!teacherId) return toast('Sélectionnez un enseignant', 'error')
  try {
    await Api.post(`/api/admin/classes/${classId}/teachers`, { teacher_id: teacherId, is_titulaire: true })
    toast('Enseignant affecté', 'success')
    manageClassAssignments(classId, className)
  } catch (err) { toast(err.message, 'error') }
}
async function removeTeacherAssignment(classId, teacherId, className) {
  try {
    await Api.del(`/api/admin/classes/${classId}/teachers/${teacherId}`)
    manageClassAssignments(classId, className)
  } catch (err) { toast(err.message, 'error') }
}
async function addPercepteurAssignment(classId, className) {
  const percepteurId = document.getElementById('add-percepteur-select').value
  if (!percepteurId) return toast('Sélectionnez un percepteur', 'error')
  try {
    await Api.post(`/api/admin/classes/${classId}/percepteurs`, { percepteur_id: percepteurId })
    toast('Percepteur affecté', 'success')
    manageClassAssignments(classId, className)
  } catch (err) { toast(err.message, 'error') }
}
async function removePercepteurAssignment(classId, percepteurId, className) {
  try {
    await Api.del(`/api/admin/classes/${classId}/percepteurs/${percepteurId}`)
    manageClassAssignments(classId, className)
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// ELEVES
// ---------------------------------------------------------------------------
function populateStudentClassFilter() {
  const sel = document.getElementById('students-class-filter')
  sel.innerHTML = '<option value="">Toutes les classes</option>' + classesCache.map(cl => `<option value="${cl.id}">${escapeHtml(cl.name)}</option>`).join('')
  sel.onchange = loadStudents
}

async function loadStudents() {
  const classId = document.getElementById('students-class-filter').value
  const url = classId ? `/api/admin/students?class_id=${classId}` : '/api/admin/students'
  const { students } = await Api.get(url)
  document.getElementById('students-tbody').innerHTML = students.map(s => `
    <tr>
      <td class="font-medium">${escapeHtml(s.nom)}</td>
      <td>${escapeHtml(s.post_nom)}</td>
      <td>${escapeHtml(s.prenom || '—')}</td>
      <td>${s.sexe || '—'}</td>
      <td><button onclick="deleteStudent(${s.id})" class="text-red-600 hover:underline text-xs font-semibold"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucun élève. L\'ajout et l\'import se font depuis l\'espace de connexion de chaque classe.</td></tr>'
}

async function deleteStudent(id) {
  if (!confirm('Supprimer cet élève ?')) return
  try {
    await Api.del(`/api/admin/students/${id}`)
    toast('Élève supprimé', 'success')
    await loadStudents()
    await loadClasses()
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// PERSONNEL
// ---------------------------------------------------------------------------
async function loadStaff() {
  const { staff } = await Api.get('/api/admin/staff')
  document.getElementById('staff-tbody').innerHTML = staff.map(s => `
    <tr>
      <td class="font-medium">${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.email)}</td>
      <td><span class="badge ${s.role === 'enseignant' ? 'badge-blue' : 'badge-amber'}">${s.role === 'enseignant' ? 'Enseignant' : 'Percepteur'}</span></td>
      <td>${s.active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}</td>
      <td class="space-x-2">
        <button onclick="toggleStaff(${s.id}, ${s.active ? 0 : 1})" class="text-xs font-semibold ${s.active ? 'text-red-600' : 'text-green-600'} hover:underline">${s.active ? 'Désactiver' : 'Activer'}</button>
        <button onclick="deleteStaff(${s.id})" class="text-red-600 hover:underline text-xs font-semibold"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucun personnel enregistré</td></tr>'
}

function showCreateStaffModal() {
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-user-plus mr-2 text-blue-600"></i>Ajouter du personnel</h3>
      <form id="create-staff-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Nom complet *</label><input required id="sf-name" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Email *</label><input required type="email" id="sf-email" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Téléphone</label><input id="sf-phone" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Mot de passe *</label><input required id="sf-password" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Rôle *</label>
            <select required id="sf-role" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"><option value="percepteur">Percepteur</option><option value="enseignant">Enseignant</option></select>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Ajouter</button>
        </div>
      </form>
    </div>`)
  document.getElementById('create-staff-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.post('/api/admin/staff', {
        name: document.getElementById('sf-name').value,
        email: document.getElementById('sf-email').value,
        phone: document.getElementById('sf-phone').value,
        password: document.getElementById('sf-password').value,
        role: document.getElementById('sf-role').value
      })
      toast('Personnel ajouté', 'success')
      closeModal()
      await loadStaff()
    } catch (err) { toast(err.message, 'error') }
  })
}

async function toggleStaff(id, active) {
  try { await Api.patch(`/api/admin/staff/${id}`, { active }); toast('Statut mis à jour', 'success'); loadStaff() }
  catch (err) { toast(err.message, 'error') }
}
async function deleteStaff(id) {
  if (!confirm('Supprimer ce compte ?')) return
  try { await Api.del(`/api/admin/staff/${id}`); toast('Supprimé', 'success'); loadStaff() }
  catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// FRAIS SCOLAIRES (par classe x trimestre)
// ---------------------------------------------------------------------------
async function loadFeesTable() {
  const currentYear = schoolYears.find(y => y.is_current) || schoolYears[0]
  if (!currentYear) { document.getElementById('fees-tbody').innerHTML = '<tr><td colspan="4" class="text-center text-slate-400 py-6">Créez une année scolaire d\'abord</td></tr>'; return }
  const { trimesters: ts } = await Api.get(`/api/admin/trimesters?school_year_id=${currentYear.id}`)
  const { classes } = await Api.get(`/api/admin/classes?school_year_id=${currentYear.id}`)
  const { fee_structures } = await Api.get(`/api/admin/fee-structures?school_year_id=${currentYear.id}`)

  const feeMap = {}
  fee_structures.forEach(f => { feeMap[`${f.class_id}-${f.trimester_id}`] = f.montant })

  document.getElementById('fees-tbody').innerHTML = classes.map(cl => `
    <tr>
      <td class="font-medium">${escapeHtml(cl.name)}</td>
      ${ts.map(t => `<td>
        <div class="flex items-center gap-1">
          <input type="number" min="0" step="0.01" value="${feeMap[`${cl.id}-${t.id}`] ?? ''}" id="fee-${cl.id}-${t.id}" class="w-28 px-2 py-1 border rounded text-sm" placeholder="Montant">
          <button onclick="saveFee(${cl.id}, ${t.id})" class="text-blue-600 text-xs"><i class="fas fa-save"></i></button>
        </div>
      </td>`).join('')}
    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-6">Aucune classe</td></tr>'
}

async function saveFee(classId, trimesterId) {
  const input = document.getElementById(`fee-${classId}-${trimesterId}`)
  const montant = parseFloat(input.value)
  if (isNaN(montant) || montant < 0) return toast('Montant invalide', 'error')
  try {
    await Api.post('/api/admin/fee-structures', { class_id: classId, trimester_id: trimesterId, montant })
    toast('Frais enregistré', 'success')
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// PERCEPTION (vue 1 : cartes KPI par classe -> vue 2 : détail/registre journalier)
// ---------------------------------------------------------------------------
let currentPerceptionClass = null // { id, name }

function populatePerceptionSelectors() {
  const trimOptions = trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
  document.getElementById('perc-summary-trimester').innerHTML = trimOptions
  document.getElementById('perc-trimester').innerHTML = trimOptions
  document.getElementById('perc-summary-date').value = todayStr()
}

async function loadPerceptionClasses() {
  const trimesterId = document.getElementById('perc-summary-trimester').value
  const date = document.getElementById('perc-summary-date').value || todayStr()
  if (!trimesterId) return
  const data = await Api.get(`/api/perception/registre-summary?date=${date}&trimester_id=${trimesterId}`)

  document.getElementById('perception-classes-grid').innerHTML = data.classes.map(cl => `
    <div onclick="openPerceptionClass(${cl.class_id}, '${escapeHtml(cl.class_name)}')" class="section-card cursor-pointer hover:shadow-md hover:border-blue-300 transition">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-slate-800">${escapeHtml(cl.class_name)}</h3>
        <span class="badge badge-blue">${escapeHtml(cl.level || '—')}</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-center">
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Ont payé</p><p class="font-bold text-sm text-slate-800">${cl.paid_count}/${cl.students_count}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Perçu</p><p class="font-bold text-sm text-green-600">${fmtMoney(cl.total_collected, currentSchool?.currency)}</p></div>
      </div>
      <p class="text-xs text-blue-600 font-semibold mt-3 text-right">Ouvrir <i class="fas fa-arrow-right ml-1"></i></p>
    </div>`).join('') || '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucune classe</p>'
}

function openPerceptionClass(classId, className) {
  currentPerceptionClass = { id: classId, name: className }
  document.getElementById('perception-detail-title').textContent = className
  document.getElementById('perc-trimester').value = document.getElementById('perc-summary-trimester').value
  document.getElementById('perc-date').value = document.getElementById('perc-summary-date').value || todayStr()
  document.getElementById('perception-classes-view').classList.add('hidden')
  document.getElementById('perception-detail-view').classList.remove('hidden')
  loadRegistre()
}

function closePerceptionDetail() {
  currentPerceptionClass = null
  document.getElementById('perception-detail-view').classList.add('hidden')
  document.getElementById('perception-classes-view').classList.remove('hidden')
  loadPerceptionClasses()
}

async function loadRegistre() {
  if (!currentPerceptionClass) return
  const classId = currentPerceptionClass.id
  const trimesterId = document.getElementById('perc-trimester').value
  const date = document.getElementById('perc-date').value || todayStr()
  if (!classId || !trimesterId) return

  const data = await Api.get(`/api/perception/registre?class_id=${classId}&date=${date}&trimester_id=${trimesterId}`)

  document.getElementById('registre-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Élèves ayant payé ce jour</p><p class="text-xl font-bold text-slate-800">${data.count}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total perçu ce jour</p><p class="text-xl font-bold text-green-600">${fmtMoney(data.total, currentSchool?.currency)}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Date</p><p class="text-xl font-bold text-slate-800">${fmtDate(data.date)}</p></div>
  `

  document.getElementById('registre-tbody').innerHTML = data.students.map((s, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td class="font-medium"><button onclick="showStudentReceipts(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', ${trimesterId})" class="hover:underline hover:text-blue-600 text-left">${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}</button></td>
      <td>${s.montant_jour ? fmtMoney(s.montant_jour, currentSchool?.currency) : '<span class="text-slate-400">—</span>'}</td>
      <td>${s.receipt_number ? `<span class="badge badge-green">${escapeHtml(s.receipt_number)}</span>${s.payments_count_today > 1 ? ` <span class="badge badge-blue">x${s.payments_count_today}</span>` : ''}` : '—'}</td>
      <td class="space-x-2 whitespace-nowrap">
        ${s.payment_id
          ? `<button onclick="printReceipt(${s.payment_id})" class="text-blue-600 hover:underline text-xs font-semibold"><i class="fas fa-print"></i> Reçu</button>
             <button onclick="cancelPayment(${s.payment_id})" class="text-red-600 hover:underline text-xs font-semibold"><i class="fas fa-rotate-left"></i> Annuler</button>`
          : ''}
        <button onclick="showPayModal(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', ${trimesterId})" class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-semibold"><i class="fas fa-hand-holding-dollar mr-1"></i>Percevoir</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucun élève dans cette classe</td></tr>'
}

// Affiche la liste des paiements d'un élève (toutes dates) pour ce trimestre,
// avec possibilité d'imprimer le reçu de n'importe lequel d'entre eux.
async function showStudentReceipts(studentId, studentName, trimesterId) {
  const situation = await Api.get(`/api/perception/student/${studentId}/situation?trimester_id=${trimesterId}`)
  const rows = (situation.payments || []).map(p => `
    <tr>
      <td>${fmtDate(p.date_paiement)}</td>
      <td>${fmtMoney(p.montant, currentSchool?.currency)}</td>
      <td><span class="badge badge-green">${escapeHtml(p.receipt_number)}</span></td>
      <td><button onclick="printReceipt(${p.id})" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-semibold"><i class="fas fa-print mr-1"></i>Imprimer le reçu</button></td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-6">Aucun paiement enregistré ce trimestre</td></tr>'

  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-receipt mr-2 text-blue-600"></i>Paiements de ${escapeHtml(studentName)}</h3>
      <p class="text-sm text-slate-500 mb-4">Sélectionnez un paiement pour imprimer son reçu</p>
      <div class="grid grid-cols-3 gap-2 mb-4 text-center">
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Frais fixé</p><p class="font-bold text-sm">${fmtMoney(situation.fee_amount, currentSchool?.currency)}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Déjà payé</p><p class="font-bold text-sm text-green-600">${fmtMoney(situation.total_paid, currentSchool?.currency)}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Solde dû</p><p class="font-bold text-sm text-red-600">${fmtMoney(situation.balance, currentSchool?.currency)}</p></div>
      </div>
      <div class="overflow-x-auto max-h-80 overflow-y-auto">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Montant</th><th>Reçu</th><th>Action</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="flex justify-end pt-4">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Fermer</button>
      </div>
    </div>`)
}

function printAllReceipts() {
  if (!currentPerceptionClass) return
  const date = document.getElementById('perc-date').value || todayStr()
  window.open(`/static/receipts-batch.html?class_id=${currentPerceptionClass.id}&date=${date}`, '_blank')
}

async function showPayModal(studentId, studentName, trimesterId) {
  const situation = await Api.get(`/api/perception/student/${studentId}/situation?trimester_id=${trimesterId}`)
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-hand-holding-dollar mr-2 text-green-600"></i>Perception</h3>
      <p class="text-sm text-slate-500 mb-4">${escapeHtml(studentName)}</p>
      <div class="grid grid-cols-3 gap-2 mb-4 text-center">
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Frais fixé</p><p class="font-bold text-sm">${fmtMoney(situation.fee_amount, currentSchool?.currency)}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Déjà payé</p><p class="font-bold text-sm text-green-600">${fmtMoney(situation.total_paid, currentSchool?.currency)}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Solde dû</p><p class="font-bold text-sm text-red-600">${fmtMoney(situation.balance, currentSchool?.currency)}</p></div>
      </div>
      <form id="pay-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Montant à percevoir *</label><input required type="number" step="0.01" min="0.01" id="pay-amount" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" placeholder="0.00"></div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold">Enregistrer et générer le reçu</button>
        </div>
      </form>
    </div>`)
  document.getElementById('pay-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const montant = parseFloat(document.getElementById('pay-amount').value)
      const result = await Api.post('/api/perception/pay', {
        student_id: studentId, trimester_id: trimesterId, montant,
        date_paiement: document.getElementById('perc-date').value || todayStr()
      })
      toast('Paiement enregistré : ' + result.receipt_number, 'success')
      closeModal()
      await loadRegistre()
      printReceipt(result.payment_id)
    } catch (err) { toast(err.message, 'error') }
  })
}

async function cancelPayment(paymentId) {
  if (!confirm('Annuler ce paiement ? Cette action ne peut pas être défaite facilement.')) return
  try {
    await Api.post(`/api/perception/payments/${paymentId}/cancel`)
    toast('Paiement annulé', 'success')
    await loadRegistre()
  } catch (err) { toast(err.message, 'error') }
}

function printReceipt(paymentId) {
  window.open(`/static/receipt.html?payment_id=${paymentId}`, '_blank')
}

// ---------------------------------------------------------------------------
// DETTES (vue 1 : cartes KPI par classe -> vue 2 : détail des dettes d'une classe)
// ---------------------------------------------------------------------------
let currentDebtsClass = null // { id, name }

function populateDebtSelectors() {
  document.getElementById('debt-summary-trimester').innerHTML = trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
}

async function loadDebtsClasses() {
  const trimesterId = document.getElementById('debt-summary-trimester').value
  if (!trimesterId) return
  const data = await Api.get(`/api/perception/debts-summary?trimester_id=${trimesterId}`)

  document.getElementById('debts-classes-grid').innerHTML = data.classes.map(cl => `
    <div onclick="openDebtsClass(${cl.class_id}, '${escapeHtml(cl.class_name)}')" class="section-card cursor-pointer hover:shadow-md hover:border-blue-300 transition">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-slate-800">${escapeHtml(cl.class_name)}</h3>
        <span class="badge badge-blue">${escapeHtml(cl.level || '—')}</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-center">
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Endettés</p><p class="font-bold text-sm ${cl.debtors_count > 0 ? 'text-red-600' : 'text-green-600'}">${cl.debtors_count}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Total dette</p><p class="font-bold text-sm text-red-600">${fmtMoney(cl.total_debt, currentSchool?.currency)}</p></div>
      </div>
      <p class="text-xs text-blue-600 font-semibold mt-3 text-right">Ouvrir <i class="fas fa-arrow-right ml-1"></i></p>
    </div>`).join('') || '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucune classe</p>'
}

function openDebtsClass(classId, className) {
  currentDebtsClass = { id: classId, name: className }
  document.getElementById('debts-detail-title').textContent = className
  document.getElementById('debts-classes-view').classList.add('hidden')
  document.getElementById('debts-detail-view').classList.remove('hidden')
  loadDebts()
}

function closeDebtsDetail() {
  currentDebtsClass = null
  document.getElementById('debts-detail-view').classList.add('hidden')
  document.getElementById('debts-classes-view').classList.remove('hidden')
  loadDebtsClasses()
}

async function loadDebts() {
  if (!currentDebtsClass) return
  const trimesterId = document.getElementById('debt-summary-trimester').value
  const classId = currentDebtsClass.id
  if (!trimesterId) return
  const data = await Api.get(`/api/perception/debts?trimester_id=${trimesterId}&class_id=${classId}`)

  document.getElementById('debts-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Élèves endettés</p><p class="text-xl font-bold text-red-600">${data.count}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total des dettes</p><p class="text-xl font-bold text-red-600">${fmtMoney(data.total_debt, currentSchool?.currency)}</p></div>
  `

  document.getElementById('debts-tbody').innerHTML = data.debts.map(d => `
    <tr>
      <td class="font-medium">${escapeHtml(d.nom)} ${escapeHtml(d.post_nom)}</td>
      <td>${fmtMoney(d.fee_amount, currentSchool?.currency)}</td>
      <td class="text-green-600">${fmtMoney(d.total_paid, currentSchool?.currency)}</td>
      <td class="text-red-600 font-semibold">${fmtMoney(d.balance, currentSchool?.currency)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-6">Aucune dette : tous les frais sont soldés 🎉</td></tr>'
}

// ---------------------------------------------------------------------------
// BUDGET (prévision vs réalisé)
// ---------------------------------------------------------------------------
function populateBudgetSelectors() {
  const sel = document.getElementById('budget-trimester')
  sel.innerHTML = '<option value="">Annuel (toute l\'année)</option>' + trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
}

async function loadBudget() {
  const trimesterId = document.getElementById('budget-trimester').value
  const url = trimesterId ? `/api/budget/comparison?trimester_id=${trimesterId}` : '/api/budget/comparison'
  const { rows } = await Api.get(url)
  document.getElementById('budget-tbody').innerHTML = rows.map(r => `
    <tr>
      <td class="font-medium">${escapeHtml(r.category_name)}</td>
      <td><span class="badge ${r.type === 'RECETTE' ? 'badge-green' : 'badge-red'}">${r.type === 'RECETTE' ? 'Recette' : 'Dépense'}</span></td>
      <td>${fmtMoney(r.prevu, currentSchool?.currency)}</td>
      <td>${fmtMoney(r.realise, currentSchool?.currency)}</td>
      <td class="${r.ecart >= 0 ? 'text-green-600' : 'text-red-600'} font-semibold">${r.ecart >= 0 ? '+' : ''}${fmtMoney(r.ecart, currentSchool?.currency)}</td>
      <td>${r.taux !== null ? r.taux + '%' : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-center text-slate-400 py-6">Aucune catégorie budgétaire</td></tr>'
}

async function showAddPrevisionModal() {
  const { categories } = await Api.get('/api/admin/budget-categories')
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-chart-pie mr-2 text-blue-600"></i>Définir une prévision budgétaire</h3>
      <form id="prevision-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Catégorie *</label>
          <select required id="pv-category" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
            ${categories.map(c => `<option value="${c.id}">${c.type === 'RECETTE' ? '🟢' : '🔴'} ${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Portée</label>
          <select id="pv-trimester" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
            <option value="">Annuel</option>
            ${trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Montant prévu *</label><input required type="number" step="0.01" min="0" id="pv-amount" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div><label class="text-xs font-medium text-slate-600">Notes</label><textarea id="pv-notes" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" rows="2"></textarea></div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('prevision-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.post('/api/budget/previsions', {
        budget_category_id: document.getElementById('pv-category').value,
        trimester_id: document.getElementById('pv-trimester').value || null,
        montant_prevu: parseFloat(document.getElementById('pv-amount').value),
        notes: document.getElementById('pv-notes').value
      })
      toast('Prévision enregistrée', 'success')
      closeModal()
      loadBudget()
    } catch (err) { toast(err.message, 'error') }
  })
}

// ---------------------------------------------------------------------------
// LIVRE DE CAISSE
// ---------------------------------------------------------------------------
async function loadCashbook() {
  const from = document.getElementById('cb-from').value
  const to = document.getElementById('cb-to').value
  let url = '/api/cashbook'
  const params = []
  if (from) params.push(`from=${from}`)
  if (to) params.push(`to=${to}`)
  if (params.length) url += '?' + params.join('&')

  const data = await Api.get(url)

  document.getElementById('cashbook-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total Entrées</p><p class="text-xl font-bold text-green-600">${fmtMoney(data.total_entree, currentSchool?.currency)}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total Sorties</p><p class="text-xl font-bold text-red-600">${fmtMoney(data.total_sortie, currentSchool?.currency)}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Solde final</p><p class="text-xl font-bold text-blue-600">${fmtMoney(data.solde_final, currentSchool?.currency)}</p></div>
  `

  const initRow = `<tr class="bg-slate-50"><td colspan="6" class="font-semibold">Solde initial</td><td class="font-bold">${fmtMoney(data.solde_initial, currentSchool?.currency)}</td><td></td></tr>`

  document.getElementById('cashbook-tbody').innerHTML = initRow + data.entries.map(e => `
    <tr>
      <td>${fmtDate(e.entry_date)}</td>
      <td>${e.code ? `<span class="badge badge-gray">${escapeHtml(e.code)}</span>` : '—'}</td>
      <td class="font-medium">${escapeHtml(e.libelle)} ${e.is_auto ? '<span class="badge badge-blue ml-1">Auto</span>' : ''}</td>
      <td>${escapeHtml(e.ref || '—')}</td>
      <td class="text-green-600">${e.entree ? fmtMoney(e.entree, currentSchool?.currency) : ''}</td>
      <td class="text-red-600">${e.sortie ? fmtMoney(e.sortie, currentSchool?.currency) : ''}</td>
      <td class="font-semibold">${fmtMoney(e.solde, currentSchool?.currency)}</td>
      <td>${e.is_auto ? '<span class="text-xs text-slate-400">Généré par perception</span>' : `<button onclick="deleteCashbookEntry(${e.id})" class="text-red-600 hover:underline text-xs"><i class="fas fa-trash"></i></button>`}</td>
    </tr>`).join('')
}

function clearCashbookFilter() {
  document.getElementById('cb-from').value = ''
  document.getElementById('cb-to').value = ''
  loadCashbook()
}

async function showAddCashbookModal() {
  const { categories } = await Api.get('/api/admin/budget-categories')
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-book mr-2 text-blue-600"></i>Nouvelle opération au livre de caisse</h3>
      <form id="cashbook-form" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Date *</label><input required type="date" id="cbe-date" value="${todayStr()}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Code pièce</label>
            <select id="cbe-code" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
              <option value="">—</option><option value="F">F - Facture</option><option value="B">B - Bon</option><option value="R">R - Reçu</option><option value="AUT">AUT - Autodéclaration</option>
            </select>
          </div>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Libellé *</label><input required id="cbe-libelle" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" placeholder="ex: Transport 5 sacs ciment"></div>
        <div><label class="text-xs font-medium text-slate-600">Référence</label><input id="cbe-ref" placeholder="ex: B12/25 ou F2260" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div><label class="text-xs font-medium text-slate-600">Catégorie budgétaire</label>
          <select id="cbe-category" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
            <option value="">— Aucune —</option>
            ${categories.map(c => `<option value="${c.id}">${c.type === 'RECETTE' ? '🟢' : '🔴'} ${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Entrée</label><input type="number" step="0.01" min="0" id="cbe-entree" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" placeholder="0.00"></div>
          <div><label class="text-xs font-medium text-slate-600">Sortie</label><input type="number" step="0.01" min="0" id="cbe-sortie" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" placeholder="0.00"></div>
        </div>
        <p class="text-xs text-slate-400">Remplir soit "Entrée" soit "Sortie" (jamais les deux).</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('cashbook-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.post('/api/cashbook', {
        entry_date: document.getElementById('cbe-date').value,
        code: document.getElementById('cbe-code').value,
        libelle: document.getElementById('cbe-libelle').value,
        ref: document.getElementById('cbe-ref').value,
        entree: parseFloat(document.getElementById('cbe-entree').value) || 0,
        sortie: parseFloat(document.getElementById('cbe-sortie').value) || 0,
        budget_category_id: document.getElementById('cbe-category').value || null
      })
      toast('Opération enregistrée', 'success')
      closeModal()
      loadCashbook()
    } catch (err) { toast(err.message, 'error') }
  })
}

async function deleteCashbookEntry(id) {
  if (!confirm('Supprimer cette opération ?')) return
  try { await Api.del(`/api/cashbook/${id}`); toast('Supprimé', 'success'); loadCashbook() }
  catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// RAPPORTS FINANCIERS
// ---------------------------------------------------------------------------
function buildReportTabs() {
  document.getElementById('report-tabs').innerHTML = trimesters.map((t, i) => `
    <div class="tab-btn ${i === 0 ? 'active' : ''}" onclick="selectReportTab(${t.id}, this)">${escapeHtml(t.name)}</div>
  `).join('')
  if (trimesters.length) loadReport(trimesters[0].id)
}

function selectReportTab(trimesterId, el) {
  document.querySelectorAll('#report-tabs .tab-btn').forEach(b => b.classList.remove('active'))
  el.classList.add('active')
  loadReport(trimesterId)
}

async function loadReport(trimesterId) {
  document.getElementById('report-content').innerHTML = '<div class="loader"></div>'
  const data = await Api.get(`/api/reports/trimester/${trimesterId}`)
  const s = data.summary
  document.getElementById('report-content').innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Frais attendus</p><p class="text-lg font-bold text-slate-800">${fmtMoney(s.total_attendu, currentSchool?.currency)}</p></div>
      <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Frais perçus</p><p class="text-lg font-bold text-green-600">${fmtMoney(s.total_percu, currentSchool?.currency)}</p></div>
      <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Solde restant dû</p><p class="text-lg font-bold text-red-600">${fmtMoney(s.solde_frais, currentSchool?.currency)}</p></div>
      <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Taux de recouvrement</p><p class="text-lg font-bold text-blue-600">${s.taux_recouvrement !== null ? s.taux_recouvrement + '%' : '—'}</p></div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="section-card">
        <h3 class="font-bold text-slate-800 mb-3"><i class="fas fa-chalkboard mr-2 text-blue-600"></i>Détail par classe</h3>
        <table class="data-table"><thead><tr><th>Classe</th><th>Élèves</th><th>Attendu</th><th>Perçu</th><th>Taux</th></tr></thead>
          <tbody>${data.class_details.map(c => `<tr><td class="font-medium">${escapeHtml(c.class_name)}</td><td>${c.student_count}</td><td>${fmtMoney(c.attendu, currentSchool?.currency)}</td><td class="text-green-600">${fmtMoney(c.percu, currentSchool?.currency)}</td><td>${c.taux !== null ? c.taux + '%' : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-4">Aucune donnée</td></tr>'}</tbody>
        </table>
      </div>

      <div class="section-card">
        <h3 class="font-bold text-slate-800 mb-3"><i class="fas fa-money-bill-wave mr-2 text-red-600"></i>Dépenses par catégorie</h3>
        <table class="data-table"><thead><tr><th>Catégorie</th><th>Montant</th></tr></thead>
          <tbody>${data.expenses_by_category.map(e => `<tr><td class="font-medium">${escapeHtml(e.category_name)}</td><td class="text-red-600">${fmtMoney(e.total, currentSchool?.currency)}</td></tr>`).join('') || '<tr><td colspan="2" class="text-center text-slate-400 py-4">Aucune dépense catégorisée</td></tr>'}</tbody>
          <tfoot><tr><td>Total Entrées Caisse</td><td class="text-green-600">${fmtMoney(s.total_entree_caisse, currentSchool?.currency)}</td></tr><tr><td>Total Sorties Caisse</td><td class="text-red-600">${fmtMoney(s.total_sortie_caisse, currentSchool?.currency)}</td></tr></tfoot>
        </table>
      </div>
    </div>

    <div class="section-card mt-6">
      <h3 class="font-bold text-slate-800 mb-3"><i class="fas fa-triangle-exclamation mr-2 text-amber-600"></i>Top 10 des débiteurs</h3>
      <table class="data-table"><thead><tr><th>Élève</th><th>Classe</th><th>Dette</th></tr></thead>
        <tbody>${data.top_debtors.map(d => `<tr><td class="font-medium">${escapeHtml(d.nom)} ${escapeHtml(d.post_nom)}</td><td>${escapeHtml(d.class_name)}</td><td class="text-red-600 font-semibold">${fmtMoney(d.balance, currentSchool?.currency)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-center text-slate-400 py-4">Aucun débiteur 🎉</td></tr>'}</tbody>
      </table>
    </div>

    <div class="text-right mt-4">
      <button onclick="window.print()" class="text-sm text-slate-600 hover:underline"><i class="fas fa-print mr-1"></i>Imprimer ce rapport</button>
    </div>
  `
}

init()
