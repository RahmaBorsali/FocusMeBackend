# FocusMe Backend API

Base URL:
`http://localhost:4000` en dev

Cette version documente le socle auth/profile prêt pour production:
- erreurs API cohérentes
- signup/login robustes
- Google Sign-In backend
- module profil complet
- garde-fous prod

## 1. Contrat d'erreur API

### Erreur simple
```json
{
  "message": "Invalid email or password"
}
```

### Erreur de validation
```json
{
  "message": "Validation failed",
  "errors": {
    "email": ["Email must be valid"],
    "password": [
      "Minimum 8 characters",
      "Au moins 1 majuscule"
    ]
  }
}
```

### Codes HTTP utilisés
- `200` succès lecture/mise à jour/suppression
- `201` ressource créée
- `400` validation ou payload invalide
- `401` authentification invalide
- `403` action refusée
- `404` ressource absente
- `409` conflit de données métier
- `429` trop de tentatives
- `500` erreur interne

## 2. DTO principaux

### `UserDto`
```json
{
  "id": "67f90e4c0c2a0d0d9b5d5f01",
  "username": "rahma",
  "email": "rahma@example.com",
  "avatarType": "initials",
  "avatarInitials": "RA",
  "avatarUrl": "",
  "displayName": "Rahma",
  "studyGoal": "3 hours of focus per day",
  "createdAt": "2026-04-15T13:05:10.114Z"
}
```

### `LoginRequest`
```json
{
  "email": "rahma@example.com",
  "password": "StrongPass1!"
}
```

### `SignupRequest`
```json
{
  "username": "rahma",
  "email": "rahma@example.com",
  "password": "StrongPass1!",
  "confirmPassword": "StrongPass1!"
}
```

### `GoogleLoginRequest`
```json
{
  "idToken": "google-id-token"
}
```

### `LoginResponse`
```json
{
  "accessToken": "jwt-token",
  "user": {
    "id": "67f90e4c0c2a0d0d9b5d5f01",
    "username": "rahma",
    "email": "rahma@example.com",
    "avatarType": "initials",
    "avatarInitials": "RA",
    "avatarUrl": "",
    "displayName": "Rahma",
    "studyGoal": "",
    "createdAt": "2026-04-15T13:05:10.114Z"
  }
}
```

### `SignupResponse`
```json
{
  "message": "Account created. Please verify your email before logging in.",
  "user": {
    "id": "67f90e4c0c2a0d0d9b5d5f01",
    "username": "rahma",
    "email": "rahma@example.com",
    "avatarType": "initials",
    "avatarInitials": "RA",
    "avatarUrl": "",
    "displayName": "rahma",
    "studyGoal": "",
    "createdAt": "2026-04-15T13:05:10.114Z"
  }
}
```

## 3. Endpoints Auth

### `POST /auth/signup`
Crée un compte email/password.

Body:
```json
{
  "username": "rahma",
  "email": "rahma@example.com",
  "password": "StrongPass1!",
  "confirmPassword": "StrongPass1!"
}
```

Réponses:
- `201`
```json
{
  "message": "Account created. Please verify your email before logging in.",
  "user": {
    "id": "67f90e4c0c2a0d0d9b5d5f01",
    "username": "rahma",
    "email": "rahma@example.com",
    "avatarType": "initials",
    "avatarInitials": "RA",
    "avatarUrl": "",
    "displayName": "rahma",
    "studyGoal": "",
    "createdAt": "2026-04-15T13:05:10.114Z"
  }
}
```
- `409`
```json
{ "message": "Email already in use" }
```
- `409`
```json
{ "message": "Username already in use" }
```
- `400`
```json
{
  "message": "Validation failed",
  "errors": {
    "password": [
      "Minimum 8 characters",
      "Au moins 1 majuscule",
      "Au moins 1 caractere special"
    ]
  }
}
```

### `POST /auth/login`
Connexion email/password.

Body:
```json
{
  "email": "rahma@example.com",
  "password": "StrongPass1!"
}
```

Réponses:
- `200` retourne `LoginResponse`
- `401`
```json
{ "message": "Invalid email or password" }
```
- `403`
```json
{ "message": "Email not verified" }
```
- `400`
```json
{
  "message": "Validation failed",
  "errors": {
    "email": ["Email must be valid"]
  }
}
```

