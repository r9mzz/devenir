# Déployer le relais de notifications (10-15 min, gratuit, sans CLI)

Ce serveur ne connaît jamais le contenu du journal — seulement l'heure à
laquelle te notifier. Tout se fait depuis le site web de Cloudflare, aucun
outil à installer.

## 1. Compte Cloudflare (2 min)

Va sur **dash.cloudflare.com/sign-up**, crée un compte gratuit (email +
mot de passe). Pas de carte bancaire nécessaire pour ce qu'on va faire.

## 2. Créer le Worker (3 min)

1. Dans le tableau de bord, menu de gauche → **Workers & Pages** → **Create**.
2. Choisis **Create Worker**.
3. Donne-lui le nom **`devenir-push`** (important : détermine l'adresse finale).
4. Clique **Deploy** (ça déploie un exemple vide, normal).
5. Clique **Edit code** (ou "Quick edit").
6. Supprime tout le code présent, colle à la place **tout le contenu du
   fichier `worker.js`** de ce dossier.
7. Clique **Deploy** (ou **Save and deploy**).

## 3. Créer le stockage KV (2 min)

1. Toujours dans **Workers & Pages**, menu de gauche → **KV**.
2. **Create a namespace**, nomme-le `devenir` → **Add**.
3. Reviens sur ton Worker `devenir-push` → onglet **Settings** →
   **Variables** (ou **Bindings**) → section **KV Namespace Bindings** →
   **Add binding**.
4. Variable name : **`DEVENIR_KV`** (exactement ce nom, en majuscules).
   KV namespace : choisis `devenir`. **Save**.

## 4. Ajouter les clés VAPID (3 min)

Toujours dans **Settings → Variables** du Worker :

- **Variables et secrets** → **Add** :
  - Type **Secret** (bouton "Encrypt"), nom **`VAPID_PRIVATE_JWK`**, valeur :
    la clé privée donnée dans la conversation avec Claude (jamais commitée
    dans ce dépôt public — colle-la depuis là, ou régénère ta propre paire
    avec `node worker/generate-vapid-keys.js` et adapte alors aussi la
    constante `VAPID_PUBLIC` dans `index.html`).
  - Type **Text** (variable normale, pas secrète), nom **`VAPID_PUBLIC`**, valeur :
    ```
    BKAXvi8hzyamgi3-v-8bl94qXG2-EfrgUSmhpvKuPNyxYGg49Ty1NrKTlG0ZWl-aGSD_o9CIsW3Xyna0t9ar_pg
    ```
    (doit être identique à la constante `VAPID_PUBLIC` du fichier `index.html`.)
- **Save and deploy**.

⚠️ Ce dépôt est **public** : la clé privée ne doit jamais y être commitée,
même dans un exemple. Colle-la uniquement dans le champ *Secret* de
Cloudflare (chiffré, jamais affiché en clair après enregistrement).

## 5. Activer le déclencheur périodique (2 min)

1. Onglet **Settings → Triggers** (ou **Cron Triggers** selon l'interface).
2. **Add Cron Trigger**.
3. Expression cron : **`* * * * *`** (toutes les minutes) → **Add**.

## 6. Noter l'adresse du Worker

En haut de la page du Worker, une adresse du type :

```
https://devenir-push.<ton-sous-domaine>.workers.dev
```

**Copie cette adresse.**

## 7. Dans l'appli Devenir

Réglages → section **Notifications à distance** → colle l'adresse dans
le champ, puis appuie sur **Activer les notifications à distance**.
Un bouton **Tester le push distant** permet de vérifier que la chaîne
complète fonctionne (le téléphone doit recevoir la notification même
appli fermée, écran éteint, quelques secondes après l'appui).

## Limite du plan gratuit

100 000 requêtes/jour, largement suffisant pour un usage personnel
(le cron tourne 1 440 fois/jour, chaque tick ne fait qu'une poignée de
lectures KV — très loin du plafond).
