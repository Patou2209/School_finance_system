// ============================================================================
// Routes ADMIN ECOLE : années scolaires, classes, enseignants, percepteurs,
// élèves, structure des frais
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { hashPassword, signJWT } from '../utils/crypto'
import { getSecret } from '../middleware/auth'

const admin = new Hono<AppEnv>()
admin.use('*', requireAuth, requireRole('admin'))

function schoolId(c: any): number {
  return c.get('user').school_id
}

/** Valide le format d'une année scolaire "à la RDC" : deux années consécutives, ex. "2025-2026". */
function isValidSchoolYearLabel(label: string): boolean {
  const m = /^(\d{4})-(\d{4})$/.exec(String(label || '').trim())
  if (!m) return false
  const y1 = parseInt(m[1], 10)
  const y2 = parseInt(m[2], 10)
  return y2 === y1 + 1
}

/** Niveaux de classe autorisés. */
const ALLOWED_LEVELS = ['CTEB', 'Humanitaire', 'Primaire']

// ---------------------------------------------------------------------------
// ANNEES SCOLAIRES
// ---------------------------------------------------------------------------
admin.get('/school-years', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM school_years WHERE school_id = ? ORDER BY id DESC`
  )
    .bind(schoolId(c))
    .all()
  return c.json({ school_years: results })
})

admin.post('/school-years', async (c) => {
  const { label, start_date, end_date, set_current } = await c.req.json<any>()
  if (!label) return c.json({ error: 'Le libellé est requis' }, 400)
  if (!isValidSchoolYearLabel(label)) {
    return c.json({ error: 'Le libellé doit être au format "AAAA-AAAA" avec deux années consécutives (ex: 2025-2026)' }, 400)
  }
  const sid = schoolId(c)

  if (set_current) {
    await c.env.DB.prepare(`UPDATE school_years SET is_current = 0 WHERE school_id = ?`).bind(sid).run()
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO school_years (school_id, label, start_date, end_date, is_current) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(sid, label, start_date || null, end_date || null, set_current ? 1 : 0)
    .run()
  const yearId = result.meta.last_row_id as number

  for (let i = 1; i <= 3; i++) {
    await c.env.DB.prepare(`INSERT INTO trimesters (school_year_id, number, name) VALUES (?, ?, ?)`)
      .bind(yearId, i, `${i === 1 ? '1er' : i + 'ème'} Trimestre`)
      .run()
  }
  return c.json({ success: true, id: yearId })
})

admin.patch('/school-years/:id/set-current', async (c) => {
  const sid = schoolId(c)
  const id = c.req.param('id')
  await c.env.DB.prepare(`UPDATE school_years SET is_current = 0 WHERE school_id = ?`).bind(sid).run()
  await c.env.DB.prepare(`UPDATE school_years SET is_current = 1 WHERE id = ? AND school_id = ?`).bind(id, sid).run()
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// TRIMESTRES
// ---------------------------------------------------------------------------
admin.get('/trimesters', async (c) => {
  const yearId = c.req.query('school_year_id')
  const sid = schoolId(c)
  let query = `SELECT t.* FROM trimesters t JOIN school_years sy ON sy.id = t.school_year_id WHERE sy.school_id = ?`
  const binds: any[] = [sid]
  if (yearId) {
    query += ` AND t.school_year_id = ?`
    binds.push(yearId)
  }
  query += ` ORDER BY t.school_year_id DESC, t.number ASC`
  const { results } = await c.env.DB.prepare(query).bind(...binds).all()
  return c.json({ trimesters: results })
})

// ---------------------------------------------------------------------------
// CLASSES
// ---------------------------------------------------------------------------
admin.get('/classes', async (c) => {
  const sid = schoolId(c)
  const yearId = c.req.query('school_year_id')
  let query = `
    SELECT cl.*, 
      (SELECT COUNT(*) FROM students st WHERE st.class_id = cl.id AND st.active = 1) as student_count,
      (SELECT COUNT(*) FROM class_percepteurs cp WHERE cp.class_id = cl.id) as percepteur_count,
      (SELECT COUNT(*) FROM class_teachers ct WHERE ct.class_id = cl.id) as teacher_count,
      (SELECT u.email FROM users u WHERE u.class_id = cl.id AND u.role = 'classe' LIMIT 1) as login_email,
      (SELECT u.active FROM users u WHERE u.class_id = cl.id AND u.role = 'classe' LIMIT 1) as login_active
    FROM classes cl WHERE cl.school_id = ?`
  const binds: any[] = [sid]
  if (yearId) {
    query += ` AND cl.school_year_id = ?`
    binds.push(yearId)
  }
  query += ` ORDER BY cl.name ASC`
  const { results } = await c.env.DB.prepare(query).bind(...binds).all()
  return c.json({ classes: results })
})

// POST /classes - crée la classe ET son compte de connexion dédié (rôle 'classe').
// L'admin choisit lui-même l'email et le mot de passe de connexion de la classe
// (plus d'auto-génération). Le niveau doit être l'un des 3 niveaux autorisés, et
// le nom est composé côté frontend (ordinal + étiquette, ex: "2ème A").
admin.post('/classes', async (c) => {
  const { name, level, school_year_id, login_email, login_password } = await c.req.json<any>()
  if (!name || !school_year_id) return c.json({ error: 'Nom et année scolaire requis' }, 400)
  if (level && !ALLOWED_LEVELS.includes(level)) {
    return c.json({ error: `Niveau invalide (autorisés: ${ALLOWED_LEVELS.join(', ')})` }, 400)
  }
  if (!login_email || !login_password) {
    return c.json({ error: "L'email et le mot de passe de connexion de la classe sont requis" }, 400)
  }
  if (login_password.length < 4) {
    return c.json({ error: 'Le mot de passe doit contenir au moins 4 caractères' }, 400)
  }
  const db = c.env.DB
  const sid = schoolId(c)

  const school = await db.prepare(`SELECT code FROM schools WHERE id = ?`).bind(sid).first<{ code: string }>()
  if (!school) return c.json({ error: 'École introuvable' }, 404)

  const emailNorm = String(login_email).toLowerCase().trim()
  const existingEmail = await db.prepare(`SELECT id FROM users WHERE email = ?`).bind(emailNorm).first()
  if (existingEmail) return c.json({ error: 'Cet email de connexion est déjà utilisé' }, 409)

  let classId: number
  try {
    const result = await db
      .prepare(`INSERT INTO classes (school_id, school_year_id, name, level) VALUES (?, ?, ?, ?)`)
      .bind(sid, school_year_id, name, level || null)
      .run()
    classId = result.meta.last_row_id as number
  } catch (e: any) {
    return c.json({ error: 'Cette classe existe déjà pour cette année scolaire' }, 409)
  }

  const { hash, salt } = await hashPassword(login_password)
  await db
    .prepare(
      `INSERT INTO users (school_id, role, class_id, name, email, password_hash, password_salt) VALUES (?, 'classe', ?, ?, ?, ?, ?)`
    )
    .bind(sid, classId, `Classe ${name}`, emailNorm, hash, salt)
    .run()

  return c.json({
    success: true,
    id: classId,
    class_login: { email: emailNorm, password: login_password }
  })
})

admin.patch('/classes/:id', async (c) => {
  const { name, level } = await c.req.json<any>()
  if (level && !ALLOWED_LEVELS.includes(level)) {
    return c.json({ error: `Niveau invalide (autorisés: ${ALLOWED_LEVELS.join(', ')})` }, 400)
  }
  await c.env.DB.prepare(`UPDATE classes SET name = COALESCE(?, name), level = COALESCE(?, level) WHERE id = ? AND school_id = ?`)
    .bind(name, level, c.req.param('id'), schoolId(c))
    .run()
  return c.json({ success: true })
})

admin.delete('/classes/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM classes WHERE id = ? AND school_id = ?`).bind(c.req.param('id'), schoolId(c)).run()
  return c.json({ success: true })
})

