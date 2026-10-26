// Tests du script de la page de statut (#493) : node --test scripts/
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { appliquer, rendre, valider } from './statut.mjs'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = () => JSON.parse(readFileSync(join(RACINE, 'statut.json'), 'utf8'))
const modele = readFileSync(join(RACINE, 'modele.html'), 'utf8')
const T = Date.parse('2026-10-25T08:00:00Z')

test('le statut.json livré est valide', () => {
  assert.deepEqual(valider(base()), [])
})

test('panne : état, services touchés et incident ouvert', () => {
  const s = appliquer(base(), 'panne', {
    message: 'Le serveur ne répond plus.',
    services: ['app', 'synchronisation'],
    now: T,
  })
  assert.equal(s.etat, 'panne')
  assert.deepEqual(s.services, { app: 'panne', synchronisation: 'panne', paiement: 'ok', ia: 'ok' })
  assert.equal(s.incidents.length, 1)
  assert.equal(s.incidents[0].etat, 'en-cours')
  assert.equal(s.maj, '2026-10-25T08:00:00Z')
})

test('nouvelle puis résolu : incident passé dans l’historique', () => {
  let s = appliquer(base(), 'degrade', {
    message: 'Synchronisation lente.',
    services: ['synchronisation'],
    now: T,
  })
  s = appliquer(s, 'nouvelle', { message: 'Correctif en cours.', now: T + 60_000 })
  assert.equal(s.incidents[0].nouvelles.length, 2)
  s = appliquer(s, 'resolu', { now: T + 120_000 })
  assert.equal(s.etat, 'ok')
  assert.equal(s.incidents.length, 0)
  assert.equal(s.historique[0].etat, 'resolu')
  assert.equal(s.historique[0].fin, '2026-10-25T08:02:00Z')
})

test('refus : message vide, service inconnu, adresse e-mail', () => {
  assert.throws(() => appliquer(base(), 'panne', { message: '' }), /message/)
  assert.throws(
    () => appliquer(base(), 'panne', { message: 'x', services: ['bidon'] }),
    /service inconnu/,
  )
  assert.throws(() => appliquer(base(), 'panne', { message: 'Écrivez à a@b.fr' }), /e-mail/)
  assert.throws(() => appliquer(base(), 'nouvelle', { message: 'x' }), /aucun incident/)
})

test('page : texte échappé, état lisible sans script, données structurées', () => {
  const s = appliquer(base(), 'panne', { message: '<script>alert(1)</script> & co', now: T })
  const html = rendre(s, modele)
  assert.ok(!html.includes('<script>alert'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co'))
  assert.ok(html.includes('Lucerna est en panne'))
  assert.ok(html.includes('class="carte etat etat-panne"'))
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html))
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])
  assert.equal(ld['@type'], 'WebPage')
  assert.equal(ld.dateModified, '2026-10-25T08:00:00Z')
  // Seul script : les données structurées (aucun suivi, aucun script tiers).
  assert.equal((html.match(/<script/g) ?? []).length, 1)
  assert.match(html, /<title>État du service Lucerna/)
  assert.ok(html.includes('href="https://lucerna.aumana-studio.com/app"'))
})
