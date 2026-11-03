# appli-bmvr

Application web installable (PWA), **non officielle**, pour la BMVR de Marseille : liste détaillée des prêts avec échéances, et accès en un toucher à Mediapart et Cafeyn. Les prêts ne se chargent que dans leur onglet. (Marsactu est mis de côté pour plus tard.)

- `public/` : l'appli (statique, publiée sur GitHub Pages).
- `wrangler.toml` + `worker/` : un petit relais Cloudflare Workers (gratuit) qui lit tes prêts sur le portail. Le portail n'autorise pas les appels directs depuis un autre site, d'où ce relais.

Les identifiants BMVR restent sur l'appareil de chaque personne (stockage local du navigateur) et ne transitent par le relais que pour lire les prêts, sans y être conservés.

## Mise en ligne

### 1. Le relais (Cloudflare)
Cloudflare → Workers & Pages → Import a repository → `appli-bmvr` (Root directory `/`, commande `npx wrangler deploy`). Aucun secret à configurer : chaque personne saisit ses propres identifiants BMVR dans l'appli, le relais les utilise le temps de la requête puis les oublie.
L'adresse du relais est dans `public/app.js` (`RELAY`) ; `ALLOWED_ORIGIN` dans `wrangler.toml` doit être l'adresse de ton site Pages.

### 2. L'appli (GitHub Pages)
Dépôt → Settings → Pages → Source : **GitHub Actions**. Chaque envoi sur `main` publie `public/`. L'adresse sera `https://toolsmaker2099.github.io/appli-bmvr/`. (Un dépôt privé exige un abonnement GitHub payant pour Pages.)

### 3. Sur le téléphone
Ouvre l'adresse, connecte-toi avec ton compte BMVR, puis ajoute à l'écran d'accueil (iPhone : Partager → Sur l'écran d'accueil ; Android : Installer).

## Services
Les boutons ouvrent les liens de connexion automatique de la BMVR (CAS pour Mediapart et Cafeyn, lien « referer » pour Marsactu). Il faut être connecté à la BMVR dans le navigateur du téléphone.

## À valider au premier essai
La lecture des prêts reproduit les appels du portail sans avoir pu être testée avec un vrai compte. Si l'appli affiche une erreur ou des titres « Document », envoie au relais une requête `POST /loans` avec `"debug": true` : la réponse contient la structure des réponses (sans les valeurs) pour ajuster `worker/src/portal.js`.

## Tests
`cd worker && npm test`

## Mises à jour
L'appli se met à jour seule : à chaque ouverture (ou retour sur l'appli), elle cherche une nouvelle version et se recharge si elle en trouve une. Le numéro de version du cache est posé automatiquement à chaque publication (numéro du commit, via `__VERSION__` dans `public/sw.js` et `public/index.html`) : rien à incrémenter à la main.

### 3. Notifications téléphone (optionnel)
Inactives par défaut. Pour les activer :
1. Cloudflare → Storage & Databases → KV → *Create* (nom libre, ex. `bmvr-notif`), copiez son **identifiant**.
2. Dans `wrangler.toml`, décommentez le bloc `[[kv_namespaces]]` et collez l'identifiant (binding `NOTIF`).
3. Ouvrez `https://toolsmaker2099.github.io/appli-bmvr/cles.html`, générez les clés (elles ne quittent pas votre appareil), puis ajoutez dans le relais (Settings → Variables and Secrets, type *Secret*) : `VAPID_PUBLIC`, `VAPID_PRIVATE`, `NOTIF_KEY`.
4. Après le prochain déploiement, l'appli (onglet Compte) propose « Notifications ». Chaque personne active l'option elle-même ; ses identifiants BMVR sont alors gardés **chiffrés** (AES-GCM) et le relais consulte son compte toutes les 3 heures environ, jamais entre 22 h et 7 h (`NOTIF_EVERY_MIN` pour ajuster, en minutes ; 3 abonnés traités par passage, `NOTIF_BATCH`). « Désactiver » efface tout.