// PATCH /classes/:id/login - l'admin définit/modifie lui-même l'email et/ou le mot de passe
// de connexion de la classe (plus d'auto-génération). Si la classe n'a pas encore de compte
// (cas d'anciennes données), il est créé à la volée avec les identifiants fournis.
admin.patch('/classes/:id/login', async (c) => {
  const db = c.env.DB
  const sid = schoolId(c)
  const classId = c.req.param('id')
  const { email, password } = await c.req.json<any>()

  const cls = await db.prepare(`SELECT id, name FROM classes WHERE id = ? AND school_id = ?`).bind(classId, sid).first<any>()
  if (!cls) return c.json({ error: 'Classe introuvable' }, 404)
  if (!email) return c.json({ error: "L'email de connexion est requis" }, 400)
  if (password && password.length < 4) return c.json({ error: 'Le mot de passe doit contenir au moins 4 caractères' }, 400)

  const emailNorm = String(email).toLowerCase().trim()
  const account = await db.prepare(`SELECT id, email FROM users WHERE class_id = ? AND role = 'classe'`).bind(classId).first<any>()

  // Vérifier l'unicité de l'email (hors compte actuel de cette classe)
  const emailClash = await db.prepare(`SELECT id FROM users WHERE email = ? AND id != ?`).bind(emailNorm, account?.id || -1).first()
  if (emailClash) return c.json({ error: 'Cet email est déjà utilisé par un autre compte' }, 409)

  if (account) {
    if (password) {
      const { hash, salt } = await hashPassword(password)
      await db.prepare(`UPDATE users SET email = ?, password_hash = ?, password_salt = ?, active = 1 WHERE id = ?`)
        .bind(emailNorm, hash, salt, account.id)
        .run()
    } else {
      await db.prepare(`UPDATE users SET email = ?, active = 1 WHERE id = ?`).bind(emailNorm, account.id).run()
    }
    return c.json({ success: true, class_login: { email: emailNorm, password: password || undefined } })
  }

  if (!password) return c.json({ error: 'Mot de passe requis pour créer le compte de connexion' }, 400)
  const { hash, salt } = await hashPassword(password)
  await db
    .prepare(`INSERT INTO users (school_id, role, class_id, name, email, password_hash, password_salt) VALUES (?, 'classe', ?, ?, ?, ?, ?)`)
    .bind(sid, classId, `Classe ${cls.name}`, emailNorm, hash, salt)
    .run()
  return c.json({ success: true, class_login: { email: emailNorm, password } })
})

