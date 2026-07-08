# SCCC IT Tech Support Portal — Deployment Guide

**For: Web Services Manager**  
**Stack:** Node.js + PostgreSQL, running as a Windows service behind IIS

---

## Software to Download First

Download all of these before you start. All are free.

| Software | What It Does | Download Link |
|---|---|---|
| **Node.js 20 LTS** | Runs the portal application | https://nodejs.org/en/download (choose "Windows Installer .msi", 64-bit) |
| **PostgreSQL 16** | The database | https://www.enterprisedb.com/downloads/postgres-postgresql-downloads (choose Windows x86-64) |
| **IIS URL Rewrite Module** | Allows IIS to forward requests to Node | https://www.iis.net/downloads/microsoft/url-rewrite |
| **Application Request Routing (ARR) 3.0** | IIS reverse proxy capability | https://www.iis.net/downloads/microsoft/application-request-routing |
| **NSSM** (Non-Sucking Service Manager) | Keeps Node running as a Windows service | https://nssm.cc/download (download the latest zip, extract `nssm.exe` from the `win64` folder) |

> **Note:** IIS itself must already be enabled on the server. If it is not, go to:  
> **Control Panel → Programs → Turn Windows features on or off → Internet Information Services** → check the box and click OK.

---

## Step 1 — Install Node.js

1. Run the Node.js `.msi` installer you downloaded
2. Accept all defaults — make sure **"Add to PATH"** is checked
3. Click through and finish the install
4. Verify it worked: open **Command Prompt** and run:
   ```
   node --version
   npm --version
   ```
   Both should print a version number (e.g. `v20.x.x` and `10.x.x`)

---

## Step 2 — Install PostgreSQL

1. Run the PostgreSQL installer (`postgresql-16-x-windows-x64.exe`)
2. When asked for an **installation directory**, the default is fine (`C:\Program Files\PostgreSQL\16`)
3. When asked for a **data directory**, the default is fine
4. Set a **password for the postgres superuser** — write this down, you will need it
5. Leave the port as **5432** (default)
6. Leave locale as default
7. Finish the install — **pgAdmin 4** (a graphical database manager) will be installed alongside PostgreSQL automatically

**After install — create the portal database:**

1. Open **pgAdmin 4** (installed with PostgreSQL, find it in the Start Menu)
2. Connect to your local server using the postgres password you just set
3. In the left panel, right-click **Databases** → **Create** → **Database**
4. Name it `sccc_it_portal` and click **Save**
5. Click the database, then click the **Query Tool** button (toolbar)
6. Paste and run this SQL:

```sql
CREATE USER sccc_it_user WITH PASSWORD 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON DATABASE sccc_it_portal TO sccc_it_user;
```

> Replace `choose-a-strong-password` with a real password. Write it down — you will put it in the `.env` file next.

---

## Step 3 — Unzip the Portal

Unzip `sccc-it-portal.zip` to a permanent folder on the server, such as:

```
C:\inetpub\sccc-it-portal\
```

Make sure the folder contains:

```
sccc-it-portal\
├── dist\              ← Built app (server + frontend)
├── package.json
├── package-lock.json
├── web.config         ← IIS config
├── .env.example       ← Config template
└── DEPLOY.md          ← This file
```

---

## Step 4 — Configure the Environment File

1. In the portal folder, find `.env.example`
2. Make a copy of it named `.env` (no `.example`, just `.env`):
   ```
   copy C:\inetpub\sccc-it-portal\.env.example C:\inetpub\sccc-it-portal\.env
   ```
3. Open `.env` in Notepad and fill in these values:

```
DATABASE_URL=postgresql://sccc_it_user:your-password@localhost:5432/sccc_it_portal
ADMIN_PASSWORD=choose-a-secure-admin-password
NODE_ENV=production
PORT=3000
```

- Replace `your-password` with the database user password you set in Step 2
- Replace `choose-a-secure-admin-password` with whatever you want the admin panel login to be
- Save and close the file

**Optional — Zendesk ticket integration** (only needed if IT wants tickets forwarded to Zendesk):

```
ZENDESK_API_TOKEN_SCCC=your-40-character-zendesk-api-token
ZENDESK_ADMIN_EMAIL=mark.bojeun@sccc.edu
ZENDESK_SUBDOMAIN=sccc
```

---

## Step 5 — Install App Dependencies & Set Up Database Tables

Open **Command Prompt as Administrator**, navigate to the portal folder, and run these three commands one at a time:

```cmd
cd C:\inetpub\sccc-it-portal

npm install --omit=dev

node -e "require('dotenv').config(); const {execSync}=require('child_process'); execSync('npx drizzle-kit push', {stdio:'inherit', env:process.env});"
```

