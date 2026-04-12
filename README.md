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

## MVP Link

<https://medresponse.onrender.com>

(GITHUB PAGE: <https://shubhamjatania17.github.io/SMRS/>)

## Roadmap Ideas

- Multi-campus and multi-building tenancy.
- Multiple concurrent active alerts.
- Real-time updates with WebSocket/SSE.
- Notification integrations (SMS, email, WhatsApp).
- GIS map integration with floor plans.
- SLA dashboards for response-time tracking.
- Incident export and compliance reporting.