// POST /classes/:id/impersonate - l'admin "ouvre" la classe et obtient un jeton
// avec le rôle 'classe' pour cette classe précise, avec accès complet comme si
// il/elle s'était connecté(e) en tant que classe. Le jeton garde une empreinte
// signée de l'admin d'origine (claim `impersonating`) pour permettre le retour.
admin.post('/classes/:id/impersonate', async (c) => {
  const db = c.env.DB
  const sid = schoolId(c)
  const classId = c.req.param('id')
  const adminUser = c.get('user')

  const cls = await db.prepare(`SELECT * FROM classes WHERE id = ? AND school_id = ?`).bind(classId, sid).first<any>()
  if (!cls) return c.json({ error: 'Classe introuvable' }, 404)

  const account = await db.prepare(`SELECT * FROM users WHERE class_id = ? AND role = 'classe'`).bind(classId).first<any>()
  if (!account) return c.json({ error: "Cette classe n'a pas encore de compte de connexion. Définissez d'abord ses identifiants." }, 404)

  const payload = {
    uid: account.id,
    role: 'classe' as const,
    school_id: account.school_id,
    class_id: account.class_id,
    name: account.name,
    email: account.email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 4, // 4h, session d'impersonation limitée
    impersonating: {
      admin_uid: adminUser.uid,
      admin_name: adminUser.name,
      admin_email: adminUser.email
    }
  }
  const token = await signJWT(payload, getSecret(c))
  c.header('Set-Cookie', `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 4}`)

  return c.json({
    success: true,
    token,
    user: { id: account.id, role: 'classe', school_id: account.school_id, class_id: account.class_id, name: account.name, email: account.email }
  })
})