### `POST /auth/google`
Connexion ou création via Google Sign-In.

Body:
```json
{
  "idToken": "google-id-token"
}
```

Réponses:
- `200` retourne `LoginResponse`
- `401`
```json
{ "message": "Invalid Google token" }
```
- `500`
```json
{ "message": "Google sign-in is not configured" }
```

### `POST /auth/forgot-password`
Body:
```json
{
  "email": "rahma@example.com"
}
```

Réponse:
- `200`
```json
{
  "message": "If this email exists, a password reset link has been sent."
}
```

### `POST /auth/reset-password`
Body:
```json
{
  "token": "reset-token",
  "password": "NewStrongPass1!",
  "confirmPassword": "NewStrongPass1!"
}
```

Réponses:
- `200`
```json
{
  "message": "Password updated successfully"
}
```
- `400`
```json
{ "message": "Invalid or expired token" }
```

## 4. Endpoints Profile

Tous les endpoints ci-dessous nécessitent:
`Authorization: Bearer <accessToken>`

### `GET /profile/me`
Retourne le profil courant.

Réponse `200`
```json
{
  "id": "67f90e4c0c2a0d0d9b5d5f01",
  "username": "rahma",
  "email": "rahma@example.com",
  "avatarType": "initials",
  "avatarInitials": "RA",
  "avatarUrl": "",
  "displayName": "Rahma",
  "studyGoal": "Pass 2 exams this month",
  "createdAt": "2026-04-15T13:05:10.114Z"
}
```

### `PATCH /profile/me`
Permet de mettre à jour `username`, `displayName`, `studyGoal` et des métadonnées avatar.

Body:
```json
{
  "displayName": "Rahma B.",
  "studyGoal": "4 focused sessions every day"
}
```

Réponses:
- `200`
```json
{
  "message": "Profile updated successfully",
  "user": {
    "id": "67f90e4c0c2a0d0d9b5d5f01",
    "username": "rahma",
    "email": "rahma@example.com",
    "avatarType": "initials",
    "avatarInitials": "RB",
    "avatarUrl": "",
    "displayName": "Rahma B.",
    "studyGoal": "4 focused sessions every day",
    "createdAt": "2026-04-15T13:05:10.114Z"
  }
}
```
- `409`
```json
{ "message": "Username already in use" }
```
- `400`
```json
{
  "message": "Validation failed",
  "errors": {
    "studyGoal": ["Study goal must be at most 280 characters"]
  }
}
```

### `POST /profile/avatar`
Met à jour l’avatar sans upload binaire.

Body avatar image:
```json
{
  "avatarType": "image",
  "avatarUrl": "https://cdn.example.com/avatar.png"
}
```

Body avatar initials:
```json
{
  "avatarType": "initials",
  "avatarInitials": "RB"
}
```

Réponse `200`
```json
{
  "message": "Avatar updated successfully",
  "user": {
    "id": "67f90e4c0c2a0d0d9b5d5f01",
    "username": "rahma",
    "email": "rahma@example.com",
    "avatarType": "image",
    "avatarInitials": "RB",
    "avatarUrl": "https://cdn.example.com/avatar.png",
    "displayName": "Rahma B.",
    "studyGoal": "4 focused sessions every day",
    "createdAt": "2026-04-15T13:05:10.114Z"
  }
}
```

### `DELETE /profile/me`
Supprime définitivement le compte et nettoie les données liées.

Réponse `200`
```json
{
  "message": "Account deleted successfully"
}
```

Après suppression:
- le user est supprimé
- les tokens JWT existants deviennent inutilisables
- les demandes d’amis, amitiés, tokens email/reset, tâches, sessions, stats, conversations directes et données challenge liées sont nettoyés

## 5. Logique métier

### Signup/Login
- email normalisé en lowercase
- username comparé en version normalisée insensible à la casse
- mot de passe hashé avec `bcrypt` coût `12`
- validation stricte via `zod`
- mot de passe contrôlé par politique locale et vérification de fuite connue

### Google Sign-In
- le backend vérifie le `idToken` via Google
- le token doit contenir `sub`, `email` et `email_verified = true`
- si un user existe déjà avec ce `googleSub`, on le connecte
- sinon si un user existe déjà avec le même email:
  - on lie le compte existant à Google
  - on active `authProviders.google = true`
  - on stocke `googleSub`
  - on conserve le même user pour éviter tout doublon email
