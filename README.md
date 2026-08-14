# Plateforme de Gestion Financière Scolaire

## 1. Aperçu du projet
- **Nom** : Plateforme de Gestion Financière Scolaire (multi-écoles)
- **Objectif** : digitaliser la gestion financière d'établissements scolaires (RD Congo) en reproduisant fidèlement les registres papier existants : **registre de perception journalière** et **livre de caisse**, tout en ajoutant prévision budgétaire et rapports financiers.
- **Stack** : Hono (TypeScript) + Cloudflare Workers/Pages + Cloudflare D1 (SQLite) + HTML/CSS (Tailwind CDN) + JavaScript vanilla (frontend multi-pages, sans framework).
- **Multi-tenant** : une seule installation sert plusieurs écoles, chacune totalement isolée (données cloisonnées par `school_id`).

## 2. Rôles et hiérarchie
```
SUPER ADMIN (plateforme)
   └── crée / active / désactive des ÉCOLES
   └── crée le 1er compte ADMIN de chaque école

ADMIN (par école)
   └── crée les ANNÉES SCOLAIRES (+ 3 TRIMESTRES automatiques)
   └── crée les CLASSES
        → un compte de connexion (email + mot de passe) est généré
          AUTOMATIQUEMENT pour chaque classe (rôle "classe")
   └── crée le PERSONNEL (ENSEIGNANTS, PERCEPTEURS) avec identifiants
        → les PERCEPTEURS se connectent avec CES identifiants pour
          percevoir dans la/les classe(s) qui leur sont affectées
   └── affecte enseignant(s) et percepteur(s) (≥1) à chaque classe
   └── inscrit les ÉLÈVES dans les classes
   └── fixe les FRAIS SCOLAIRES par classe × trimestre
   └── consulte perception, dettes, budget, livre de caisse, rapports
   └── garde la possibilité d'OUVRIR CHAQUE CLASSE à tout moment et de
       voir tout son contenu (élèves, frais, affectations, paiements,
       identifiants), et peut régénérer le mot de passe d'une classe

CLASSE (compte dédié par classe, créé automatiquement)
   └── se connecte avec l'email + mot de passe générés à la création
   └── consultation en LECTURE SEULE de ses propres informations :
       élèves, registre de perception du jour, dettes, frais fixés
   └── ne peut PAS enregistrer de paiement (réservé aux percepteurs/admin)

PERCEPTEUR (par classe, un ou plusieurs par classe)
   └── se connecte avec l'email + mot de passe fournis par l'admin
   └── enregistre les paiements des élèves de ses classes (registre journalier)
   └── génère les reçus
   └── consulte les listes de dettes de ses classes

ENSEIGNANT (par classe)
   └── consultation (lecture) des informations de sa/ses classe(s)
```

## 3. Modules fonctionnels

### 3.1 Prévision budgétaire
Catégories de type **RECETTE** / **DEPENSE** (créées par défaut + personnalisables). L'admin fixe un montant **prévu** par catégorie, à portée **annuelle** ou **par trimestre**. Le système compare automatiquement au **réalisé** (agrégé depuis le livre de caisse) et calcule l'écart et le taux de réalisation.

### 3.2 Livre de caisse
Reproduit le modèle papier (Image fournie) : colonnes **Date, Code (F/B/R/AUT), Libellé, Réf., Entrée, Sortie, Solde**.
- Le **solde est calculé côté serveur, de façon cumulative**, dans l'ordre chronologique.
- Chaque jour de perception génère **automatiquement une seule ligne agrégée "Frais scolaire"** (somme de tous les paiements du jour), exactement comme sur le registre papier où le total journalier du registre de perception est reporté globalement dans le livre de caisse. Cette ligne est marquée `is_auto=1`, non modifiable manuellement, et se resynchronise automatiquement à chaque nouveau paiement ou annulation du même jour.
- Les autres opérations (dépenses, autres recettes) sont saisies manuellement par l'admin avec leur code de pièce justificative (F=Facture, B=Bon, R=Reçu, AUT=Autodéclaration) et leur référence (ex: `B01/25`, `F2260`).

### 3.3 Rapport financier (3 trimestres)
Pour chaque trimestre : total attendu (frais fixés × effectifs), total perçu, taux de recouvrement, détail par classe, dépenses par catégorie, top 10 des débiteurs. Vue "année" comparant les 3 trimestres.

