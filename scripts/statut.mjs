#!/usr/bin/env node
// Page de statut de Lucerna (#493), hors de l'infrastructure de Lucerna (GitHub Pages).
// Node 20 ou plus, aucune dépendance.
//
//   node scripts/statut.mjs panne "Lucerna ne répond plus. Nous cherchons." [--services app,synchronisation] [--titre "…"]
//   node scripts/statut.mjs degrade "La synchronisation est lente." --services synchronisation
//   node scripts/statut.mjs nouvelle "Le correctif est en cours de déploiement."
//   node scripts/statut.mjs resolu "Tout est rentré dans l'ordre."
//   node scripts/statut.mjs verifier          (contrôle statut.json)
//   node scripts/statut.mjs construire        (génère _site/ : ce que publie GitHub Pages)
//
// Les commandes d'incident montrent le nouveau statut.json SANS rien écrire (essai). Avec
// --appliquer : écrit statut.json, puis git commit et git push (la page est en ligne en 1 à
// 2 minutes). --sans-envoi : écrit et commite sans pousser.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
export const ETATS = ['ok', 'degrade', 'panne']
export const SERVICES = ['app', 'synchronisation', 'paiement', 'ia']
const NOMS = {
  app: 'Application et site',
  synchronisation: 'Synchronisation entre appareils',
  paiement: 'Paiement et abonnements',
  ia: 'Fonctions d’IA',
}
const LIBELLES = { ok: 'Fonctionne', degrade: 'Perturbé', panne: 'En panne' }
const TITRES = {
  ok: 'Lucerna fonctionne normalement',
  degrade: 'Lucerna fonctionne au ralenti',
  panne: 'Lucerna est en panne',
}
const MAX_HISTORIQUE = 20

const estDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))

/** Liste des erreurs de statut.json ; vide si tout va bien. */
export function valider(s) {
  const e = []
  if (!s || typeof s !== 'object') return ['statut.json doit être un objet']
  if (!ETATS.includes(s.etat)) e.push(`etat : ${ETATS.join(', ')}`)
  if (typeof s.message !== 'string' || !s.message.trim()) e.push('message : texte obligatoire')
  if (typeof s.message === 'string' && s.message.length > 500)
    e.push('message : 500 caractères au plus')
  if (!estDate(s.maj)) e.push('maj : date ISO obligatoire')
  for (const k of SERVICES)
    if (!ETATS.includes(s.services?.[k])) e.push(`services.${k} : ${ETATS.join(', ')}`)
  for (const [nom, liste] of [
    ['incidents', s.incidents],
    ['historique', s.historique],
  ]) {
    if (!Array.isArray(liste)) {
      e.push(`${nom} : liste obligatoire`)
      continue
    }
    liste.forEach((i, n) => {
      if (typeof i?.titre !== 'string' || !i.titre.trim()) e.push(`${nom}[${n}].titre manquant`)
      if (!estDate(i?.debut)) e.push(`${nom}[${n}].debut : date ISO`)
      if (i?.fin !== null && !estDate(i?.fin)) e.push(`${nom}[${n}].fin : date ISO ou null`)
    })
  }
  // Aucune donnée personnelle : pas d'adresse e-mail dans la page publique.
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(JSON.stringify(s))) e.push('adresse e-mail interdite')
  return e
}