- sinon un nouveau compte est créé automatiquement
- si le username dérivé du compte Google existe déjà, un username unique est généré

### Profile
- `displayName` est séparé de `username`
- `studyGoal` est stocké côté user
- `createdAt` vient du timestamp Mongo
- si `username` ou `displayName` change, les initiales avatar sont recalculées si nécessaire

### Delete account
- suppression définitive du document user
- suppression des données directement reliées
- invalidation implicite des JWT car le middleware recharge le user à chaque requête
- invalidation active aussi après reset password via `tokenVersion`

## 6. Cas limites couverts

- email inexistant au login: `401 Invalid email or password`
- mauvais mot de passe: `401 Invalid email or password`
- compte Google-only qui tente login email/password: `401 Invalid email or password`
- email/password existant puis Google avec même email: liaison automatique, pas de doublon
- token Google invalide, expiré ou audience incorrecte: `401 Invalid Google token`
- email non vérifié au login classique: `403 Email not verified`
- username déjà pris au signup ou patch profile: `409 Username already in use`
- email déjà pris au signup: `409 Email already in use`
- payload vide ou champ invalide: `400 Validation failed`
- token JWT ancien après reset password: session expirée
- token JWT après suppression de compte: authentification refusée
- trop de tentatives auth: `429`

## 7. Préparation production

### Validation et sécurité
- validation `zod` pour auth et profile
- `bcrypt` pour le hash mot de passe
- JWT signé avec `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_ISSUER`, `JWT_AUDIENCE`
- `tokenVersion` pour invalider les anciens JWT après reset password
- `helmet` activé
- `express-rate-limit` sur `/auth`, avec seuils spécifiques login/signup/google

### CORS et HTTPS
- `CORS_ORIGIN` configurable par environnement
- `CORS_CREDENTIALS` configurable
- `TRUST_PROXY` pour reverse proxy prod
- `ENFORCE_HTTPS=true` pour refuser le trafic non HTTPS
- support serveur HTTPS natif si `HTTPS_ENABLED=true` avec `HTTPS_KEY_PATH` et `HTTPS_CERT_PATH`

### Logs
- les erreurs serveur sont loggées sans exposer:
  - `password`
  - `confirmPassword`
  - `token`
  - `accessToken`
  - `refreshToken`
  - `idToken`

## 8. Variables d’environnement

Voir [` .env.example`](./.env.example)

Variables clés:
- `NODE_ENV`
- `PORT`
- `MONGO_URI`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_ANDROID_CLIENT_ID`
- `GOOGLE_WEB_CLIENT_ID`
- `CORS_ORIGIN`
- `CORS_CREDENTIALS`
- `TRUST_PROXY`
- `ENFORCE_HTTPS`
- `HTTPS_ENABLED`
- `HTTPS_KEY_PATH`
- `HTTPS_CERT_PATH`
- `AUTH_RATE_LIMIT_MAX`
- `LOGIN_RATE_LIMIT_MAX`
- `SIGNUP_RATE_LIMIT_MAX`

## 9. Plan de migration si des users existent déjà

### Étape 1
Déployer le nouveau schéma `User` avec:
- `usernameNormalized`
- `displayName`
- `studyGoal`
- `tokenVersion`
- `authProviders`
- `googleSub`
- `deletedAt`

### Étape 2
Backfill sur les users existants:
- `usernameNormalized = username.toLowerCase().trim()`
- `displayName = username` si vide
- `studyGoal = ""` si absent
- `tokenVersion = 0`
- `authProviders.emailPassword = true` si `passwordHash` existe
- `authProviders.google = false` si `googleSub` absent
- `deletedAt = null`

### Étape 3
Avant de mettre l’index unique sur `usernameNormalized`, détecter et corriger les collisions de username insensibles à la casse.

### Étape 4
Configurer les client IDs Google prod/dev et tester le flow mobile avec un vrai `idToken` Android.

### Étape 5
Communiquer au frontend Android que `UserDto` inclut désormais:
- `displayName`
- `studyGoal`
- `createdAt`

## 10. Nouveaux endpoints ajoutés

- `POST /auth/google`
- `GET /profile/me`
- `PATCH /profile/me`
- `POST /profile/avatar`
- `DELETE /profile/me`
