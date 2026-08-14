// ============================================================================
// Routes PERCEPTION : registre de perception journalière, paiements, reçus,
// listes de dettes. Accessible aux rôles percepteur et admin.
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { getCurrentSchoolYear, nextReceiptNumber, syncCashbookAutoEntry, getTotalPaid, getFeeAmount } from '../utils/db'

const perception = new Hono<AppEnv>()
perception.use('*', requireAuth, requireRole('admin', 'percepteur'))

// GET /api/perception/my-classes - classes affectées au percepteur connecté (ou toutes si admin)
perception.get('/my-classes', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  if (user.role === 'admin') {
    const { results } = await db
      .prepare(`SELECT * FROM classes WHERE school_id = ? ORDER BY name`)
      .bind(user.school_id)
      .all()
    return c.json({ classes: results })
  }
  const { results } = await db
    .prepare(
      `SELECT cl.* FROM classes cl
       JOIN class_percepteurs cp ON cp.class_id = cl.id
       WHERE cp.percepteur_id = ? AND cl.school_id = ?
       ORDER BY cl.name`
    )
    .bind(user.uid, user.school_id)
    .all()
  return c.json({ classes: results })
})

// GET /api/perception/registre?class_id=&date=&trimester_id= - registre de perception journalière (Image 1)
perception.get('/registre', async (c) => {
  const user = c.get('user')
  const classId = c.req.query('class_id')
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const trimesterId = c.req.query('trimester_id')

  if (!classId) return c.json({ error: 'class_id requis' }, 400)

  const db = c.env.DB

  // Liste des élèves de la classe avec le paiement du jour (s'il existe) pour le trimestre donné
  let studentsQuery = `
    SELECT st.id, st.nom, st.post_nom, st.prenom, st.matricule, cl.name as class_name,
      p.id as payment_id, p.montant as montant_jour, p.receipt_number
    FROM students st
    JOIN classes cl ON cl.id = st.class_id
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

// GET /api/perception/student/:id/situation?trimester_id= - situation de paiement d'un élève
perception.get('/student/:id/situation', async (c) => {
  const studentId = c.req.param('id')
  const trimesterId = c.req.query('trimester_id')
  const db = c.env.DB

  const student = await db
    .prepare(`SELECT st.*, cl.name as class_name, cl.id as class_id FROM students st JOIN classes cl ON cl.id = st.class_id WHERE st.id = ?`)
    .bind(studentId)
    .first<any>()
  if (!student) return c.json({ error: 'Élève introuvable' }, 404)

  if (!trimesterId) {
    return c.json({ student })
  }

  const feeAmount = await getFeeAmount(db, student.class_id, Number(trimesterId))
  const totalPaid = await getTotalPaid(db, Number(studentId), Number(trimesterId))
  const solde = feeAmount - totalPaid

  const payments = await db
    .prepare(
      `SELECT p.*, u.name as percepteur_name FROM payments p JOIN users u ON u.id = p.percepteur_id
       WHERE p.student_id = ? AND p.trimester_id = ? AND p.cancelled = 0 ORDER BY p.date_paiement DESC`
    )
    .bind(studentId, trimesterId)
    .all()

  return c.json({
    student,
    fee_amount: feeAmount,
    total_paid: totalPaid,
    balance: solde,
    payments: payments.results
  })
})

// POST /api/perception/pay - enregistrer un paiement + générer un reçu
perception.post('/pay', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const { student_id, trimester_id, montant, date_paiement } = await c.req.json<any>()

  if (!student_id || !trimester_id || !montant || montant <= 0) {
    return c.json({ error: 'student_id, trimester_id et montant (>0) requis' }, 400)
  }

  const student = await db.prepare(`SELECT * FROM students WHERE id = ? AND school_id = ?`).bind(student_id, user.school_id).first<any>()
  if (!student) return c.json({ error: 'Élève introuvable dans votre école' }, 404)

  // Si percepteur (non admin), vérifier qu'il est bien affecté à cette classe
  if (user.role === 'percepteur') {
    const assigned = await db
      .prepare(`SELECT id FROM class_percepteurs WHERE class_id = ? AND percepteur_id = ?`)
      .bind(student.class_id, user.uid)
      .first()
    if (!assigned) return c.json({ error: "Vous n'êtes pas percepteur de la classe de cet élève" }, 403)
  }

  const trimester = await db.prepare(`SELECT * FROM trimesters WHERE id = ?`).bind(trimester_id).first<any>()
  if (!trimester) return c.json({ error: 'Trimestre introuvable' }, 404)

  const schoolYear = await db.prepare(`SELECT * FROM school_years WHERE id = ?`).bind(trimester.school_year_id).first<any>()
  const school = await db.prepare(`SELECT * FROM schools WHERE id = ?`).bind(user.school_id).first<any>()

  const payDate = date_paiement || new Date().toISOString().slice(0, 10)
  const receiptNumber = await nextReceiptNumber(db, user.school_id, schoolYear.id, school.code, schoolYear.label.replace(/[^0-9]/g, ''))

  const result = await db
    .prepare(
      `INSERT INTO payments (school_id, student_id, class_id, trimester_id, montant, date_paiement, percepteur_id, receipt_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(user.school_id, student_id, student.class_id, trimester_id, montant, payDate, user.uid, receiptNumber)
    .run()

  // Synchroniser la ligne agrégée "Frais scolaire" du livre de caisse pour ce jour
  await syncCashbookAutoEntry(db, user.school_id, schoolYear.id, payDate, user.uid)

  const feeAmount = await getFeeAmount(db, student.class_id, Number(trimester_id))
  const totalPaid = await getTotalPaid(db, Number(student_id), Number(trimester_id))

  return c.json({
    success: true,
    payment_id: result.meta.last_row_id,
    receipt_number: receiptNumber,
    fee_amount: feeAmount,
    total_paid: totalPaid,
    balance: feeAmount - totalPaid
  })
})

// POST /api/perception/payments/:id/cancel - annuler un paiement (erreur de saisie)
perception.post('/payments/:id/cancel', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')
  const payment = await db.prepare(`SELECT * FROM payments WHERE id = ? AND school_id = ?`).bind(id, user.school_id).first<any>()
  if (!payment) return c.json({ error: 'Paiement introuvable' }, 404)

  await db.prepare(`UPDATE payments SET cancelled = 1 WHERE id = ?`).bind(id).run()

  const trimester = await db.prepare(`SELECT school_year_id FROM trimesters WHERE id = ?`).bind(payment.trimester_id).first<any>()
  await syncCashbookAutoEntry(db, user.school_id, trimester.school_year_id, payment.date_paiement, user.uid)

  return c.json({ success: true })
})

