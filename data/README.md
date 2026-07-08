# SCCC IT Tech Support Portal

The official IT support web portal for **Seward County Community College**. Built with React, TypeScript, and Express, it provides students, faculty, and staff with system status monitoring, IT announcements, a knowledge base, downloadable resources, and a full support ticket submission system integrated with Zendesk.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Local Development Setup](#local-development-setup)
3. [Environment Variables](#environment-variables)
4. [Verifying a Deployment](#verifying-a-deployment)
5. [Admin Panel — Content Management](#admin-panel--content-management)
6. [Admin Password Protection](#admin-password-protection)
7. [Data Storage Strategy](#data-storage-strategy)
8. [Zendesk Integration](#zendesk-integration)
9. [Automated Health Checks](#automated-health-checks)
10. [Deployment — Replit (Cloud)](#deployment--replit-cloud)
11. [Deployment — IIS (On-Premises)](#deployment--iis-on-premises)
12. [Syncing Production Data to Development](#syncing-production-data-to-development)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| Routing | Wouter |
| Data Fetching | TanStack React Query |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| ORM | Drizzle ORM + Drizzle Zod |
| Build Tool | Vite (frontend), esbuild (backend) |
| Ticket Integration | Zendesk REST API v2 |

---

## Local Development Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ (or a hosted PostgreSQL connection string)
- npm

### Steps

```bash
# 1. Clone the repository
git clone <repo-url>
cd sccc-it-portal

# 2. Install dependencies
npm install

# 3. Create a .env file (see Environment Variables below)
cp .env.example .env   # or create manually

# 4. Push the database schema
npm run db:push

# 5. Start the development server
npm run dev
```

The app will be available at `http://localhost:5000`.

On first startup, the server **automatically seeds** all database tables with default SCCC content if they are empty. No manual data import is needed for a fresh install.

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server (backend + frontend via Vite) |
| `npm run build` | Build for production (`dist/index.cjs` + `dist/public/`) |
| `npm run start` | Run the production build |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Push Drizzle schema changes to the database |

---

## Environment Variables

Create a `.env` file in the project root with the following variables:

A template is provided at `.env.example` — copy it to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string — `postgresql://user:pass@host:5432/dbname` |
| `ZENDESK_API_TOKEN_SCCC` | Yes* | 40-char Zendesk API token (*required for ticket forwarding) |
| `ZENDESK_ADMIN_EMAIL` | No | Zendesk account email. Defaults to `mark.bojeun@sccc.edu` |
| `ZENDESK_SUBDOMAIN` | No | Zendesk subdomain. Defaults to `sccc` |
| `ADMIN_PASSWORD` | Recommended | Password for the `/admin` panel. If unset, panel is open to anyone |
| `NODE_ENV` | No | `development` or `production`. Defaults to `development` |
| `PORT` | No | HTTP port to listen on. Defaults to `5000` |

> **Important:** Never commit `.env` to source control. It is already in `.gitignore`.

On every startup the server prints a configuration summary to the console so you can immediately see what is and is not configured:

```
========================================
  SCCC IT Portal — Configuration Check
========================================
  Environment : production
  Port        : 5000
  Database    : ✓ Connected
  Zendesk     : ✓ Configured
  Admin Auth  : ✓ Password protected
========================================
```

If the database connection fails, the server exits immediately with a clear error message rather than starting silently broken.

---

## Verifying a Deployment

After deploying, hit the health endpoint to confirm everything is wired up correctly:

```
GET /api/health
```

Example response (HTTP 200 = healthy, HTTP 503 = degraded):

```json
{
  "status": "ok",
  "version": "1.0.0",
  "environment": "production",
  "database": "connected",
  "zendesk": "configured",
  "adminAuth": "enabled",
  "uptime": "42s",
  "timestamp": "2026-04-15T16:00:00.000Z"
}
```

This is safe to hit from a load balancer or monitoring tool. It performs a live database query on every call.

---

## Data Storage Strategy

All content is stored in a **PostgreSQL** database managed via **Drizzle ORM**. The schema lives in `shared/schema.ts` and is shared between the frontend (for types) and backend (for queries).

### Database Tables

#### `system_statuses`
Tracks the real-time status of SCCC IT services displayed on the System Status page.

| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| name | text | Service name (e.g., "Canvas LMS") |
| status | text | `operational`, `degraded`, or `outage` |
| description | text | Short status message |
| updated_at | timestamp | Last update time |

Canvas LMS and MySaints Portal statuses are **updated automatically** every 5 minutes by the built-in health checker. Campus Wi-Fi and VPN / Remote Access are managed manually via the admin panel.

---

#### `faqs`
Frequently asked questions shown on the FAQ page.

| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| question | text | The question |
| answer | text | The answer |
| category | text | `accounts`, `network`, `software`, `general`, `support` |
| sort_order | serial | Display order |

---

#### `announcements`
Banner announcements shown at the top of the homepage.

| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| title | text | Announcement headline |
| message | text | Full announcement text |
| type | text | `info`, `warning`, or `error` |
| active | boolean | Controls visibility |
| created_at | timestamp | Creation timestamp |

---

#### `download_links`
Resources shown on the IT Support / Downloads page.

| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| category | text | Section heading (e.g., "Guides & Documentation") |
| title | text | Resource title |
| description | text | Short description |
| platform | text | Platform label (e.g., "Windows / Mac", "PDF") |
| action_label | text | Button text |
| href | text | Link URL (internal `/guides/...` or external) |
| icon | text | Lucide icon name |
| featured | boolean | Show "Recommended" badge |
| sort_order | serial | Display order |

---

#### `services`
IT service cards displayed on the homepage and Services page.

| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| title | text | Service name |
| description | text | Short description |
| action_label | text | Button text |
| href | text | Link URL |
| icon | text | Lucide icon name |
| show_on_home | boolean | Show on homepage |
| sort_order | integer | Display order |

---

#### `upgrades`
Upcoming IT infrastructure improvements shown on the homepage.

| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| title | text | Upgrade title |
| description | text | Description |
| icon | text | Lucide icon name |
| sort_order | integer | Display order |

---

#### `tickets`
Support tickets submitted through the `/support` form. Saved locally and forwarded to Zendesk.

| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment |
| subject | text | Ticket subject |
| description | text | Full description |
| department | text | `students` or `staff` |
| user_type | text | `student`, `faculty`, `staff`, `visitor`, `other` |
| category | text | Issue category (Zendesk tag value) |
| contact_method | text | `email`, `phone`, `walk_in`, `web` |
| priority | text | `low`, `normal`, `high`, `urgent` |
| severity | text | `low`, `medium`, `high`, `critical` |
| event_date | text | ISO date (event setup tickets only) |
| requester_name | text | Submitter's name |
| requester_email | text | Submitter's email |
| requester_phone | text | Submitter's phone (optional) |
| status | text | `open`, `pending`, `solved`, `closed` |
| created_at | timestamp | Submission timestamp |

---

#### `site_settings`
Key/value store for all configurable site content (contact info, hours, CIO message, hero card text).

| Key | Description |
|---|---|
| `contact_phone` | IT Help Desk phone number |
| `contact_email` | IT Help Desk email |
| `contact_location` | Office location |
| `hours_mf` | Monday–Thursday hours |
| `hours_friday` | Friday hours |
| `hours_weekend` | Weekend hours |
| `cio_name` | CIO full name |
| `cio_title` | CIO title |
| `cio_email` | CIO email |
| `cio_phone_cell` | CIO cell phone |
| `cio_phone_office` | CIO office phone |
| `cio_message` | Full CIO welcome letter |
| `walkin_title` | Walk-in card title |
| `walkin_detail` | Walk-in location detail |
| `walkin_note` | Walk-in note text |
| `techtuesday_title` | Tech Tuesday card title |
| `techtuesday_time` | Tech Tuesday time |
| `techtuesday_location` | Tech Tuesday location |

---

## Admin Panel — Content Management

The admin panel is available at `/admin`.

It has **8 tabs**, each managing a different section of the site:

| Tab | What You Can Do |
|---|---|
| **System Status** | Add, edit, or delete service statuses. Set status to operational / degraded / outage. |
| **Announcements** | Create, edit, activate/deactivate, or delete homepage banners. Set type to info, warning, or error. |
| **FAQs** | Add, edit, reorder, or delete FAQ entries. Assign categories. |
| **Downloads** | Add, edit, or delete download/guide links. Set category, icon, platform, and featured flag. |
| **Services** | Manage IT service cards. Toggle homepage visibility. |
| **Site Settings** | Edit contact info, office hours, CIO name/message, and hero card text. |
| **Upgrades** | Manage the upcoming infrastructure improvements section on the homepage. |
| **Tickets** | View all submitted support tickets. Filter by status, update status, or delete tickets. |

### Adding a New Guide or Document

1. Create a new page in `client/src/pages/` with the guide content.
2. Register the route in `client/src/App.tsx`.
3. Go to **Admin → Downloads** and add a new entry with the `href` set to the internal path (e.g., `/guides/my-new-guide`).

---

## Admin Password Protection

By default the `/admin` panel is open to anyone. To password-protect it, set `ADMIN_PASSWORD` in your environment.

**How it works:**
- When `ADMIN_PASSWORD` is set, visiting `/admin` checks for a valid session cookie.
- If no valid session is found, the user is redirected to `/admin/login`.
- After entering the correct password, an 8-hour session cookie is issued (HTTP-only, `SameSite=Strict`).
- A **Sign Out** button appears in the admin panel header.
- All admin write operations (POST / PUT / DELETE to `/api/*`) return `401 Unauthorized` if the session is missing or expired.
- Read operations (`GET /api/*`) are always public — the portal pages stay fully accessible.

**Setting the password on Replit:**
1. Go to the **Secrets** tab (lock icon) in the Replit sidebar.
2. Add a secret named `ADMIN_PASSWORD` with your chosen password.
3. Restart the server.

**Setting the password on IIS:**
Add an environment variable through the IIS application settings or the server environment:
```
ADMIN_PASSWORD=YourChosenPassword
```

> If you forget the password, simply change the `ADMIN_PASSWORD` variable — all existing sessions will immediately become invalid because the session HMAC is keyed to the current password.

---

## Zendesk Integration

When a ticket is submitted via `/support`, it is:

1. **Saved to the local PostgreSQL database** first (so no ticket is ever lost).
2. **Forwarded to Zendesk** at `https://sccc.zendesk.com` via the REST API v2.

Zendesk ticket configuration applied automatically:
- **Group:** Onsite_IT (ID: 34475512485901)
- **Type:** Question
- **Priority:** Mapped from form selection
- **Custom Fields:** Category, Department, User Type, Contact Method, Severity, Event Date

### Requirements for Zendesk to work:
- Token access must be **enabled** in Zendesk: Admin → Apps & Integrations → APIs → Zendesk API → Token access: ON
- `ZENDESK_API_TOKEN_SCCC` environment variable must be set to a valid 40-character API token
- The token must belong to `mark.bojeun@sccc.edu` (or update the fallback email in `server/routes.ts`)

---

## Automated Health Checks

The server runs a background health check every **5 minutes** on startup. It pings:

| Service | URL Checked |
|---|---|
| Canvas LMS | `https://sccc.instructure.com` |
| MySaints Portal | `https://experience.elluciancloud.com/scccats/` |

If a service returns an HTTP 5xx or times out, its status in the database is automatically set to `degraded`. When it recovers, it returns to `operational`.

**Campus Wi-Fi** and **VPN / Remote Access** are not auto-checked and should be updated manually through the admin panel.

---

## Deployment — Replit (Cloud)

1. Push code changes to the repository.
2. In Replit, click **Deploy** (Publish).
3. Replit builds and hosts the app automatically at your `.replit.app` domain.

The production database is separate from development. On first deploy:
- Seed data is auto-inserted for any empty tables.
- New guide links are added via the safe `ensureGuideLinks()` function (checks by title before inserting — never overwrites existing data).

---

## Deployment — IIS (On-Premises)

### Prerequisites (install once on the Windows server)

- [Node.js LTS](https://nodejs.org)
- [iisnode](https://github.com/Azure/iisnode/releases)
- [URL Rewrite Module for IIS](https://www.iis.net/downloads/microsoft/url-rewrite)
- PostgreSQL accessible from the server

### Automated Setup (Windows)

A helper script is included that handles install, build, and database setup in one step. Run it from the project root on the Windows server:

```
scripts\setup-iis.bat
```

The script:
1. Checks that Node.js is installed
2. Copies `.env.example` → `.env` if no `.env` exists yet
3. Runs `npm install`
4. Runs `npm run build`
5. Runs `npm run db:push` to create/update database tables
6. Prints next steps

### Manual Build

If you prefer to run steps yourself:

```bash
npm install
npm run build
```

This produces:
- `dist/index.cjs` — the compiled Express server
- `dist/public/` — the compiled React frontend

### Files to Copy to IIS Site Root

```
dist/
node_modules/
package.json
web.config
```

The `web.config` file is included in the repository and configures iisnode routing automatically.

### IIS Configuration

1. Open **IIS Manager**.
2. Create a new **Website** pointing to the site root folder.
3. Set the **Application Pool** to use **No Managed Code**.
4. Set your desired hostname and port binding.

### Set Environment Variables on the Server

Open a command prompt as Administrator:

```cmd
setx DATABASE_URL "postgresql://user:password@host:5432/dbname" /M
setx ZENDESK_API_TOKEN_SCCC "your-token-here" /M
setx ADMIN_PASSWORD "YourChosenPassword" /M
setx NODE_ENV "production" /M
```

Then **restart IIS** for variables to take effect:

```cmd
iisreset
```

### File Permissions

Make sure the IIS application pool identity (usually `IIS AppPool\YourAppPoolName`) has **read/write** access to the site folder so iisnode can write logs.

---

## Syncing Production Data to Development

If production data has been updated via the admin panel and you want to mirror it in your local dev environment, the sync must be done manually using database queries (SELECT from production, INSERT to development). The general process:

1. Export each table from the production database using SELECT queries.
2. TRUNCATE the corresponding dev tables (`RESTART IDENTITY CASCADE`).
3. INSERT the production rows into dev.
4. Reset PostgreSQL sequences to match the highest ID in each table.

This process preserves all production content — announcements, FAQs, tickets, settings, and everything else — in the development environment for testing without affecting live data.

> **Note:** Production queries are read-only. Development write operations are run separately against the dev database.

---

## Project Structure

```
├── client/                  # React frontend
│   └── src/
│       ├── pages/           # Route-level page components
│       │   ├── home.tsx
│       │   ├── support.tsx
│       │   ├── downloads.tsx
│       │   ├── faq.tsx
│       │   ├── system-status.tsx
│       │   ├── admin.tsx
│       │   ├── dorm-setup.tsx
│       │   └── computer-policy.tsx
│       └── components/      # Shared UI components
├── server/                  # Express backend
│   ├── index.ts             # Server entry point
│   ├── routes.ts            # All API routes
│   ├── storage.ts           # Database access layer
│   ├── seed.ts              # Auto-seed + ensureGuideLinks
│   └── health-check.ts      # Automated service health checker
├── shared/
│   └── schema.ts            # Drizzle ORM schema (shared types)
├── web.config               # IIS + iisnode configuration
└── README.md
```

---

## Contact

**SCCC IT Help Desk**
- Phone: (620) 417-1200
- Email: itech@sccc.edu
- Location: Room AA151, Hobble Academic Building

**Dr. Mark Bojeun — Chief Information Officer**
- Cell: (620) 482-0517
- Office: (620) 417-1202
