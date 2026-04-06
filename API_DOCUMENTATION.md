# FocusMe Backend — API Documentation

> **Base URL** : `http://localhost:4000`

---

## 1. Modèles de données

### Task
```json
{
  "_id": "ObjectId",
  "title": "String (requis)",
  "isDone": "Boolean (default: false)",
  "sessionId": "ObjectId | null",
  "dayId": "String | null",
  "dueDate": "Date | null",
  "completedAt": "Date | null",
  "postponedCount": "Number (default: 0)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### UserStats
```json
{
  "_id": "ObjectId",
  "userId": "ObjectId (ref User)",
  "date": "String — format yyyy-MM-dd",
  "focusMinutes": "Number (default: 0)",
  "sessionsCount": "Number (default: 0)",
  "tasksCompleted": "Number (default: 0)",
  "streak": "Number (default: 0)",
  "updatedAt": "Date"
}
```

### User (existant)
```json
{
  "_id": "ObjectId",
  "username": "String",
  "email": "String",
  "avatarType": "String — 'initials' | 'image'",
  "avatarInitials": "String",
  "avatarUrl": "String"
}
```

### Friendship (existant — PAS de champ status)
```json
{
  "_id": "ObjectId",
  "user1Id": "ObjectId",
  "user2Id": "ObjectId"
}
```
> L'existence d'un document Friendship = les deux users sont amis.

---

## 2. Endpoints — Tasks

### POST /api/tasks
Créer une nouvelle tâche.

**Body** :
```json
{
  "title": "Réviser le chapitre 3",
  "isDone": false,
  "dueDate": "2026-03-15",
  "sessionId": null,
  "dayId": "2026-03-08"
}
```

**Réponse** `201` :
```json
{
  "_id": "661f...",
  "title": "Réviser le chapitre 3",
  "isDone": false,
  "dueDate": "2026-03-15T00:00:00.000Z",
  "postponedCount": 0,
  "completedAt": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

### PATCH /api/tasks/:taskId/complete
Marquer une tâche comme terminée.

**Paramètres** : `taskId` — ObjectId de la tâche

**Réponse** `200` :
```json
{
  "_id": "661f...",
  "title": "Réviser le chapitre 3",
  "isDone": true,
  "completedAt": "2026-03-08T14:00:00.000Z",
  "postponedCount": 0
}
```

**Erreurs** :
| Code | Signification |
|------|--------------|
| 400 | `INVALID_TASK_ID` — taskId mal formé |
| 404 | `TASK_NOT_FOUND` — tâche introuvable |

---

### PATCH /api/tasks/:taskId/postpone
Reporter une tâche à une nouvelle date.

**Body** :
```json
{ "newDate": "2026-03-20" }
```

**Réponse** `200` :
```json
{
  "_id": "661f...",
  "isDone": false,
  "dueDate": "2026-03-20T00:00:00.000Z",
  "postponedCount": 1
}
```

**Erreurs** :
| Code | Signification |
|------|--------------|
| 400 | `MISSING_NEW_DATE` — champ newDate absent |
| 400 | `INVALID_DATE_FORMAT` — format de date invalide |
| 400 | `DATE_IN_THE_PAST` — date antérieure à aujourd'hui |
| 404 | `TASK_NOT_FOUND` — tâche introuvable |

---

## 3. Endpoints — Stats

### POST /api/stats/sync
Synchronise les statistiques du jour (cumul avec `$inc`).

**Body** :
```json
{
  "userId": "699bf6b5...",
  "date": "2026-03-08",
  "focusMinutes": 45,
  "sessionsCount": 2,
  "tasksCompleted": 3,
  "streak": 5
}
```
> Les champs `focusMinutes`, `sessionsCount`, `tasksCompleted` sont **cumulés** à chaque appel.  
> Le champ `streak` est **écrasé** avec la dernière valeur reçue.

**Réponse** `200` :
```json
{
  "_id": "...",
  "userId": "699bf6b5...",
  "date": "2026-03-08",
  "focusMinutes": 45,
  "sessionsCount": 2,
  "tasksCompleted": 3,
  "streak": 5,
  "updatedAt": "2026-03-08T14:00:00.000Z"
}
```

**Erreurs** :
| Code | Signification |
|------|--------------|
| 400 | `INVALID_USER_ID` — userId manquant ou mal formé |
| 400 | `INVALID_DATE_FORMAT` — format attendu `yyyy-MM-dd` |

---

### GET /api/stats/friends/:userId
Classement hebdo des amis (7 derniers jours).

**Réponse** `200` :
```json
[
  {
    "userId": "699bfa74...",
    "name": "Alice",
    "avatarUrl": "",
    "weeklyFocusMin": 320,
    "tasksThisWeek": 12,
    "streak": 7,
    "rank": 1
  },
  {
    "userId": "699c458b...",
    "name": "Bob",
    "avatarUrl": "",
    "weeklyFocusMin": 180,
    "tasksThisWeek": 5,
    "streak": 3,
    "rank": 2
  }
]
```

---

## 4. Endpoints — Feed

### GET /api/feed/:userId?limit=20
Fil d'activité des amis (7 derniers jours).

**Query params** :
- `limit` (optionnel, default `20`, max `100`)

**Filtres appliqués** : seuls les jours où `focusMinutes ≥ 30` OU `tasksCompleted ≥ 1` OU `streak ≥ 3` apparaissent.

**Réponse** `200` :
```json
[
  {
    "friendId": "699bfa74...",
    "friendName": "Alice",
    "avatarUrl": "",
    "actionType": "SESSION",
    "value": 45,
    "message": "Alice a étudié 45 min aujourd'hui 📚",
    "timestamp": "2026-03-08T14:00:00.000Z"
  },
  {
    "friendId": "699bfa74...",
    "friendName": "Alice",
    "avatarUrl": "",
    "actionType": "TASKS",
    "value": 3,
    "message": "Alice a complété 3 tâches ✅",
    "timestamp": "2026-03-08T14:00:00.000Z"
  },
  {
    "friendId": "699c458b...",
    "friendName": "Bob",
    "avatarUrl": "",
    "actionType": "STREAK",
    "value": 5,
    "message": "Bob est en streak de 5 jours 🔥",
    "timestamp": "2026-03-07T10:00:00.000Z"
  }
]
```

**Types d'action** :
| actionType | Seuil | Message |
|-----------|-------|---------|
| `SESSION` | focusMinutes ≥ 30 | `"{name} a étudié {min} min aujourd'hui 📚"` |
| `TASKS` | tasksCompleted ≥ 1 | `"{name} a complété {n} tâche(s) ✅"` |
| `STREAK` | streak ≥ 3 | `"{name} est en streak de {n} jours 🔥"` |

---

## 5. Codes d'erreur globaux

| Code | Cas |
|------|-----|
| 400 | Validation échouée (champ manquant, format invalide, date passée) |
| 404 | Ressource introuvable |
| 500 | Erreur serveur interne |
---

## 6. Challenges

### Challenge object
```json
{
  "id": "ObjectId",
  "title": "String",
  "description": "String",
  "creatorId": "ObjectId",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "visibility": "public | private | friends",
  "status": "upcoming | ongoing | finished",
  "participantsCount": 4,
  "maxParticipants": 20,
  "goal": {
    "type": "focus_minutes | sessions_count | tasks_completed",
    "targetValue": 300,
    "unit": "minutes | sessions | tasks"
  },
  "goalMinutes": 300,
  "joinCode": "ABCDEFGH",
  "myJoinRequestStatus": "pending | null",
  "myJoinRequestId": "ObjectId | null",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### Join a challenge
`POST /api/challenges/:id/join`

Possible body:
```json
{
  "joinCode": "ABCDEFGH"
}
```

Responses:
- Direct join:
```json
{ "ok": true }
```
- Friends challenge without code:
```json
{
  "ok": true,
  "status": "pending_approval",
  "requestId": "ObjectId"
}
```

### Incoming join requests
`GET /api/challenges/requests/incoming`

### Outgoing join requests
`GET /api/challenges/requests/outgoing`

### Requests for one challenge
`GET /api/challenges/:id/requests`

### Accept request
`POST /api/challenges/:id/requests/:requestId/accept`

### Reject request
`POST /api/challenges/:id/requests/:requestId/reject`

### Cancel my request
`DELETE /api/challenges/:id/my-request`

### Challenge overview
`GET /api/challenges/:id/overview`

For owners, overview includes:
```json
{
  "pendingJoinRequestsCount": 3
}
```
