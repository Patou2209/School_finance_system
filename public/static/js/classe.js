// ============================================================================
// Logique frontend de l'espace CLASSE
// La classe connectée peut consulter ses informations et gérer SES PROPRES
// élèves (ajout manuel + import Excel/CSV). Les paiements restent réservés
// aux percepteurs/admin (lecture seule ici).
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

  renderImpersonationBanner(data.user)
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

// ---------------------------------------------------------------------------
// Bannière "vous consultez cette classe en tant qu'administrateur"
// ---------------------------------------------------------------------------
function renderImpersonationBanner(user) {
  const banner = document.getElementById('impersonation-banner')
  if (!user.impersonating) {
    banner.classList.add('hidden')
    return
  }
  banner.classList.remove('hidden')
  banner.innerHTML = `
    <i class="fas fa-eye"></i>
    <span>Vous consultez l'espace de cette classe en tant qu'administrateur (${escapeHtml(user.impersonating.admin_name)}).</span>
    <button onclick="returnToAdmin()"><i class="fas fa-arrow-left mr-1"></i>Retour à l'administration</button>
  `
  document.body.style.paddingTop = '2.5rem'
}

async function returnToAdmin() {
  try {
    await Api.post('/api/auth/restore-admin')
    window.location.href = '/static/admin.html'
  } catch (err) {
    toast(err.message, 'error')
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
      if (link.dataset.tab === 'students') loadStudents()
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

// ---------------------------------------------------------------------------
// ELEVES (ajout, import, suppression) — propres à la classe connectée
// ---------------------------------------------------------------------------
async function loadStudents() {
  const { students } = await Api.get('/api/classe/students')
  document.getElementById('students-tbody').innerHTML = students.map(s => `
    <tr>
      <td class="font-medium">${escapeHtml(s.nom)}</td>
      <td>${escapeHtml(s.post_nom)}</td>
      <td>${escapeHtml(s.prenom || '—')}</td>
      <td>${s.sexe || '—'}</td>
      <td><button onclick="deleteStudent(${s.id})" class="text-red-600 hover:underline text-xs font-semibold"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucun élève</td></tr>'
}

function showCreateStudentModal() {
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-user-graduate mr-2 text-blue-600"></i>Ajouter un élève</h3>
      <form id="create-student-form" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Nom *</label><input required id="st-nom" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Post-nom *</label><input required id="st-postnom" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Prénom</label><input id="st-prenom" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Sexe</label>
            <select id="st-sexe" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"><option value="">—</option><option value="M">M</option><option value="F">F</option></select>
          </div>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Contact parent</label><input id="st-contact" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Ajouter</button>
        </div>
      </form>
    </div>`)
  document.getElementById('create-student-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.post('/api/classe/students', {
        nom: document.getElementById('st-nom').value,
        post_nom: document.getElementById('st-postnom').value,
        prenom: document.getElementById('st-prenom').value,
        sexe: document.getElementById('st-sexe').value,
        parent_contact: document.getElementById('st-contact').value
      })
      toast('Élève ajouté', 'success')
      closeModal()
      await loadStudents()
    } catch (err) { toast(err.message, 'error') }
  })
}

