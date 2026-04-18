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
3. [MVP link](#mvp-link)
4. [Roadmap Ideas](#roadmap-ideas)

## Overview

SMRS is designed as a practical prototype for emergency coordination in college campuses. It focuses on speed and clarity during critical incidents while keeping the backend easy to understand and extend.

The system currently uses file-based persistence (`data/state.json`) and supports one active alert at a time.

## Key Features

- Role-based login payload.
- One-click SOS alert creation with location.
- Active alert deduplication and conflict handling.
- Alert resolution flow with resolver identity.
- Alert history.
- Functional in Real-Time

## MVP Link

<https://medresponse.onrender.com>

(GITHUB PAGE: <https://shubhamjatania17.github.io/SMRS/>)

## Vercel Deployment

The project is now split into a static frontend plus serverless API routes, so it can be deployed on Vercel without changing the user flow.

### Required setup

1. Import the repository into Vercel.
2. Add a Redis/KV integration in Vercel so alert state persists across serverless invocations.
3. Deploy from the repository root.

### What is already handled

- `index.html` stays as the static app shell.
- `/api/*` endpoints are handled by Vercel functions.
- Realtime dashboard sync uses polling, which works in serverless environments.
- Local development still works with `node server.js` and the existing file-based state fallback.

### Notes

- If the KV/Redis integration is missing, local development will still work, but deployed state will not persist correctly.
- The app keeps using the shared `clientId` channel, so dashboards on the same client workspace stay in sync.

## Roadmap Ideas

- Multi-campus and multi-building tenancy.
- Multiple concurrent active alerts.
- Real-time updates with WebSocket/SSE.(Overwriting current real time features)
- Notification integrations (SMS, email, WhatsApp).
- SLA dashboards for response-time tracking.
- Incident export and compliance reporting.
- AI based guidance chatbot
- Integration in college mainframe as a locally hosted service.