function horodater(now) {
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Applique une commande d'incident ; renvoie le nouveau statut (l'ancien n'est pas modifié). */
export function appliquer(statut, commande, { message, services, titre, now = Date.now() } = {}) {
  const s = structuredClone(statut)
  const maj = horodater(now)
  const touches = services?.length ? services : SERVICES
  for (const k of touches) if (!SERVICES.includes(k)) throw new Error(`service inconnu : ${k}`)
  if (commande === 'panne' || commande === 'degrade') {
    if (!message) throw new Error('message obligatoire')
    s.etat = commande
    s.message = message
    s.services = Object.fromEntries(SERVICES.map((k) => [k, touches.includes(k) ? commande : 'ok']))
    const enCours = s.incidents[0]
    if (enCours) {
      Object.assign(enCours, { services: touches, message })
      if (titre) enCours.titre = titre
      enCours.nouvelles = [{ date: maj, texte: message }, ...(enCours.nouvelles ?? [])]
    } else {
      s.incidents = [
        {
          titre: titre ?? (commande === 'panne' ? 'Lucerna ne répond pas' : 'Service perturbé'),
          etat: 'en-cours',
          debut: maj,
          fin: null,
          services: touches,
          message,
          nouvelles: [{ date: maj, texte: message }],
        },
      ]
    }
  } else if (commande === 'nouvelle') {
    if (!message) throw new Error('message obligatoire')
    const enCours = s.incidents[0]
    if (!enCours) throw new Error('aucun incident en cours')
    enCours.message = message
    enCours.nouvelles = [{ date: maj, texte: message }, ...(enCours.nouvelles ?? [])]
    s.message = message
  } else if (commande === 'resolu') {
    const fin = message || 'Tout fonctionne de nouveau. Merci de votre patience.'
    const fermes = s.incidents.map((i) => ({
      ...i,
      etat: 'resolu',
      fin: maj,
      message: fin,
      nouvelles: [{ date: maj, texte: fin }, ...(i.nouvelles ?? [])],
    }))
    s.historique = [...fermes, ...s.historique].slice(0, MAX_HISTORIQUE)
    s.incidents = []
    s.etat = 'ok'
    s.message = 'Tout fonctionne normalement.'
    s.services = Object.fromEntries(SERVICES.map((k) => [k, 'ok']))
  } else {
    throw new Error(`commande inconnue : ${commande}`)
  }
  s.maj = maj
  const erreurs = valider(s)
  if (erreurs.length) throw new Error(erreurs.join(' ; '))
  return s
}

const echapper = (t) =>
  String(t)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const PARIS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'long',
  timeStyle: 'short',
})
const lisible = (iso) => PARIS.format(new Date(iso)).replace(':', ' h ')

function incidentHtml(i) {
  const services = i.services?.length ? ` · ${i.services.map((k) => NOMS[k]).join(', ')}` : ''
  const periode = i.fin
    ? `Du ${lisible(i.debut)} au ${lisible(i.fin)}`
    : `Depuis le ${lisible(i.debut)}`
  const nouvelles = (i.nouvelles ?? [])
    .slice(1, 6)
    .map(
      (n) =>
        `<li><time datetime="${echapper(n.date)}">${lisible(n.date)}</time> : ${echapper(n.texte)}</li>`,
    )
    .join('')
  return [
    '<article class="carte incident">',
    `<h3>${echapper(i.titre)}</h3>`,
    `<p class="meta">${periode}${echapper(services)}</p>`,
    `<p>${echapper(i.message ?? '')}</p>`,
    nouvelles ? `<ul class="meta">${nouvelles}</ul>` : '',
    '</article>',
  ].join('\n')
}

/** Page index.html (texte de l'état dans le HTML : lisible sans script, et par les robots). */
export function rendre(s, modele) {
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': 'https://statut.aumana-studio.com/#page',
    url: 'https://statut.aumana-studio.com/',
    name: 'État du service Lucerna',
    description:
      'État du service Lucerna en temps réel : fonctionnement, panne en cours et historique des incidents.',
    inLanguage: 'fr',
    dateModified: s.maj,
    about: {
      '@type': 'SoftwareApplication',
      name: 'Lucerna',
      url: 'https://lucerna.aumana-studio.com/',
      applicationCategory: 'ProductivityApplication',
    },
    publisher: { '@type': 'Organization', name: 'Aumana Studio', url: 'https://aumana-studio.com' },
  }
  const services = SERVICES.map(
    (k) =>
      `<li><span>${NOMS[k]}</span><span class="s-etat s-${s.services[k]}">${LIBELLES[s.services[k]]}</span></li>`,
  ).join('\n')
  const incidents = s.incidents.length
    ? s.incidents.map(incidentHtml).join('\n')
    : '<p>Aucun incident en cours.</p>'
  const historique = s.historique.length
    ? s.historique.slice(0, 10).map(incidentHtml).join('\n')
    : '<p>Aucun incident ces derniers temps.</p>'
  const valeurs = {
    ETAT: s.etat,
    ETAT_TITRE: echapper(TITRES[s.etat]),
    MESSAGE: echapper(s.message),
    OG_DESCRIPTION: echapper(`${TITRES[s.etat]}. ${s.message}`),
    MAJ_ISO: echapper(s.maj),
    MAJ_LISIBLE: lisible(s.maj),
    SERVICES: services,
    INCIDENTS: incidents,
    HISTORIQUE: historique,
    // « </ » échappé : le JSON ne peut pas fermer la balise <script>.
    JSONLD: JSON.stringify(jsonld).replaceAll('</', '<\\/'),
  }
  return modele.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
    if (!(k in valeurs)) throw new Error(`modèle : {{${k}}} inconnu`)
    return valeurs[k]
  })
}

