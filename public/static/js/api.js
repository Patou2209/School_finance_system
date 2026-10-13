// ============================================================================
// Utilitaires frontend communs : appels API, toasts, formatage, auth guard
// ============================================================================

const Api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    }
    if (body !== undefined) opts.body = JSON.stringify(body)
    const res = await fetch(path, opts)
    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (!res.ok) {
      const message = (data && data.error) || `Erreur ${res.status}`
      throw new Error(message)
    }
    return data
  },
  get(path) {
    return this.request('GET', path)
  },
  post(path, body) {
    return this.request('POST', path, body)
  },
  patch(path, body) {
    return this.request('PATCH', path, body)
  },
  del(path) {
    return this.request('DELETE', path)
  }
}

function toast(message, type = 'info') {
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    document.body.appendChild(container)
  }
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = message
  container.appendChild(el)
  setTimeout(() => el.remove(), 3500)
}

function fmtMoney(n, currency = 'CDF') {
  const num = Number(n || 0)
  return num.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' ' + currency
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''))
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function escapeHtml(str) {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Vérifie la session et redirige vers login si absente ; vérifie aussi le rôle attendu. */
async function guardAuth(expectedRoles) {
  try {
    const data = await Api.get('/api/auth/me')
    if (expectedRoles && !expectedRoles.includes(data.user.role)) {
      redirectByRole(data.user.role)
      return null
    }
    return data
  } catch (e) {
    window.location.href = '/static/index.html'
    return null
  }
}

function redirectByRole(role) {
  const map = {
    super_admin: '/static/superadmin.html',
    admin: '/static/admin.html',
    percepteur: '/static/percepteur.html',
    enseignant: '/static/enseignant.html',
    classe: '/static/classe.html'
  }
  window.location.href = map[role] || '/static/index.html'
}

async function doLogout() {
  try {
    await Api.post('/api/auth/logout')
  } catch {}
  window.location.href = '/static/index.html'
}

/* ----------------------------------------------------------------------------
   RECHERCHE GÉNÉRALE D'ÉLÈVES (percepteur + admin)
   Nécessite sur la page : showPayModal(), showStudentReceipts(), categoryBadge()
   et un <select> de trimestre dont l'id est passé en paramètre.
---------------------------------------------------------------------------- */
function setupStudentSearch({ inputId, resultsId, trimesterSelectId }) {
  const input = document.getElementById(inputId)
  const resultsBox = document.getElementById(resultsId)
  if (!input || !resultsBox) return
  let timer = null

  const hide = () => { resultsBox.classList.add('hidden'); resultsBox.innerHTML = '' }

  input.addEventListener('input', () => {
    clearTimeout(timer)
    const q = input.value.trim()
    if (q.length < 2) { hide(); return }
    timer = setTimeout(async () => {
      try {
        const { students } = await Api.get(`/api/perception/search-students?q=${encodeURIComponent(q)}`)
        if (!students.length) {
          resultsBox.innerHTML = '<div class="p-4 text-sm text-slate-400 text-center">Aucun élève trouvé</div>'
          resultsBox.classList.remove('hidden')
          return
        }
        const trimesterId = document.getElementById(trimesterSelectId)?.value || ''
        resultsBox.innerHTML = students.map(s => `
          <div class="search-result-item">
            <div class="min-w-0">
              <p class="font-semibold text-slate-800 text-sm truncate">${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)} ${escapeHtml(s.prenom || '')}</p>
              <p class="text-xs text-slate-500">${escapeHtml(s.class_name)}${s.class_option ? ' — ' + escapeHtml(s.class_option) : ''} ${typeof categoryBadge === 'function' ? categoryBadge(s.categorie) : ''}</p>
            </div>
            <div class="flex gap-1.5 shrink-0">
              <button onclick="hideStudentSearch('${resultsId}'); showStudentReceipts(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', ${trimesterId})" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold" title="Situation & reçus"><i class="fas fa-receipt"></i></button>
              <button onclick="hideStudentSearch('${resultsId}'); showPayModal(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', ${trimesterId})" class="bg-green-600 hover:bg-green-700 text-white px-2.5 py-1.5 rounded text-xs font-semibold"><i class="fas fa-hand-holding-dollar mr-1"></i>Percevoir</button>
            </div>
          </div>`).join('')
        resultsBox.classList.remove('hidden')
      } catch (e) { hide() }
    }, 300)
  })

  // Fermer si clic en dehors
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !resultsBox.contains(e.target)) hide()
  })
}

function hideStudentSearch(resultsId) {
  const box = document.getElementById(resultsId)
  if (box) { box.classList.add('hidden'); box.innerHTML = '' }
}

/* ----------------------------------------------------------------------------
   Sidebar mobile (responsive) : injecte un topbar + overlay et gère l'ouverture.
   Appelé automatiquement au chargement si un <aside class="app-sidebar"> existe.
---------------------------------------------------------------------------- */
function setupMobileSidebar() {
  const sidebar = document.querySelector('aside.app-sidebar')
  if (!sidebar || document.getElementById('mobile-topbar')) return

  const title = document.title.split('—')[0].trim() || 'Menu'
  const topbar = document.createElement('div')
  topbar.id = 'mobile-topbar'
  topbar.innerHTML = `
    <div class="burger" id="sidebar-burger"><i class="fas fa-bars"></i></div>
    <span class="topbar-title">${escapeHtml(title)}</span>`
  document.body.prepend(topbar)

  const overlay = document.createElement('div')
  overlay.id = 'sidebar-overlay'
  document.body.appendChild(overlay)

  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('show') }
  const open = () => { sidebar.classList.add('open'); overlay.classList.add('show') }

  document.getElementById('sidebar-burger').addEventListener('click', () => {
    sidebar.classList.contains('open') ? close() : open()
  })
  overlay.addEventListener('click', close)
  // Fermer le tiroir quand on clique sur un lien de navigation
  sidebar.querySelectorAll('.nav-link').forEach(l => l.addEventListener('click', close))
}
document.addEventListener('DOMContentLoaded', setupMobileSidebar)

function openModal(html) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.id = 'modal-overlay'
  overlay.innerHTML = `<div class="modal-box">${html}</div>`
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal()
  })
  document.body.appendChild(overlay)
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay')
  if (overlay) overlay.remove()
}
