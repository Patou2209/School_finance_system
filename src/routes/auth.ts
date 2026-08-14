import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { hashPassword, verifyPassword, signJWT } from '../utils/crypto'
import { getSecret, requireAuth } from '../middleware/auth'

const auth = new Hono<AppEnv>()

// POST /api/auth/login
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>()
  if (!email || !password) {
    return c.json({ error: 'Email et mot de passe requis' }, 400)
  }

  const user = await c.env.DB.prepare(
    `SELECT u.*, s.name as school_name, s.code as school_code, s.active as school_active
     FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.email = ?`
  )
    .bind(email.toLowerCase().trim())
    .first<any>()

  if (!user || !user.active) {
    return c.json({ error: 'Identifiants invalides' }, 401)
  }
  if (user.school_id && !user.school_active) {
    return c.json({ error: "Cette école a été désactivée par l'administration" }, 403)
  }

  const valid = await verifyPassword(password, user.password_hash, user.password_salt)
  if (!valid) {
    return c.json({ error: 'Identifiants invalides' }, 401)
  }

  const payload = {
    uid: user.id,
    role: user.role,
    school_id: user.school_id,
    class_id: user.class_id ?? null,
    name: user.name,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 jours
  }
  const token = await signJWT(payload, getSecret(c))

  c.header(
    'Set-Cookie',
    `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
  )

  return c.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      school_id: user.school_id,
      class_id: user.class_id ?? null,
      school_name: user.school_name,
      name: user.name,
      email: user.email
    }
  })
})

// POST /api/auth/logout
auth.post('/logout', (c) => {
  c.header('Set-Cookie', 'token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
  return c.json({ success: true })
})

// GET /api/auth/me
auth.get('/me', requireAuth, async (c) => {
  const user = c.get('user')
  let school = null
  if (user.school_id) {
    school = await c.env.DB.prepare(`SELECT id, name, code, currency, logo_url FROM schools WHERE id = ?`)
      .bind(user.school_id)
      .first()
  }
  return c.json({ user, school })
})

// POST /api/auth/change-password
auth.post('/change-password', requireAuth, async (c) => {
  const user = c.get('user')
  const { old_password, new_password } = await c.req.json<{ old_password: string; new_password: string }>()
  if (!new_password || new_password.length < 4) {
    return c.json({ error: 'Le nouveau mot de passe doit contenir au moins 4 caractères' }, 400)
  }
  const row = await c.env.DB.prepare(`SELECT password_hash, password_salt FROM users WHERE id = ?`)
    .bind(user.uid)
    .first<{ password_hash: string; password_salt: string }>()
  if (!row) return c.json({ error: 'Utilisateur introuvable' }, 404)

  const valid = await verifyPassword(old_password, row.password_hash, row.password_salt)
  if (!valid) return c.json({ error: 'Ancien mot de passe incorrect' }, 401)

  const { hash, salt } = await hashPassword(new_password)
  await c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`)
    .bind(hash, salt, user.uid)
    .run()

  return c.json({ success: true })
})

export default auth