async function deleteStudent(id) {
  if (!confirm('Supprimer cet élève ?')) return
  try {
    await Api.del(`/api/classe/students/${id}`)
    toast('Élève supprimé', 'success')
    await loadStudents()
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// IMPORT ÉLÈVES (Excel / CSV) — une seule colonne "Nom et post-nom"
// ---------------------------------------------------------------------------
let importedStudentsRows = []

function splitNomPostNom(fullName) {
  const clean = String(fullName || '').trim().replace(/\s+/g, ' ')
  if (!clean) return { nom: '', post_nom: '' }
  const parts = clean.split(' ')
  const nom = parts[0]
  const post_nom = parts.slice(1).join(' ') || parts[0]
  return { nom, post_nom }
}

function showImportStudentsModal() {
  importedStudentsRows = []
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-file-import mr-2 text-emerald-600"></i>Importer des élèves</h3>
      <p class="text-xs text-slate-500 mb-4">Fichier Excel (.xlsx/.xls) ou CSV attendu, avec une seule colonne contenant le <strong>Nom et post-nom</strong> de chaque élève (une ligne par élève). La première cellule peut être un en-tête (ex. "Nom et post-nom"), elle sera ignorée automatiquement. Les élèves seront ajoutés à <strong>votre classe (${escapeHtml(myClass ? myClass.name : '')})</strong>.</p>
      <div class="space-y-3">
        <div>
          <label class="text-xs font-medium text-slate-600">Fichier (.xlsx, .xls, .csv)</label>
          <input type="file" id="import-file" accept=".xlsx,.xls,.csv" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm bg-white">
        </div>
        <div id="import-preview" class="max-h-64 overflow-y-auto border rounded-lg hidden">
          <table class="data-table"><thead><tr><th>#</th><th>Nom et post-nom (fichier)</th><th>Nom</th><th>Post-nom</th></tr></thead><tbody id="import-preview-tbody"></tbody></table>
        </div>
        <div id="import-count" class="text-xs text-slate-500"></div>
      </div>
      <div class="flex justify-end gap-2 pt-4 mt-2 border-t">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
        <button type="button" id="import-submit-btn" disabled onclick="submitImportedStudents()" class="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold">
          <i class="fas fa-upload mr-2"></i>Importer
        </button>
      </div>
    </div>`)

  document.getElementById('import-file').addEventListener('change', handleImportFileSelected)
}

function handleImportFileSelected(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (evt) => {
    try {
      const data = new Uint8Array(evt.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[firstSheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' })

      let names = rows
        .map(r => (Array.isArray(r) ? r[0] : r))
        .map(v => String(v ?? '').trim())
        .filter(v => v.length > 0)

      if (names.length > 0) {
        const headerCandidate = names[0].toLowerCase()
        if (/^(nom|nom et post[- ]?nom|post[- ]?nom|noms)$/i.test(headerCandidate)) {
          names = names.slice(1)
        }
      }

      importedStudentsRows = names.map(n => ({ full: n, ...splitNomPostNom(n) }))
      renderImportPreview()
    } catch (err) {
      toast('Fichier illisible : ' + err.message, 'error')
    }
  }
  reader.readAsArrayBuffer(file)
}

function renderImportPreview() {
  const preview = document.getElementById('import-preview')
  const tbody = document.getElementById('import-preview-tbody')
  const countEl = document.getElementById('import-count')
  const btn = document.getElementById('import-submit-btn')

  if (importedStudentsRows.length === 0) {
    preview.classList.add('hidden')
    countEl.textContent = 'Aucun élève détecté dans le fichier.'
    btn.disabled = true
    return
  }

  tbody.innerHTML = importedStudentsRows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.full)}</td>
      <td class="font-medium">${escapeHtml(r.nom)}</td>
      <td>${escapeHtml(r.post_nom)}</td>
    </tr>`).join('')
  preview.classList.remove('hidden')
  countEl.textContent = `${importedStudentsRows.length} élève(s) détecté(s), prêt(s) à être importés.`
  btn.disabled = false
}

async function submitImportedStudents() {
  if (importedStudentsRows.length === 0) { toast('Aucun élève à importer', 'error'); return }

  const students = importedStudentsRows.map(r => ({ nom: r.nom, post_nom: r.post_nom }))

  const btn = document.getElementById('import-submit-btn')
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Import en cours...'
  try {
    const res = await Api.post('/api/classe/students/bulk', { students })
    toast(`${res.created} élève(s) importé(s) avec succès`, 'success')
    closeModal()
    await loadStudents()
  } catch (err) {
    toast(err.message, 'error')
    btn.disabled = false
    btn.innerHTML = '<i class="fas fa-upload mr-2"></i>Importer'
  }
}

// ---------------------------------------------------------------------------
// REGISTRE DE PERCEPTION (lecture seule)
// ---------------------------------------------------------------------------
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
      <td>${s.receipt_number ? `<span class="badge badge-green">${escapeHtml(s.receipt_number)}</span>${s.payments_count_today > 1 ? ` <span class="badge badge-blue">x${s.payments_count_today}</span>` : ''}` : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-6">Aucun élève dans cette classe</td></tr>'
}

function printAllReceipts() {
  const date = document.getElementById('perc-date').value || todayStr()
  if (!myClass) return
  window.open(`/static/receipts-batch.html?class_id=${myClass.id}&date=${date}`, '_blank')
}

// ---------------------------------------------------------------------------
// DETTES
// ---------------------------------------------------------------------------
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
