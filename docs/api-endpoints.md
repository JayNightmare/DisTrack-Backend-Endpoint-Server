# DisTrack API Guide for Front-End Clients

Use this document when wiring UI calls to the DisTrack back end (`src/server.js`). For each feature you'll find:

- How to authenticate the request
- Which parameters to send and where
- Response structure with the fields you can render
- Common error codes worth handling in the UI

All JSON samples omit fields that can be `null` unless they are important for the UI.

## Quick Auth Reference

Most data endpoints expect an `Authorization` header. You will typically send the personal link API key you display to the user after the extension linking flow.

```http
Authorization: Bearer <linkAPIKey>
```

A few OAuth routes rely on the session cookie that Passport sets; they are noted below. Requests without valid credentials receive `403` with `{ "message": "Forbidden: Invalid credentials" }`.

## Public Endpoints (no auth header required)

These can be called directly from the browser.

### Health & Shell

**GET `/`** – HTML landing page (served file `index.html`).

**GET `/health`** – Basic health probe.

```json
{
	"status": "OK",
	"timestamp": "2025-10-10T09:42:07.251Z",
	"uptime": 12345.67
}
```

### Leaderboards

**GET `/leaderboard`** – Top 10 by lifetime seconds.

```json
[
	{
		"username": "jay",
		"displayName": "JayNightmare",
		"totalCodingTime": 98765,
		"userId": "123" },
	...
]
```

**GET `/leaderboard/growth?period=week&limit=10`** – Users with the largest hour gains in the selected period.

```json
[
	{
		"userId": "123",
		"name": "JayNightmare",
		"avatarUrl": "https://...",
		"deltaHours": 14.5,
		"totalHours": 203.1
	}
]
```

**GET `/leaderboard/:timeframe`** – Adds trend data. `timeframe` is `day`, `week`, `month`, or `allTime`; optional `limit` (default 50).

```json
[
	{
		"userId": "123",
		"username": "jay",
		"displayName": "JayNightmare",
		"rank": 1,
		"totalTime": 7200,
		"rankDelta": 2,
		"previousRank": 3
	}
]
```

**GET `/user/:userId/history/:timeframe?limit=30`** – Time-series of a user’s rank for the chosen timeframe.

```json
[
	{ "timestamp": "2025-09-13T00:00:00.000Z", "rank": 4, "totalTime": 5400 }
]
```

### OAuth & Linking Helpers

- **GET `/auth/discord`** – redirects to Discord (start login).
- **GET `/auth/discord/callback`** – Discord returns here; the server redirects users back to `https://distrack.nexusgit.info/auth/distrack?token=...` with a JWT query param you can capture client-side.
- **POST `/auth/discord/callback`** – Legacy flow. Send `{ "code": "...", "redirect_uri": "https://..." }`. Returns `{ access_token, jwt_token, user, userProfile }`.
- **GET `/auth/discord/url?redirect_uri=https://...`** – Convenience endpoint: returns `{ authUrl, clientId, scopes }`.
- **GET `/auth/discord/user/:discordId`** – Returns `{ "exists": true, "user": {...} }` or `404`.
- **POST `/auth/discord/user`** – Creates a user using Discord data. Send `{ discordId, username, displayName?, avatarUrl?, email? }`. Returns `201` with `{ message, user }` or `409` if already exists.

### Extension Linking (front-end for desktop extension)

**POST `/extension/link`** – Exchanges a one-time code displayed on the website for an API key that the extension stores.

```json
// request
{ "linkCode": "ABC123", "deviceId": "optional-device-id" }

// success
{
	"success": true,
	"user": {
		"userId": "123",
		"username": "jay",
		"displayName": "JayNightmare",
		"extensionLinked": true,
		"totalCodingTime": 98765
	}
}
```

Errors: `404` if code is invalid/expired, `429` if IP or user fails rate-limit checks.

### Global Stats for Dashboards

Use these to populate homepage cards and graphs.

- **GET `/stats/global`** – `{ totals, weeklyActivity, extension }` with counts and hours (numbers in seconds converted to hours already).
- **GET `/stats/global/live`** – `{ totalHoursTracked, usersOnline, sessionsToday, topLanguageToday, avgSessionMinutes }`.
- **GET `/stats/global/trends?days=7`** – `{ hoursTracked: number[], activeUsers: number[], avgStreak: number[] }` aligned by day.
- **GET `/stats/global/heatmap/hourly?window=30`** – `{ matrix: number[7][24] }` representing seconds by (Sun-Sat, hour UTC).
- **GET `/stats/global/languages?period=30d&limit=8`** – `{ current: { lang: hours }, previous: { lang: hours } }`.

### User-Specific Stats (public if profile is public)

- **GET `/stats/:userId/filter`** – Provide `startDate`/`endDate` (ISO `YYYY-MM-DD`). Returns summary metrics, hourly patterns, daily series and weekly trend deltas.
- **GET `/stats/:userId/languages`** – Query optional `startDate`, `endDate`, `topN` (default 6). Response includes `{ topLanguages, timeseries: [{ date, languages: { lang: hours } }], totals }`.
- **GET `/stats/:userId/heatmap?year=2025`** – Yearly calendar data `{ year, totalHours, days: { 'YYYY-MM-DD': seconds } }`.

