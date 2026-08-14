// ============================================================================
// Logique frontend de l'espace CLASSE (lecture seule)
// ============================================================================
let currentUser = null
let currentSchool = null
let myClass = null
let trimesters = []

async function init() {
  const data = await guardAuth(['classe'])
  if (!data) return
  currentUser = data.user
  currentSchool = data.school
  document.getElementById('user-info').innerHTML = `<i class="fas fa-user-circle mr-1"></i>${escapeHtml(data.user.name)}`
  document.getElementById('school-name-label').textContent = data.school ? data.school.name : 'École'
  document.getElementById('perc-date').value = todayStr()

  setupTabs()

  const meRes = await Api.get('/api/classe/me')
  myClass = meRes.class
  document.getElementById('class-name-label').textContent = myClass.name

  const trimRes = await Api.get('/api/shared/trimesters')
  trimesters = trimRes.trimesters
  populateSelectors()

  renderOverview(meRes)
  await loadStudents()
  if (trimesters.length) {
    await loadRegistre()
  }
}

function setupTabs() {
  document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.nav-link[data-tab]').forEach(l => l.classList.remove('active'))
      link.classList.add('active')
      document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'))
      document.getElementById('tab-' + link.dataset.tab).classList.remove('hidden')
      if (link.dataset.tab === 'debts') loadDebts()
      if (link.dataset.tab === 'fees') loadFees()
      if (link.dataset.tab === 'perception') loadRegistre()
    })
  })
}

function populateSelectors() {
  const trimOptions = trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
  document.getElementById('perc-trimester').innerHTML = trimOptions
  document.getElementById('debt-trimester').innerHTML = trimOptions
}

function renderOverview(meRes) {
  document.getElementById('overview-stats').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Niveau</p><p class="text-lg font-bold text-slate-800">${escapeHtml(myClass.level || '—')}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Enseignant(s)</p><p class="text-lg font-bold text-slate-800">${meRes.teachers.length}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Percepteur(s)</p><p class="text-lg font-bold text-slate-800">${meRes.percepteurs.length}</p></div>
  `
  document.getElementById('overview-teachers').innerHTML = meRes.teachers.map(t => `<div class="bg-slate-50 px-3 py-1.5 rounded">${escapeHtml(t.name)}</div>`).join('') || '<p class="text-xs text-slate-400">Aucun enseignant affecté</p>'
  document.getElementById('overview-percepteurs').innerHTML = meRes.percepteurs.map(p => `<div class="bg-slate-50 px-3 py-1.5 rounded">${escapeHtml(p.name)}</div>`).join('') || '<p class="text-xs text-slate-400">Aucun percepteur affecté</p>'
}

async function loadStudents() {
  const { students } = await Api.get('/api/classe/students')
  document.getElementById('students-tbody').innerHTML = students.map(s => `
    <tr>
      <td>${escapeHtml(s.matricule || '—')}</td>
      <td class="font-medium">${escapeHtml(s.nom)}</td>
      <td>${escapeHtml(s.post_nom)}</td>
      <td>${escapeHtml(s.prenom || '—')}</td>
      <td>${s.sexe || '—'}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucun élève</td></tr>'
}

async function loadRegistre() {
  const trimesterId = document.getElementById('perc-trimester').value
  const date = document.getElementById('perc-date').value || todayStr()
  if (!trimesterId) return

  const data = await Api.get(`/api/classe/registre?date=${date}&trimester_id=${trimesterId}`)

  document.getElementById('registre-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Élèves ayant payé ce jour</p><p class="text-xl font-bold text-slate-800">${data.count}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total perçu ce jour</p><p class="text-xl font-bold text-green-600">${fmtMoney(data.total, currentSchool?.currency)}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Date</p><p class="text-xl font-bold text-slate-800">${fmtDate(data.date)}</p></div>
  `

  document.getElementById('registre-tbody').innerHTML = data.students.map((s, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td class="font-medium">${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}</td>
      <td>${s.montant_jour ? fmtMoney(s.montant_jour, currentSchool?.currency) : '<span class="text-slate-400">—</span>'}</td>
      <td>${s.receipt_number ? `<span class="badge badge-green">${escapeHtml(s.receipt_number)}</span>` : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-6">Aucun élève dans cette classe</td></tr>'
}

async function loadDebts() {
  const trimesterId = document.getElementById('debt-trimester').value
  if (!trimesterId) return
  const data = await Api.get(`/api/classe/debts?trimester_id=${trimesterId}`)

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
    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-6">Aucune dette 🎉</td></tr>'
}

async function loadFees() {
  const { fee_structures } = await Api.get('/api/classe/fees')
  document.getElementById('fees-tbody').innerHTML = fee_structures.map(f => `
    <tr>
      <td class="font-medium">${escapeHtml(f.trimester_name)}</td>
      <td>${fmtMoney(f.montant, currentSchool?.currency)}</td>
    </tr>`).join('') || '<tr><td colspan="2" class="text-center text-slate-400 py-6">Aucun frais fixé pour cette classe</td></tr>'
}

init()