// GET /classes/:id/detail - vue complète d'une classe pour l'école (admin) :
// élèves, frais fixés, affectations, identifiants de connexion.
// Permet à l'école de toujours pouvoir ouvrir n'importe quelle classe et
// consulter tout son contenu, même si la classe/le percepteur s'y connecte
// aussi de son côté.
admin.get('/classes/:id/detail', async (c) => {
  const db = c.env.DB
  const sid = schoolId(c)
  const classId = c.req.param('id')

  const cls = await db.prepare(`SELECT * FROM classes WHERE id = ? AND school_id = ?`).bind(classId, sid).first<any>()
  if (!cls) return c.json({ error: 'Classe introuvable' }, 404)

  const students = await db
    .prepare(`SELECT * FROM students WHERE class_id = ? AND active = 1 ORDER BY nom, post_nom`)
    .bind(classId)
    .all()

  const feeStructures = await db
    .prepare(
      `SELECT fs.*, t.name as trimester_name, t.number as trimester_number
       FROM fee_structures fs JOIN trimesters t ON t.id = fs.trimester_id
       WHERE fs.class_id = ? ORDER BY t.number`
    )
    .bind(classId)
    .all()

  const teachers = await db
    .prepare(`SELECT u.id, u.name, u.email FROM class_teachers ct JOIN users u ON u.id = ct.teacher_id WHERE ct.class_id = ?`)
    .bind(classId)
    .all()

  const percepteurs = await db
    .prepare(`SELECT u.id, u.name, u.email, u.active FROM class_percepteurs cp JOIN users u ON u.id = cp.percepteur_id WHERE cp.class_id = ?`)
    .bind(classId)
    .all()

  const loginAccount = await db
    .prepare(`SELECT id, email, active, created_at FROM users WHERE class_id = ? AND role = 'classe'`)
    .bind(classId)
    .first()

  const recentPayments = await db
    .prepare(
      `SELECT p.*, st.nom, st.post_nom, u.name as percepteur_name
       FROM payments p JOIN students st ON st.id = p.student_id JOIN users u ON u.id = p.percepteur_id
       WHERE p.class_id = ? AND p.cancelled = 0 ORDER BY p.date_paiement DESC, p.id DESC LIMIT 50`
    )
    .bind(classId)
    .all()

  return c.json({
    class: cls,
    students: students.results,
    fee_structures: feeStructures.results,
    teachers: teachers.results,
    percepteurs: percepteurs.results,
    login_account: loginAccount || null,
    recent_payments: recentPayments.results
  })
})

// ---------------------------------------------------------------------------
// PERSONNEL (enseignants et percepteurs) - comptes utilisateurs de l'école
// ---------------------------------------------------------------------------
admin.get('/staff', async (c) => {
  const role = c.req.query('role') // 'enseignant' | 'percepteur' | undefined (tous)
  const sid = schoolId(c)
  let query = `SELECT id, name, email, phone, role, active, created_at FROM users WHERE school_id = ? AND role IN ('enseignant','percepteur')`
  const binds: any[] = [sid]
  if (role) {
    query += ` AND role = ?`
    binds.push(role)
  }
  query += ` ORDER BY name ASC`
  const { results } = await c.env.DB.prepare(query).bind(...binds).all()
  return c.json({ staff: results })
})

admin.post('/staff', async (c) => {
  const { name, email, phone, password, role } = await c.req.json<any>()
  if (!name || !email || !password || !role) return c.json({ error: 'Champs requis manquants' }, 400)
  if (!['enseignant', 'percepteur'].includes(role)) return c.json({ error: 'Rôle invalide' }, 400)

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first()
  if (existing) return c.json({ error: 'Cet email est déjà utilisé' }, 409)

  const { hash, salt } = await hashPassword(password)
  const result = await c.env.DB.prepare(
    `INSERT INTO users (school_id, role, name, email, phone, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(schoolId(c), role, name, email.toLowerCase().trim(), phone || null, hash, salt)
    .run()
  return c.json({ success: true, id: result.meta.last_row_id })
})

admin.patch('/staff/:id', async (c) => {
  const { name, phone, active, password } = await c.req.json<any>()
  const sid = schoolId(c)
  const id = c.req.param('id')
  if (password) {
    const { hash, salt } = await hashPassword(password)
    await c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ? AND school_id = ?`)
      .bind(hash, salt, id, sid)
      .run()
  }
  await c.env.DB.prepare(
    `UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), active = COALESCE(?, active) WHERE id = ? AND school_id = ?`
  )
    .bind(name, phone, active, id, sid)
    .run()
  return c.json({ success: true })
})