The third command creates all the database tables automatically. You should see output ending in `Changes applied`.

---

## Step 6 — Install the IIS URL Rewrite Module

1. Run the **URL Rewrite** installer you downloaded
2. Accept all defaults and finish
3. Restart IIS after install:
   ```cmd
   iisreset
   ```

---

## Step 7 — Install and Enable Application Request Routing (ARR)

1. Run the **ARR 3.0** installer you downloaded
2. Accept all defaults and finish
3. Open **IIS Manager** (search for it in the Start Menu)
4. In the left panel, click the **server name** (the top-level node)
5. In the center panel, double-click **Application Request Routing Cache**
6. In the right panel, click **Server Proxy Settings**
7. Check **Enable proxy** at the top
8. Click **Apply** in the right panel
9. Restart IIS:
   ```cmd
   iisreset
   ```

---

## Step 8 — Create the IIS Website

1. Open **IIS Manager**
2. In the left panel, right-click **Sites** → **Add Website**
3. Fill in:
   - **Site name:** `sccc-it-portal`
   - **Physical path:** `C:\inetpub\sccc-it-portal`
   - **Binding / Host name:** the domain or subdomain you are deploying to (e.g. `it.sccc.edu`)
   - **Port:** 80 (or 443 if you have an SSL certificate)
4. Click **OK**

The `web.config` file included in the ZIP automatically forwards all IIS requests to Node.js on port 3000. No additional IIS configuration is needed.

---

## Step 9 — Run Node as a Windows Service (NSSM)

This keeps the portal running permanently, even after the server restarts.

1. Copy `nssm.exe` (from the `win64` folder of the NSSM zip you downloaded) to somewhere permanent, e.g. `C:\tools\nssm.exe`
2. Open **Command Prompt as Administrator** and run:

```cmd
C:\tools\nssm.exe install sccc-it-portal
```

3. A window will open. Fill in:
   - **Path:** `C:\Program Files\nodejs\node.exe`
   - **Startup directory:** `C:\inetpub\sccc-it-portal`
   - **Arguments:** `dist\index.cjs`
4. Click the **Environment** tab and add:
   ```
   NODE_ENV=production
   ```
5. Click **Install service**
6. Start the service:

```cmd
C:\tools\nssm.exe start sccc-it-portal
```

To check it is running:

```cmd
netstat -an | findstr 3000
```

You should see a line showing something is listening on port 3000.

---

## Step 10 — Verify Everything Works

1. Open a browser on the server and go to `http://localhost:3000` — you should see the portal home page
2. Then go to your public domain (e.g. `https://it.sccc.edu`) — same result through IIS
3. Go to `/admin` and log in with the `ADMIN_PASSWORD` you set
4. Go to `/api/health` — you should see JSON showing `"database": "connected"`

---

## Managing the Service

| Task | Command |
|---|---|
| Stop the portal | `nssm stop sccc-it-portal` |
| Start the portal | `nssm start sccc-it-portal` |
| Restart the portal | `nssm restart sccc-it-portal` |
| Check service status | `nssm status sccc-it-portal` |
| Edit service settings | `nssm edit sccc-it-portal` |
| Remove the service | `nssm remove sccc-it-portal confirm` |

---

## Updating the Portal (Future Deployments)

When a new version is provided:

```cmd
nssm stop sccc-it-portal

REM Replace files in C:\inetpub\sccc-it-portal\ with the new ZIP contents
REM (keep your existing .env file — do not overwrite it)

cd C:\inetpub\sccc-it-portal
npm install --omit=dev

nssm start sccc-it-portal
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node --version` not found after install | Reopen Command Prompt; or reboot; or manually add `C:\Program Files\nodejs` to system PATH |
| "Cannot connect to database" | Check `DATABASE_URL` in `.env`; confirm PostgreSQL service is running (Services → `postgresql-x64-16`) |
| Database tables missing / app crashes on start | Re-run the `drizzle-kit push` command from Step 5 |
| Port 3000 already in use | Change `PORT=` in `.env` and update the port number in `web.config` line `<action url="http://localhost:3000/{R:0}"` |
| Admin panel asks for password | Set `ADMIN_PASSWORD` in `.env` and restart the service (`nssm restart sccc-it-portal`) |
| IIS shows 502 Bad Gateway | Confirm Node is running (`netstat -an \| findstr 3000`); confirm ARR proxy is enabled (Step 7) |
| IIS shows 404 for all pages | Confirm URL Rewrite module is installed and IIS was restarted after install |
| White page / blank screen | Open browser dev tools (F12) → Console tab for errors; check NSSM service logs |

---

## Support

Contact the IT Department if you have questions:  
**itech@sccc.edu** | (620) 417-1200 | Room AA144, Hobble Academic Building
