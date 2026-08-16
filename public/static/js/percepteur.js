// ============================================================================
// Logique frontend de l'espace PERCEPTEUR
// ============================================================================
let currentUser = null
let currentSchool = null
let myClasses = []
let trimesters = []

async function init() {
  const data = await guardAuth(['percepteur'])
  if (!data) return
  currentUser = data.user
  currentSchool = data.school
  document.getElementById('user-info').innerHTML = `<i class="fas fa-user-circle mr-1"></i>${escapeHtml(data.user.name)}`
  document.getElementById('school-name-label').textContent = data.school ? data.school.name : 'École'
  document.getElementById('perc-date').value = todayStr()

  setupTabs()

  const classesRes = await Api.get('/api/perception/my-classes')
  myClasses = classesRes.classes
  const trimRes = await Api.get('/api/shared/trimesters')
  trimesters = trimRes.trimesters

  populateSelectors()

  if (myClasses.length === 0) {
    document.getElementById('registre-tbody').innerHTML = '<tr><td colspan="6" class="text-center text-slate-400 py-6">Aucune classe ne vous est affectée. Contactez l\'administrateur de votre école.</td></tr>'
  } else {
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
    })
  })
}

function populateSelectors() {
  const classOptions = myClasses.map(cl => `<option value="${cl.id}">${escapeHtml(cl.name)}</option>`).join('')
  document.getElementById('perc-class').innerHTML = classOptions
  document.getElementById('debt-class').innerHTML = classOptions
  const trimOptions = trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
  document.getElementById('perc-trimester').innerHTML = trimOptions
  document.getElementById('debt-trimester').innerHTML = trimOptions
}

async function loadRegistre() {
  const classId = document.getElementById('perc-class').value
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
      <td class="font-medium">${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}</td>
      <td>${escapeHtml(s.class_name)}</td>
      <td>${s.montant_jour ? fmtMoney(s.montant_jour, currentSchool?.currency) : '<span class="text-slate-400">—</span>'}</td>
      <td>${s.receipt_number ? `<span class="badge badge-green">${escapeHtml(s.receipt_number)}</span>${s.payments_count_today > 1 ? ` <span class="badge badge-blue">x${s.payments_count_today}</span>` : ''}` : '—'}</td>
      <td class="space-x-2 whitespace-nowrap">
        ${s.payment_id ? `<button onclick="printReceipt(${s.payment_id})" class="text-blue-600 hover:underline text-xs font-semibold"><i class="fas fa-print"></i> Reçu</button>` : ''}
        <button onclick="showPayModal(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', ${trimesterId})" class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-semibold"><i class="fas fa-hand-holding-dollar mr-1"></i>Percevoir</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-center text-slate-400 py-6">Aucun élève dans cette classe</td></tr>'
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
  const classId = document.getElementById('perc-class').value
  const date = document.getElementById('perc-date').value || todayStr()
  if (!classId) return
  window.open(`/static/receipts-batch.html?class_id=${classId}&date=${date}`, '_blank')
}

async function loadDebts() {
  const classId = document.getElementById('debt-class').value
  const trimesterId = document.getElementById('debt-trimester').value
  if (!classId || !trimesterId) return
  const data = await Api.get(`/api/perception/debts?trimester_id=${trimesterId}&class_id=${classId}`)

  document.getElementById('debts-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Élèves endettés</p><p class="text-xl font-bold text-red-600">${data.count}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total des dettes</p><p class="text-xl font-bold text-red-600">${fmtMoney(data.total_debt, currentSchool?.currency)}</p></div>
  `

  document.getElementById('debts-tbody').innerHTML = data.debts.map(d => `
    <tr>
      <td class="font-medium">${escapeHtml(d.nom)} ${escapeHtml(d.post_nom)}</td>
      <td>${escapeHtml(d.class_name)}</td>
      <td>${fmtMoney(d.fee_amount, currentSchool?.currency)}</td>
      <td class="text-green-600">${fmtMoney(d.total_paid, currentSchool?.currency)}</td>
      <td class="text-red-600 font-semibold">${fmtMoney(d.balance, currentSchool?.currency)}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucune dette 🎉</td></tr>'
}

init()