admin.delete('/staff/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM users WHERE id = ? AND school_id = ?`).bind(c.req.param('id'), schoolId(c)).run()
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// AFFECTATIONS : enseignant <-> classe, percepteur <-> classe
// ---------------------------------------------------------------------------
admin.get('/classes/:id/assignments', async (c) => {
  const classId = c.req.param('id')
  const teachers = await c.env.DB.prepare(
    `SELECT ct.id as assignment_id, u.id, u.name, u.email, ct.is_titulaire
     FROM class_teachers ct JOIN users u ON u.id = ct.teacher_id WHERE ct.class_id = ?`
  )
    .bind(classId)
    .all()
  const percepteurs = await c.env.DB.prepare(
    `SELECT cp.id as assignment_id, u.id, u.name, u.email
     FROM class_percepteurs cp JOIN users u ON u.id = cp.percepteur_id WHERE cp.class_id = ?`
  )
    .bind(classId)
    .all()
  return c.json({ teachers: teachers.results, percepteurs: percepteurs.results })
})

admin.post('/classes/:id/teachers', async (c) => {
  const classId = c.req.param('id')
  const { teacher_id, is_titulaire } = await c.req.json<any>()
  try {
    await c.env.DB.prepare(
      `INSERT INTO class_teachers (class_id, teacher_id, is_titulaire) VALUES (?, ?, ?)`
    )
      .bind(classId, teacher_id, is_titulaire ? 1 : 0)
      .run()
    return c.json({ success: true })
  } catch {
    return c.json({ error: 'Cet enseignant est déjà affecté à cette classe' }, 409)
  }
})

admin.delete('/classes/:classId/teachers/:teacherId', async (c) => {
  await c.env.DB.prepare(`DELETE FROM class_teachers WHERE class_id = ? AND teacher_id = ?`)
    .bind(c.req.param('classId'), c.req.param('teacherId'))
    .run()
  return c.json({ success: true })
})

admin.post('/classes/:id/percepteurs', async (c) => {
  const classId = c.req.param('id')
  const { percepteur_id } = await c.req.json<any>()
  try {
    await c.env.DB.prepare(`INSERT INTO class_percepteurs (class_id, percepteur_id) VALUES (?, ?)`)
      .bind(classId, percepteur_id)
      .run()
    return c.json({ success: true })
  } catch {
    return c.json({ error: 'Ce percepteur est déjà affecté à cette classe' }, 409)
  }
})

admin.delete('/classes/:classId/percepteurs/:percepteurId', async (c) => {
  await c.env.DB.prepare(`DELETE FROM class_percepteurs WHERE class_id = ? AND percepteur_id = ?`)
    .bind(c.req.param('classId'), c.req.param('percepteurId'))
    .run()
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// ELEVES
// ---------------------------------------------------------------------------
admin.get('/students', async (c) => {
  const sid = schoolId(c)
  const classId = c.req.query('class_id')
  let query = `SELECT st.*, cl.name as class_name FROM students st JOIN classes cl ON cl.id = st.class_id WHERE st.school_id = ?`
  const binds: any[] = [sid]
  if (classId) {
    query += ` AND st.class_id = ?`
    binds.push(classId)
  }
  query += ` ORDER BY st.nom ASC, st.post_nom ASC`
  const { results } = await c.env.DB.prepare(query).bind(...binds).all()
  return c.json({ students: results })
})

// NOTE : l'ajout et l'import en masse d'élèves ont été déplacés vers l'espace
// CLASSE (routes/classe.ts) : seule la classe elle-même (connectée avec son
// propre compte) peut ajouter/importer SES élèves. L'admin école conserve la
// consultation (GET), la modification (PATCH) et la suppression (DELETE).

admin.patch('/students/:id', async (c) => {
  const body = await c.req.json<any>()
  const id = c.req.param('id')
  const sid = schoolId(c)
  const fields: string[] = []
  const values: any[] = []
  for (const key of ['nom', 'post_nom', 'prenom', 'sexe', 'class_id', 'matricule', 'date_naissance', 'parent_contact', 'active']) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`)
      values.push(body[key])
    }
  }
  if (fields.length === 0) return c.json({ error: 'Aucun champ à mettre à jour' }, 400)
  await c.env.DB.prepare(`UPDATE students SET ${fields.join(', ')} WHERE id = ? AND school_id = ?`)
    .bind(...values, id, sid)
    .run()
  return c.json({ success: true })
})

admin.delete('/students/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM students WHERE id = ? AND school_id = ?`).bind(c.req.param('id'), schoolId(c)).run()
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// STRUCTURE DES FRAIS (par classe x trimestre)
// ---------------------------------------------------------------------------
admin.get('/fee-structures', async (c) => {
  const sid = schoolId(c)
  const yearId = c.req.query('school_year_id')
  let query = `
    SELECT fs.*, cl.name as class_name, t.name as trimester_name, t.number as trimester_number
    FROM fee_structures fs
    JOIN classes cl ON cl.id = fs.class_id
    JOIN trimesters t ON t.id = fs.trimester_id
    WHERE fs.school_id = ?`
  const binds: any[] = [sid]
  if (yearId) {
    query += ` AND cl.school_year_id = ?`
    binds.push(yearId)
  }
  query += ` ORDER BY cl.name ASC, t.number ASC`
  const { results } = await c.env.DB.prepare(query).bind(...binds).all()
  return c.json({ fee_structures: results })
})

admin.post('/fee-structures', async (c) => {
  const { class_id, trimester_id, montant } = await c.req.json<any>()
  if (!class_id || !trimester_id || montant === undefined) {
    return c.json({ error: 'class_id, trimester_id et montant requis' }, 400)
  }
  await c.env.DB.prepare(
    `INSERT INTO fee_structures (school_id, class_id, trimester_id, montant) VALUES (?, ?, ?, ?)
     ON CONFLICT(class_id, trimester_id) DO UPDATE SET montant = excluded.montant, updated_at = CURRENT_TIMESTAMP`
  )
    .bind(schoolId(c), class_id, trimester_id, montant)
    .run()
  return c.json({ success: true })
})

admin.delete('/fee-structures/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM fee_structures WHERE id = ? AND school_id = ?`).bind(c.req.param('id'), schoolId(c)).run()
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// CATEGORIES BUDGETAIRES
// ---------------------------------------------------------------------------
admin.get('/budget-categories', async (c) => {
  const type = c.req.query('type')
  let query = `SELECT * FROM budget_categories WHERE school_id = ?`
  const binds: any[] = [schoolId(c)]
  if (type) {
    query += ` AND type = ?`
    binds.push(type)
  }
  query += ` ORDER BY type, name`
  const { results } = await c.env.DB.prepare(query).bind(...binds).all()
  return c.json({ categories: results })
})

admin.post('/budget-categories', async (c) => {
  const { type, name } = await c.req.json<any>()
  if (!type || !name) return c.json({ error: 'Type et nom requis' }, 400)
  const result = await c.env.DB.prepare(`INSERT INTO budget_categories (school_id, type, name) VALUES (?, ?, ?)`)
    .bind(schoolId(c), type, name)
    .run()
  return c.json({ success: true, id: result.meta.last_row_id })
})

admin.delete('/budget-categories/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM budget_categories WHERE id = ? AND school_id = ?`).bind(c.req.param('id'), schoolId(c)).run()
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// DASHBOARD ADMIN
// ---------------------------------------------------------------------------
admin.get('/dashboard', async (c) => {
  const sid = schoolId(c)
  const db = c.env.DB
  const classCount = await db.prepare(`SELECT COUNT(*) as n FROM classes WHERE school_id = ?`).bind(sid).first<{ n: number }>()
  const studentCount = await db.prepare(`SELECT COUNT(*) as n FROM students WHERE school_id = ? AND active = 1`).bind(sid).first<{ n: number }>()
  const staffCount = await db.prepare(`SELECT COUNT(*) as n FROM users WHERE school_id = ? AND role IN ('enseignant','percepteur')`).bind(sid).first<{ n: number }>()
  const totalCollected = await db.prepare(`SELECT COALESCE(SUM(montant),0) as total FROM payments WHERE school_id = ? AND cancelled = 0`).bind(sid).first<{ total: number }>()
  const todayCollected = await db.prepare(`SELECT COALESCE(SUM(montant),0) as total FROM payments WHERE school_id = ? AND cancelled = 0 AND date_paiement = date('now')`).bind(sid).first<{ total: number }>()

  return c.json({
    classes: classCount?.n ?? 0,
    students: studentCount?.n ?? 0,
    staff: staffCount?.n ?? 0,
    total_collected: totalCollected?.total ?? 0,
    today_collected: todayCollected?.total ?? 0
  })
})

export default admin
