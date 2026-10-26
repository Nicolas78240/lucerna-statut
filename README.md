# État du service Lucerna

Page publiée sur https://statut.aumana-studio.com/ par GitHub Pages, hors de l'infrastructure de
Lucerna : elle reste lisible quand Lucerna est en panne. L'app Lucerna lit `statut.json` quand son
serveur ne répond plus.

- `statut.json` : l'état (`ok`, `degrade`, `panne`), le message, la date (`maj`), l'état par
  service (`app`, `synchronisation`, `paiement`, `ia`), l'incident en cours et l'historique.
- `modele.html` : la page ; `node scripts/statut.mjs construire` la remplit dans `_site/`.
- `.github/workflows/pages.yml` : vérifie `statut.json` et publie à chaque push sur `main`.

Publier un incident (essai, puis `--appliquer` pour écrire, commiter et pousser) :

```bash
node scripts/statut.mjs panne "Lucerna ne répond plus depuis 9 h. Nous cherchons." --services app,synchronisation
node scripts/statut.mjs nouvelle "Le correctif est en cours." --appliquer
node scripts/statut.mjs resolu "Tout fonctionne de nouveau depuis 11 h." --appliquer
```

Depuis un téléphone : application GitHub › `statut.json` › modifier `etat`, `message`, `maj` ›
Commit. Aucune adresse e-mail ni donnée personnelle dans ce dépôt (le workflow refuse une adresse).
Procédure complète : `docs/statut/README.md` du dépôt Lucerna.