function lire() {
  return JSON.parse(readFileSync(join(RACINE, 'statut.json'), 'utf8'))
}

export function construire(dest = join(RACINE, '_site')) {
  const s = lire()
  const erreurs = valider(s)
  if (erreurs.length) throw new Error(`statut.json invalide : ${erreurs.join(' ; ')}`)
  mkdirSync(dest, { recursive: true })
  writeFileSync(
    join(dest, 'index.html'),
    rendre(s, readFileSync(join(RACINE, 'modele.html'), 'utf8')),
  )
  writeFileSync(join(dest, 'statut.json'), `${JSON.stringify(s, null, 2)}\n`)
  for (const f of ['CNAME', 'robots.txt', 'favicon.svg', '404.html'])
    copyFileSync(join(RACINE, f), join(dest, f))
  writeFileSync(
    join(dest, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>https://statut.aumana-studio.com/</loc><lastmod>${s.maj}</lastmod></url>\n</urlset>\n`,
  )
  return dest
}

function options(args) {
  const o = { positionnels: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--appliquer') o.appliquer = true
    else if (a === '--sans-envoi') o.sansEnvoi = true
    else if (a === '--services')
      o.services = args[++i]
        ?.split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    else if (a === '--titre') o.titre = args[++i]
    else o.positionnels.push(a)
  }
  return o
}

function principal(argv) {
  const [commande, ...reste] = argv
  if (commande === 'verifier') {
    const e = valider(lire())
    if (e.length) {
      console.error(`✗ statut.json : ${e.join(' ; ')}`)
      process.exit(1)
    }
    console.log('✓ statut.json valide')
    return
  }
  if (commande === 'construire') {
    console.log(`✓ page générée dans ${construire()}`)
    return
  }
  if (!['panne', 'degrade', 'nouvelle', 'resolu'].includes(commande)) {
    console.error(
      'Usage : statut.mjs panne|degrade|nouvelle|resolu "message" [--services app,ia] [--titre "…"] [--appliquer] [--sans-envoi]',
    )
    console.error('        statut.mjs verifier | construire')
    process.exit(2)
  }
  const o = options(reste)
  const nouveau = appliquer(lire(), commande, {
    message: o.positionnels.join(' ').trim(),
    services: o.services,
    titre: o.titre,
  })
  const texte = `${JSON.stringify(nouveau, null, 2)}\n`
  if (!o.appliquer) {
    console.log(texte)
    console.log('Essai : rien n’est écrit. Relancez avec --appliquer pour publier.')
    return
  }
  writeFileSync(join(RACINE, 'statut.json'), texte)
  const git = (...a) => execFileSync('git', a, { cwd: RACINE, stdio: 'inherit' })
  git('add', 'statut.json')
  git('commit', '-m', `statut : ${commande} — ${nouveau.message.slice(0, 60)}`)
  if (o.sansEnvoi) {
    console.log('✓ statut.json écrit et commité (non poussé).')
    return
  }
  git('push')
  console.log('✓ Publié : https://statut.aumana-studio.com/ (en ligne d’ici 1 à 2 minutes).')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    principal(process.argv.slice(2))
  } catch (e) {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  }
}