## Authenticated Endpoints (require `Authorization` header)

These power authenticated dashboards, profile editing, and admin tools. Send the header shown in the auth reference unless noted otherwise.

### Sessions & Users

**POST `/coding-session`** – Primary write endpoint used by the VS Code extension. Requires `{ userId, duration, sessionDate }` and accepts metadata such as `languages`, `sessionId`, `projectName`, `filePaths`, etc. Responds with `{ "message": "Session recorded successfully!" }` or `{ "message": "Session already recorded" }`.

Handle `400` when required fields are missing and `500` for generic failures.

**POST `/link`** – Creates or updates a user outside OAuth. Request `{ userId, username, displayName?, avatarUrl?, discordId? }`. Response includes the sanitized `user` record you can cache.

**GET `/user-profile/:userId`** – Returns the full Mongo document for that user. Useful for profile screens after auth. `404` if unknown.

**PUT `/user-profile/:userId`** – Update editable profile fields. Acceptable body keys: `username`, `displayName`, `avatarUrl`, `isPublic`, `timezone`, `bio`, `socials`. Response mirrors GET plus a confirmation message.

**GET `/streak/:userId`** – `{ currentStreak, longestStreak }` (numbers in days).

**GET `/languages/:userId`** – Raw stored totals `{ language: seconds }` filtered to values > 0. Convert to hours client-side if desired.

**GET `/users/search?q=term&limit=10`** – Autocomplete support. Returns `{ users: [{ userId, username, displayName, avatarUrl, totalCodingTime, currentStreak, longestStreak }] }`.

### Link Codes & Tokens

- **POST `/user/link-code/:userId`** – Generates a new link code for the signed-in user. Response `{ linkCode, length }`. UI should handle `429` when the button is spammed.
- **DELETE `/user/link-code/:userId`** – Clears the code; returns `{ success: true }`.
- **POST `/extension/key/auth/:deviceId/:linkCode`** – Legacy support that returns `{ success, user: { linkAPIKey }, botToken }`. Implementation has known issues (Mongo call not awaited). Prefer `/extension/link` for new flows.

### Auth Helpers (session/JWT)

- **GET `/auth/user`** – Requires the Passport session cookie. Returns `{ authenticated: true, user }` or `401`.
- **GET `/auth/logout`** – Ends the session, returning `{ message: "Logged out successfully" }`.
- **POST `/auth/verify-token`** – Requires both API key auth and a valid JWT parsed upstream (middleware must set `req.jwtUser`). Returns `{ valid: true, user }` or `404` if the token references a deleted user.

### Snapshots & Admin (backend-only UI)

The following endpoints are intended for staff tooling. Handle them with caution; they execute background jobs or maintenance tasks.

- **POST `/snapshot/:timeframe`** – Body `{ date? }`. Returns `{ success, message, snapshotCount? }`. `409` if the snapshot already exists.
- **POST `/snapshots/all`** – Triggers all timeframes at once. Response `{ message, results }` where `results` is keyed by timeframe.
- **POST `/admin/snapshot/trigger`** – Body `{ timeframe? }`. Forces scheduler jobs to run.
- **GET `/admin/snapshot/health`** – Health info for snapshot scheduler.
- **POST `/admin/jobs/:jobType`** – `jobType` in `daily | weekly | monthly`. Runs the matching job immediately. Returns `{ message, result }`.
- **GET `/admin/system/stats`** – `{ success, stats }` as returned by `MonitoringService`.
- **GET `/admin/system/health`** – Returns `200`/`500` based on snapshot health check.
- **GET `/admin/cron/status`** – Cron job configuration state. `{ success, cronJobs }`.
- **GET `/admin/sessions/recent?limit=20`** – Diagnostic list of latest sessions.
- **POST `/admin/cleanup`** – Manual data-retention cleanup. Returns `{ message, results }`.
- **GET `/admin/stats`** – Direct data retention stats payload.

UI surfaces that expose these operations should warn users, as they can be destructive or heavy.

## Common Error Codes to Surface

- `400 Bad Request` – Missing or invalid input fields.
- `401 Unauthorized` – Session endpoints when user is not logged in.
- `403 Forbidden` – API key missing/invalid; prompt user to re-link the extension.
- `404 Not Found` – User, code, or record not located.
- `409 Conflict` – Snapshot already created for given date/timeframe.
- `429 Too Many Requests` – Link code generation or link attempts exceeded rate limits.
- `500 Internal Server Error` – Unexpected server error; consider showing a retry option.

## Implementation References

- Server entrypoint: `src/server.js`
- Stats logic: `src/services/StatsService.js`
- Leaderboards: `src/services/LeaderboardService.js`
- Monitoring & retention: `src/services/MonitoringService.js`, `src/services/DataRetentionService.js`
