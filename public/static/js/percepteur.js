// ============================================================================
// Logique frontend de l'espace PERCEPTEUR
// Vue en 2 étapes : cartes KPI par classe -> clic -> détail (registre / dettes)
// ============================================================================
let currentUser = null
let currentSchool = null
let myClasses = []
let trimesters = []
let currentPerceptionClass = null // { id, name }
let currentDebtsClass = null // { id, name }

async function init() {
  const data = await guardAuth(['percepteur'])
  if (!data) return
  currentUser = data.user
  currentSchool = data.school
  document.getElementById('user-info').innerHTML = `<i class="fas fa-user-circle mr-1"></i>${escapeHtml(data.user.name)}`
  document.getElementById('school-name-label').textContent = data.school ? data.school.name : 'École'
  document.getElementById('perc-summary-date').value = todayStr()

  setupTabs()

  const classesRes = await Api.get('/api/perception/my-classes')
  myClasses = classesRes.classes
  const trimRes = await Api.get('/api/shared/trimesters')
  trimesters = trimRes.trimesters

  populateSelectors()

  if (myClasses.length === 0) {
    document.getElementById('perception-classes-grid').innerHTML = '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucune classe ne vous est affectée. Contactez l\'administrateur de votre école.</p>'
  } else {
    await loadPerceptionClasses()
  }
}

function setupTabs() {
  document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.nav-link[data-tab]').forEach(l => l.classList.remove('active'))
      link.classList.add('active')
      document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'))
      document.getElementById('tab-' + link.dataset.tab).classList.remove('hidden')
      if (link.dataset.tab === 'perception') {
        currentPerceptionClass = null
        document.getElementById('perception-detail-view').classList.add('hidden')
        document.getElementById('perception-classes-view').classList.remove('hidden')
        loadPerceptionClasses()
      }
      if (link.dataset.tab === 'debts') {
        currentDebtsClass = null
        document.getElementById('debts-detail-view').classList.add('hidden')
        document.getElementById('debts-classes-view').classList.remove('hidden')
        loadDebtsClasses()
      }
    })
  })
}

function populateSelectors() {
  const trimOptions = trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
  document.getElementById('perc-summary-trimester').innerHTML = trimOptions
  document.getElementById('perc-trimester').innerHTML = trimOptions
  document.getElementById('debt-summary-trimester').innerHTML = trimOptions
}

// ---------------------------------------------------------------------------
// PERCEPTION : vue 1 (cartes KPI par classe)
// ---------------------------------------------------------------------------
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
    </div>`).join('') || '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucune classe ne vous est affectée</p>'
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

// ---------------------------------------------------------------------------
// PERCEPTION : vue 2 (détail / registre journalier d'une classe)
// ---------------------------------------------------------------------------
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
        ${s.payment_id ? `<button onclick="printReceipt(${s.payment_id})" class="text-blue-600 hover:underline text-xs font-semibold"><i class="fas fa-print"></i> Reçu</button>` : ''}
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

function printReceipt(paymentId) {
  window.open(`/static/receipt.html?payment_id=${paymentId}`, '_blank')
}

function printAllReceipts() {
  if (!currentPerceptionClass) return
  const date = document.getElementById('perc-date').value || todayStr()
  window.open(`/static/receipts-batch.html?class_id=${currentPerceptionClass.id}&date=${date}`, '_blank')
}

// ---------------------------------------------------------------------------
// DETTES : vue 1 (cartes KPI par classe)
// ---------------------------------------------------------------------------
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
    </div>`).join('') || '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucune classe ne vous est affectée</p>'
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

// ---------------------------------------------------------------------------
// DETTES : vue 2 (détail des dettes d'une classe)
// ---------------------------------------------------------------------------
async function loadDebts() {
  if (!currentDebtsClass) return
  const classId = currentDebtsClass.id
  const trimesterId = document.getElementById('debt-summary-trimester').value
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
    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-6">Aucune dette 🎉</td></tr>'
}

init()
