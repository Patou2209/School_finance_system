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