### 3.4 Perception des frais scolaires
- **Registre de perception journalière** (reproduit l'Image 1) : par classe + jour + trimestre, liste tous les élèves avec statut de paiement du jour.
- **Reçu généré automatiquement** à chaque paiement : nom de l'école, classe, trimestre, nom de l'élève, montant payé, dette restante, jour et date, zones de signature et sceau du percepteur. Numérotation séquentielle unique par école/année (`REC-<CODE_ECOLE>-<ANNEE>-000123`).
- **Listes de dettes** : élèves n'ayant pas soldé leurs frais pour un trimestre donné, par classe ou toutes classes confondues.

## 4. Modèle de données (Cloudflare D1 / SQLite)
Tables principales (voir `migrations/0001_initial_schema.sql`) :
- `schools`, `users` (rôles : super_admin/admin/enseignant/percepteur)
- `school_years`, `trimesters` (3 par année, générés automatiquement)
- `classes`, `class_teachers`, `class_percepteurs` (affectations N-N)
- `students`
- `fee_structures` (frais fixé par classe × trimestre)
- `receipt_sequences` (compteur de reçus par école/année)
- `payments` (registre de perception — chaque ligne = 1 versement = 1 reçu)
- `budget_categories`, `budget_previsions`
- `cash_book_entries` (livre de caisse ; `is_auto=1` = agrégat "Frais scolaire" généré depuis `payments`)

## 5. URLs / points d'entrée
| Page | Chemin |
|---|---|
| Connexion / Bootstrap super admin | `/static/index.html` |
| Espace Super Admin | `/static/superadmin.html` |
| Espace Admin École | `/static/admin.html` |
| Espace Percepteur | `/static/percepteur.html` |
| Espace Classe (lecture seule) | `/static/classe.html` |
| Espace Enseignant | `/static/enseignant.html` |
| Reçu imprimable | `/static/receipt.html?payment_id=<id>` |

### API principales
- `POST /api/bootstrap` — crée le 1er super admin (une seule fois)
- `POST /api/auth/login` / `logout` / `GET /api/auth/me`
- `GET|POST|PATCH|DELETE /api/superadmin/schools` — gestion écoles (super admin)
- `GET|POST|PATCH|DELETE /api/admin/*` — années, classes, personnel, élèves, frais, catégories (admin)
  - `POST /api/admin/classes` — crée la classe **et** génère automatiquement son compte de connexion (email + mot de passe retournés une seule fois dans la réponse `class_login`)
  - `POST /api/admin/classes/:id/regenerate-password` — régénère le mot de passe du compte de la classe
  - `GET /api/admin/classes/:id/detail` — vue complète d'une classe pour l'école (élèves, frais, affectations, identifiants, derniers paiements)
- `GET|POST /api/classe/*` (lecture seule, rôle "classe") — `/me`, `/students`, `/fees`, `/registre`, `/debts`, `/student/:id/situation`
- `GET /api/perception/registre` — registre journalier ; `POST /api/perception/pay` — paiement + reçu ; `GET /api/perception/debts` — dettes
- `GET /api/perception/receipt/:paymentId` — données du reçu
- `GET|POST|PATCH|DELETE /api/cashbook` — livre de caisse
- `GET|POST|DELETE /api/budget/previsions`, `GET /api/budget/comparison`
- `GET /api/reports/trimester/:id`, `GET /api/reports/year-summary`

## 6. Workflow d'utilisation
1. **Premier lancement** : ouvrir `/static/index.html` → le formulaire "Bootstrap" apparaît car aucun super admin n'existe → créer le super admin.
2. **Super admin** se connecte → crée une **école** (nom, code unique, année scolaire) → un **compte admin** est créé automatiquement pour cette école.
3. **Admin école** se connecte → :
   - Vérifie/ajuste l'**année scolaire** courante (3 trimestres créés automatiquement) ;
   - Crée les **classes** (un compte de connexion classe email+mot de passe est généré automatiquement et affiché une seule fois — à noter/communiquer immédiatement) ;
   - Crée le **personnel** (enseignants, percepteurs) avec leurs identifiants (email + mot de passe choisis par l'admin) puis **affecte** chacun à une ou plusieurs classes (chaque classe doit avoir ≥1 percepteur pour pouvoir percevoir) — c'est avec ces identifiants que le percepteur se connectera pour percevoir dans la classe qui lui est assignée ;
   - Inscrit les **élèves** dans leurs classes, un par un ou en masse via le bouton **"Importer (Excel/CSV)"** (onglet Élèves) — le fichier doit contenir une seule colonne "Nom et post-nom" (une ligne = un élève), le nom et le post-nom sont séparés automatiquement (1er mot = nom, reste = post-nom) ;
   - Fixe les **frais scolaires** par classe × trimestre ;
   - (optionnel) définit les **prévisions budgétaires** par catégorie.
4. **Percepteur** se connecte à son espace dédié (avec les identifiants créés par l'admin) → sélectionne sa classe, le trimestre, le jour → le **registre journalier** liste tous les élèves de la classe → clique "Percevoir" pour un élève → saisit le montant → le **reçu s'imprime automatiquement** (nom école, classe, trimestre, élève, montant payé, dette restante, date, signature/sceau) → la ligne "Frais scolaire" du **livre de caisse** se met à jour automatiquement.
5. **Classe** (compte auto-généré à la création par l'admin) se connecte à son espace en lecture seule (`/static/classe.html`) → consulte ses élèves, le registre de perception du jour, ses dettes et ses frais fixés — aucune saisie possible depuis cet espace.
6. **Admin** consulte à tout moment : **listes de dettes**, **livre de caisse** (avec solde cumulé, saisie des dépenses/bons/factures), **budget prévu vs réalisé**, le **rapport financier** par trimestre (recouvrement, dépenses, débiteurs), et peut à tout moment **ouvrir n'importe quelle classe** (bouton "Voir") pour consulter tout son contenu ou **régénérer le mot de passe** de son compte de connexion (bouton "Mdp").

## 7. État d'avancement
### ✅ Fonctionnalités complètes et testées (API + interface)
- Authentification par rôle (JWT maison HS256, cookie HttpOnly), bootstrap super admin
- CRUD écoles (super admin), activation/désactivation
- CRUD années scolaires + génération automatique des 3 trimestres
- CRUD classes (avec génération automatique d'un compte de connexion classe email+mot de passe), personnel (enseignants/percepteurs avec identifiants), affectations N-N
- Espace **Classe** dédié en lecture seule (`/static/classe.html`) : élèves, registre du jour, dettes, frais fixés
- Vue **Admin** "Voir" une classe : détail complet (élèves, frais, affectations, identifiants, derniers paiements) + régénération du mot de passe de la classe
- CRUD élèves, import unitaire **et import en masse** (Excel/CSV, une seule colonne "Nom et post-nom" — parsing côté client via SheetJS, puis répartition automatique en `nom` / `post_nom`)
- Fixation des frais par classe × trimestre
- Registre de perception journalière + paiement + génération de reçu imprimable
- Listes de dettes par classe/trimestre
- Livre de caisse avec solde cumulé + agrégation automatique "Frais scolaire" (upsert idempotent, resynchronisation à l'annulation d'un paiement)
- Prévision budgétaire (catégories, montants prévus) + comparaison prévu/réalisé
- Rapport financier par trimestre + synthèse annuelle des 3 trimestres

### ⏳ Non implémenté / pistes d'amélioration
- Espace **Enseignant** : actuellement une coquille d'information ; il manque une route API dédiée listant les classes/élèves de l'enseignant connecté (facile à ajouter : réutiliser le modèle de `/api/perception/my-classes` avec `class_teachers`).
- Pas de gestion de mot de passe oublié (email) — actuellement seul un changement de mot de passe connecté est possible.
- Pas d'export PDF/Excel des rapports (actuellement impression navigateur uniquement).
- Pas de graphiques (Chart.js) sur les rapports — actuellement uniquement des tableaux.
- Le solde initial du livre de caisse (report d'exercice précédent) doit être saisi manuellement comme première ligne (recette) ; pas de champ dédié "solde d'ouverture" par année scolaire.

## 8. Développement local
```bash
npm install
npm run build
npm run db:migrate:local      # applique migrations/*.sql sur D1 local
pm2 start ecosystem.config.cjs
curl http://localhost:3000/api/bootstrap/status
```

## 9. Déploiement
Base D1 nommée `webapp-production` (binding `DB`) déclarée dans `wrangler.jsonc`. Avant le premier déploiement en production :
```bash
npx wrangler d1 create webapp-production   # copier le database_id retourné dans wrangler.jsonc
npx wrangler d1 migrations apply webapp-production   # sur la base distante
npm run deploy
```

## 10. Sécurité
- Mots de passe hachés avec PBKDF2-SHA256 (100 000 itérations, sel aléatoire par utilisateur).
- Sessions via JWT signé HMAC-SHA256, stocké en cookie `HttpOnly`, valable 7 jours.
- Toutes les routes métier vérifient le rôle **et** l'appartenance à l'école (`school_id`) pour empêcher tout accès croisé entre écoles.
- Un percepteur ne peut percevoir que pour les classes qui lui sont explicitement affectées.
