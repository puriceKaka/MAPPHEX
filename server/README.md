## Jixels Backend (DB‑Ready)

This folder adds a small Node.js server so the project is **easy to switch to a real database later**.

### What it does now
- Serves the existing frontend files (HTML/CSS/JS) from the repo root.
- Provides a simple JSON **Key/Value API** that can store the same keys the frontend currently uses in `localStorage` (example: `jixels_erp_v1`, `jixels_hr_v1`).
- Persists data to `server/data/kv.json` (so it survives refresh/restart).

### Start the server
From the repo root:
```powershell
node server/server.js
```
Then open:
```text
http://localhost:3000/departments.html
```

### Enable backend sync (frontend)
In the browser console:
```js
localStorage.setItem("jixels_api_enabled_v1", "1");
location.reload();
```
When enabled, the frontend will:
- **Pull** missing state from the server on page load (bootstrap)
- **Push** any updates back to the server whenever it writes to `localStorage`

### API
- `GET /api/health`
- `GET /api/kv?key=<name>`
- `GET /api/kv?keys=<k1>,<k2>,...`
- `POST /api/kv` body: `{ "key": "...", "value": <any JSON> }`
- `POST /api/kv/batch` body: `{ "items": { "<key>": <value>, ... } }`

### Which database to use later
Recommended (easy + reliable):
- **PostgreSQL** (production, multi-branch, strong consistency)
- **SQLite** (single-file dev/testing)

Alternatives (fast to ship):
- **Firestore / Supabase** if you want managed hosting and realtime.

When you connect a real DB, keep the same API routes and replace the `kv.json` storage layer with DB reads/writes.

