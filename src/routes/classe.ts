// ============================================================================
// Routes ESPACE CLASSE : consultation en lecture seule pour le compte de
// connexion propre à une classe (rôle 'classe'). Chaque classe créée par
// l'admin dispose d'un email + mot de passe pour se connecter et consulter
// ses propres informations (élèves, frais, registre de perception, dettes).
// Aucune écriture n'est permise depuis cet espace : la saisie des paiements
// reste réservée aux percepteurs / à l'admin.
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { getFeeAmount, getTotalPaid } from '../utils/db'

const classe = new Hono<AppEnv>()
classe.use('*', requireAuth, requireRole('classe'))

function myClassId(c: any): number {
  return c.get('user').class_id
}

// GET /api/classe/me - infos de la classe connectée
classe.get('/me', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const cls = await db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(classId).first<any>()
  if (!cls) return c.json({ error: 'Classe introuvable' }, 404)
  const teachers = await db
    .prepare(`SELECT u.id, u.name FROM class_teachers ct JOIN users u ON u.id = ct.teacher_id WHERE ct.class_id = ?`)
    .bind(classId)
    .all()
  const percepteurs = await db
    .prepare(`SELECT u.id, u.name FROM class_percepteurs cp JOIN users u ON u.id = cp.percepteur_id WHERE cp.class_id = ?`)
    .bind(classId)
    .all()
  return c.json({ class: cls, teachers: teachers.results, percepteurs: percepteurs.results })
})

// GET /api/classe/students - liste des élèves de la classe
classe.get('/students', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const { results } = await db
    .prepare(`SELECT * FROM students WHERE class_id = ? AND active = 1 ORDER BY nom, post_nom`)
    .bind(classId)
    .all()
  return c.json({ students: results })
})

// GET /api/classe/fees - frais fixés par trimestre pour la classe
classe.get('/fees', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const { results } = await db
    .prepare(
      `SELECT fs.*, t.name as trimester_name, t.number as trimester_number
       FROM fee_structures fs JOIN trimesters t ON t.id = fs.trimester_id
       WHERE fs.class_id = ? ORDER BY t.number`
    )
    .bind(classId)
    .all()
  return c.json({ fee_structures: results })
})

// GET /api/classe/registre?date=&trimester_id= - registre de perception journalière (lecture seule)
classe.get('/registre', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const trimesterId = c.req.query('trimester_id')

  let studentsQuery = `
    SELECT st.id, st.nom, st.post_nom, st.prenom, st.matricule,
      p.id as payment_id, p.montant as montant_jour, p.receipt_number
    FROM students st
    LEFT JOIN payments p ON p.student_id = st.id AND p.date_paiement = ? AND p.cancelled = 0
      ${trimesterId ? 'AND p.trimester_id = ?' : ''}
    WHERE st.class_id = ? AND st.active = 1
    ORDER BY st.nom ASC, st.post_nom ASC
  `
  const binds: any[] = trimesterId ? [date, trimesterId, classId] : [date, classId]
  const { results: students } = await db.prepare(studentsQuery).bind(...binds).all()

  const totalRow = await db
    .prepare(
      `SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as cnt FROM payments
       WHERE class_id = ? AND date_paiement = ? AND cancelled = 0 ${trimesterId ? 'AND trimester_id = ?' : ''}`
    )
    .bind(...(trimesterId ? [classId, date, trimesterId] : [classId, date]))
    .first<{ total: number; cnt: number }>()

  return c.json({ date, students, total: totalRow?.total ?? 0, count: totalRow?.cnt ?? 0 })
})

// GET /api/classe/debts?trimester_id= - dettes des élèves de la classe
classe.get('/debts', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const trimesterId = c.req.query('trimester_id')
  if (!trimesterId) return c.json({ error: 'trimester_id requis' }, 400)

  const { results } = await db
    .prepare(
      `SELECT st.id as student_id, st.nom, st.post_nom, st.prenom, st.matricule,
        COALESCE(fs.montant, 0) as fee_amount,
        COALESCE((SELECT SUM(p.montant) FROM payments p WHERE p.student_id = st.id AND p.trimester_id = ? AND p.cancelled = 0), 0) as total_paid
       FROM students st
       LEFT JOIN fee_structures fs ON fs.class_id = st.class_id AND fs.trimester_id = ?
       WHERE st.active = 1 AND st.class_id = ?`
    )
    .bind(trimesterId, trimesterId, classId)
    .all<any>()

  const debts = results
    .map((r: any) => ({ ...r, balance: r.fee_amount - r.total_paid }))
    .filter((r: any) => r.balance > 0)
    .sort((a: any, b: any) => b.balance - a.balance)

  const totalDebt = debts.reduce((sum: number, r: any) => sum + r.balance, 0)
  return c.json({ debts, total_debt: totalDebt, count: debts.length })
})

// GET /api/classe/student/:id/situation?trimester_id= - situation d'un élève de la classe
classe.get('/student/:id/situation', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const studentId = c.req.param('id')
  const trimesterId = c.req.query('trimester_id')

  const student = await db
    .prepare(`SELECT * FROM students WHERE id = ? AND class_id = ?`)
    .bind(studentId, classId)
    .first<any>()
  if (!student) return c.json({ error: 'Élève introuvable dans cette classe' }, 404)

  if (!trimesterId) return c.json({ student })

  const feeAmount = await getFeeAmount(db, classId, Number(trimesterId))
  const totalPaid = await getTotalPaid(db, Number(studentId), Number(trimesterId))
  const payments = await db
    .prepare(
      `SELECT p.*, u.name as percepteur_name FROM payments p JOIN users u ON u.id = p.percepteur_id
       WHERE p.student_id = ? AND p.trimester_id = ? AND p.cancelled = 0 ORDER BY p.date_paiement DESC`
    )
    .bind(studentId, trimesterId)
    .all()

  return c.json({ student, fee_amount: feeAmount, total_paid: totalPaid, balance: feeAmount - totalPaid, payments: payments.results })
})

export default classe
