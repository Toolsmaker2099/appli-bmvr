# appli-bmvr

PWA personnelle pour la BMVR de Marseille : liste des prêts avec échéances, et accès en un clic à Mediapart, Marsactu et Cafeyn.

- `public/` : l'appli (statique, publiée sur GitHub Pages).
- `wrangler.toml` + `worker/` : un petit relais Cloudflare Workers (gratuit) qui lit tes prêts sur le portail. Le portail n'autorise pas les appels directs depuis un autre site, d'où ce relais.

Les identifiants BMVR sont des **secrets Cloudflare** : ils ne sont ni dans le code, ni dans le navigateur.

## Mise en ligne

### 1. Le relais (Cloudflare)
```
npm install -g wrangler   # ou utiliser npx
npx wrangler login
npx wrangler secret put BMVR_USER     # numéro de carte / identifiant
npx wrangler secret put BMVR_PASS     # mot de passe
npx wrangler secret put APP_TOKEN     # un code long de ton choix (p. ex. 30 caractères aléatoires)
npx wrangler deploy
```
Note l'adresse affichée (`https://appli-bmvr-relais.<toi>.workers.dev`). Dans `wrangler.toml` (à la racine), `ALLOWED_ORIGIN` doit être l'adresse de ton site Pages (par défaut `https://toolsmaker2099.github.io`).

### 2. L'appli (GitHub Pages)
Dépôt → Settings → Pages → Source : **GitHub Actions**. Chaque envoi sur `main` publie `public/`. L'adresse sera `https://toolsmaker2099.github.io/appli-bmvr/`. (Un dépôt privé exige un abonnement GitHub payant pour Pages.)

### 3. Sur le téléphone
Ouvre l'adresse, saisis l'adresse du relais et le code, puis ajoute à l'écran d'accueil (iPhone : Partager → Sur l'écran d'accueil ; Android : Installer).

## Services
Les boutons ouvrent les liens de connexion automatique de la BMVR (CAS pour Mediapart et Cafeyn, lien « referer » pour Marsactu). Il faut être connecté à la BMVR dans le navigateur du téléphone.

## À valider au premier essai
La lecture des prêts reproduit les appels du portail sans avoir pu être testée avec un vrai compte. Si l'appli affiche une erreur ou des titres « Document », ouvre `<relais>/debug` avec l'en-tête `Authorization: Bearer <code>` : cette page renvoie la structure des réponses (sans les valeurs) pour ajuster `worker/src/portal.js`.

## Tests
`cd worker && npm test`
