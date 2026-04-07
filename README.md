# SMRS (Smart Medical Response System)

A smart campus emergency response demo that combines a high-impact, single-page frontend with a lightweight Node.js backend.

SMRS helps simulate the core workflow of a medical incident response system:

- User signs in with role and college details.
- User raises an SOS alert with location.
- Backend stores and broadcasts active alert state.
- Staff can resolve the active incident.
- Alert history is retained in local JSON storage.

## Table of Contents

1. [Overview](#overview)
2. [Key Features](#key-features)
3. [Architecture](#architecture)
4. [Project Structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Quick Start](#quick-start)
7. [Configuration](#configuration)
8. [API Reference](#api-reference)
9. [Data Model and Persistence](#data-model-and-persistence)
10. [User Flow](#user-flow)
11. [Troubleshooting](#troubleshooting)
12. [Security and Limitations](#security-and-limitations)
13. [Roadmap Ideas](#roadmap-ideas)
14. [Contributing](#contributing)

## Overview

SMRS is designed as a practical prototype for emergency coordination in college campuses. It focuses on speed and clarity during critical incidents while keeping the backend easy to understand and extend.

The system currently uses file-based persistence (`data/state.json`) and supports one active alert at a time.

## Key Features

- Role-based login payload (`student` by default).
- One-click SOS alert creation with location.
- Active alert deduplication and conflict handling.
- Alert resolution flow with resolver identity.
- Alert history (capped server-side to prevent unbounded growth).
- Health and bootstrap endpoints for app initialization.
- Fast static HTML serving from a cached backend response with ETag support.
- CORS enabled for demo/testing integrations.

## Architecture

### Frontend

- Single HTML application: `medresponse_v2.html`
- Includes:
  - Login screen
  - SOS trigger and overlay
  - Alert status page and timer
  - Guides/resources/staff UI sections
- Calls backend REST endpoints under `/api/*`.

### Backend

- Runtime: Node.js (`http` module, no framework dependency)
- Entry point: `server.js`
- Responsibilities:
  - Serve frontend HTML
  - Process API requests
  - Validate request payloads
  - Maintain active alert + history state
  - Persist state to disk in JSON

### Persistence

- File-based store: `data/state.json`
- Loaded at startup and updated on alert create/resolve operations.

## Project Structure

```text
SMRS/
├─ data/
│  └─ state.json             # Persistent backend state
├─ medresponse_v2.html       # Frontend single-page app
├─ server.js                 # Node.js HTTP server and API routes
├─ package.json              # Project metadata and scripts
└─ README.md                 # Project documentation
```

## Prerequisites

- Node.js 18 or newer (as declared in `package.json`)
- npm (bundled with Node.js)

Check your versions:

```bash
node -v
npm -v
```

## Quick Start

1. Install dependencies (none currently required, but this creates a standard workflow):

```bash
npm install
```

1. Start the backend server:

```bash
npm start
```

1. Open in browser:

```text
http://localhost:3000
```

## Configuration

### Environment Variables

- `PORT`: Optional server port.
  - Default: `3000`

Example (PowerShell):

```powershell
$env:PORT=4000
npm start
```

Example (bash/zsh):

```bash
PORT=4000 npm start
```

## API Reference

Base URL:

```text
http://localhost:3000
```

### 1) Health Check

- **Method:** `GET`
- **Path:** `/api/health`
- **Purpose:** Verify backend availability and active alert status.

Sample response:

```json
{
 "ok": true,
 "service": "medresponse-backend",
 "now": "2026-04-08T10:00:00.000Z",
 "activeAlert": false
}
```

### 2) Bootstrap Data

- **Method:** `GET`
- **Path:** `/api/bootstrap`
- **Purpose:** Returns static demo metadata and current alert/history state.

Returned fields include:

- `appName`
- `college`
- `locations`
- `contacts`
- `resources`
- `staff`
- `guides`
- `activeAlert`
- `alertHistory`

### 3) Current Active Alert

- **Method:** `GET`
- **Path:** `/api/alert/current`
- **Purpose:** Fetches currently active alert and its age in seconds.

Sample response:

```json
{
 "activeAlert": null,
 "ageSeconds": 0
}
```

### 4) Alert History

- **Method:** `GET`
- **Path:** `/api/alerts/history`
- **Purpose:** Returns historical list of alerts (latest first).

Sample response:

```json
{
 "items": []
}
```

### 5) Login

- **Method:** `POST`
- **Path:** `/api/login`
- **Purpose:** Validates login payload and returns normalized user profile.

Request body:

```json
{
 "name": "Shubham Kumar",
 "college": "MIT College of Engineering",
 "role": "student"
}
```

Validation:

- `name` is required.
- `college` is optional.
- `role` defaults to `student` if omitted.

Success response (`200`):

```json
{
 "ok": true,
 "user": {
  "name": "Shubham Kumar",
  "displayName": "Shubham",
  "college": "MIT College of Engineering",
  "role": "student"
 },
 "activeAlert": null
}
```

Error response (`400`):

```json
{
 "ok": false,
 "message": "Name is required"
}
```

### 6) Create Alert

- **Method:** `POST`
- **Path:** `/api/alerts`
- **Purpose:** Creates a new active alert.

Request body example:

```json
{
 "title": "Student Unresponsive",
 "location": "Block B · Room 203 · 2nd Floor",
 "userName": "Shubham Kumar",
 "role": "student",
 "college": "MIT College of Engineering",
 "severity": "critical",
 "notes": "Emergency response requested from campus UI."
}
```

Validation:

- `location` is required.

Success response (`201`):

```json
{
 "ok": true,
 "alert": {
  "id": "alert_1775600000000",
  "status": "active",
  "title": "Student Unresponsive",
  "location": "Block B · Room 203 · 2nd Floor",
  "severity": "critical",
  "createdAt": "2026-04-08T10:00:00.000Z",
  "updatedAt": "2026-04-08T10:00:00.000Z",
  "resolvedAt": null
 }
}
```

Conflict response (`409`) when an active alert already exists:

```json
{
 "ok": false,
 "message": "Another active alert already exists",
 "activeAlert": {
  "id": "alert_...",
  "status": "active"
 }
}
```

Possible conflict messages:

- `Alert already sent from this location`
- `Another active alert already exists`

### 7) Resolve Alert

- **Method:** `POST`
- **Path:** `/api/alerts/:alertId/resolve`
- **Purpose:** Marks the active alert as resolved.

Request body:

```json
{
 "resolvedBy": "Shubham"
}
```

Success response (`200`):

```json
{
 "ok": true,
 "alert": {
  "id": "alert_...",
  "status": "resolved",
  "resolvedBy": "Shubham",
  "resolvedAt": "2026-04-08T10:05:00.000Z"
 }
}
```

Error response (`404`):

```json
{
 "ok": false,
 "message": "No matching active alert found",
 "activeAlert": null
}
```

### Common Error Cases

- Invalid JSON request body -> `400` with `Invalid JSON body`
- Missing required fields -> `400`
- Not found route -> `404` plain text `Not found`
- Unexpected server errors -> `500` with JSON error payload

## API Usage with curl

### Health

```bash
curl http://localhost:3000/api/health
```

### Login

```bash
curl -X POST http://localhost:3000/api/login \
 -H "Content-Type: application/json" \
 -d '{"name":"Shubham Kumar","college":"MIT College of Engineering","role":"student"}'
```

### Create Alert

```bash
curl -X POST http://localhost:3000/api/alerts \
 -H "Content-Type: application/json" \
 -d '{"title":"Student Unresponsive","location":"Block B · Room 203 · 2nd Floor","userName":"Shubham Kumar","severity":"critical"}'
```

### Resolve Alert

```bash
curl -X POST http://localhost:3000/api/alerts/alert_1775600000000/resolve \
 -H "Content-Type: application/json" \
 -d '{"resolvedBy":"Shubham"}'
```

## Data Model and Persistence

The backend tracks state using this shape:

```json
{
 "activeAlert": null,
 "alertHistory": [],
 "lastUpdatedAt": null
}
```

Alert object includes:

- `id`
- `title`
- `location`
- `userName`
- `role`
- `college`
- `status` (`active` or `resolved`)
- `severity`
- `createdAt`
- `updatedAt`
- `resolvedAt`
- `notes`
- `resolvedBy` (after resolution)

Persistence notes:

- State file is auto-created if missing.
- History is capped to 100 items.
- Corrupted JSON fallback resets to default state.

## User Flow

1. Open app and enter `name`, optional `college`, and role.
2. App calls `/api/login` and renders user context.
3. User triggers SOS from current location.
4. App posts to `/api/alerts`.
5. Alert screen shows active status and timer.
6. Staff/user resolves via `/api/alerts/:id/resolve`.
7. Backend clears `activeAlert` and updates `alertHistory`.

## Troubleshooting

### Server does not start

- Confirm Node.js version is 18+.
- Ensure port is free.
- Try a different port using `PORT`.

### App opens but API fails

- Check backend is running.
- Open `http://localhost:3000/api/health` in browser.
- If opening HTML directly from disk, frontend uses `http://localhost:3000` as API base.

### JSON parse errors

- Ensure request body is valid JSON.
- Set `Content-Type: application/json` for POST requests.

### Alert keeps showing as active

- Resolve using the exact active alert ID route.
- Verify response from `/api/alert/current`.
- Check `data/state.json` if running local tests.

## Security and Limitations

This project is a demo prototype, not production hardened.

Current limitations:

- No authentication/authorization.
- CORS allows all origins.
- No rate limiting.
- Single active alert model.
- File-based storage (not suitable for distributed deployments).

Before production use, consider:

- JWT/session auth
- Role-based access control
- HTTPS + secure headers
- Input sanitization and audit logging
- Database-backed state (e.g., PostgreSQL, MongoDB)
- Monitoring and incident analytics

## Roadmap Ideas

- Multi-campus and multi-building tenancy.
- Multiple concurrent active alerts.
- Real-time updates with WebSocket/SSE.
- Notification integrations (SMS, email, WhatsApp).
- GIS map integration with floor plans.
- SLA dashboards for response-time tracking.
- Incident export and compliance reporting.

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Make focused commits.
4. Open a pull request with:

- Problem statement
- Change summary
- Test steps

## License

No license file is currently present in this repository. Add a `LICENSE` file if you want explicit open-source usage terms.