// GET /api/perception/receipt/:paymentId - données complètes pour impression du reçu
perception.get('/receipt/:paymentId', async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const paymentId = c.req.param('paymentId')

  const payment = await db
    .prepare(
      `SELECT p.*, st.nom, st.post_nom, st.prenom, cl.name as class_name, t.name as trimester_name, t.number as trimester_number,
              u.name as percepteur_name, sy.label as year_label
       FROM payments p
       JOIN students st ON st.id = p.student_id
       JOIN classes cl ON cl.id = p.class_id
       JOIN trimesters t ON t.id = p.trimester_id
       JOIN school_years sy ON sy.id = t.school_year_id
       JOIN users u ON u.id = p.percepteur_id
       WHERE p.id = ? AND p.school_id = ?`
    )
    .bind(paymentId, user.school_id)
    .first<any>()

  if (!payment) return c.json({ error: 'Paiement introuvable' }, 404)

  const school = await db.prepare(`SELECT * FROM schools WHERE id = ?`).bind(user.school_id).first<any>()
  const feeAmount = await getFeeAmount(db, payment.class_id, payment.trimester_id)
  const totalPaid = await getTotalPaid(db, payment.student_id, payment.trimester_id)

  return c.json({
    school,
    payment,
    fee_amount: feeAmount,
    total_paid: totalPaid,
    balance: feeAmount - totalPaid
  })
})

// GET /api/perception/debts?class_id=&trimester_id= - liste des dettes (élèves n'ayant pas payé intégralement)
perception.get('/debts', async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const classId = c.req.query('class_id')
  const trimesterId = c.req.query('trimester_id')

  if (!trimesterId) return c.json({ error: 'trimester_id requis' }, 400)

  let classFilter = ''
  const binds: any[] = [trimesterId, trimesterId]
  if (classId) {
    classFilter = 'AND st.class_id = ?'
  }

  let query = `
    SELECT st.id as student_id, st.nom, st.post_nom, st.prenom, st.matricule, cl.id as class_id, cl.name as class_name,
      COALESCE(fs.montant, 0) as fee_amount,
      COALESCE((SELECT SUM(p.montant) FROM payments p WHERE p.student_id = st.id AND p.trimester_id = ? AND p.cancelled = 0), 0) as total_paid
    FROM students st
    JOIN classes cl ON cl.id = st.class_id
    LEFT JOIN fee_structures fs ON fs.class_id = cl.id AND fs.trimester_id = ?
    WHERE st.active = 1 AND cl.school_id = ? ${classFilter}
  `
  binds.push(user.school_id)
  if (classId) binds.push(classId)

  const { results } = await db.prepare(query).bind(...binds).all<any>()

  const debts = results
    .map((r: any) => ({ ...r, balance: r.fee_amount - r.total_paid }))
    .filter((r: any) => r.balance > 0)
    .sort((a: any, b: any) => b.balance - a.balance)

  const totalDebt = debts.reduce((sum: number, r: any) => sum + r.balance, 0)

  return c.json({ debts, total_debt: totalDebt, count: debts.length })
})

export default perception
