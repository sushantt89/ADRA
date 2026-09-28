# ADRA — client support app (prototype, stage 3)

A working prototype of the client support app for emergency relief, built to the proposal outline.
It runs in the browser, **installs like an app, and keeps working with no internet**.

> Use made-up test data only. Do not enter real client information into this prototype.

## Run it on Windows

1. Install **Node.js LTS** from https://nodejs.org if `node -v` doesn't work in a terminal.
2. Open this folder in VS Code, then open a terminal (**Terminal → New Terminal**).
3. Run:

   ```
   npm install
   npm run dev
   ```

4. Open http://localhost:5173. The first time, you create an **administrator** (your name and a PIN).
5. Go to **Device → Load demo data**. This adds fictional clients plus three demo sign-ins:

   | Name | Role | PIN |
   |---|---|---|
   | Alex | Volunteer | 1111 |
   | Sam | Staff | 2222 |
   | Chris | Coordinator | 3333 |

## What's in it (mapped to the proposal)

| Proposal section | Feature | Where |
|---|---|---|
| 5.1 Offline | Installs as an app, opens and saves with no internet, auto-syncs when back online | Everywhere, top bar |
| 5.1 Sync | Sends offline records, downloads other sites' changes, merges field by field, flags true conflicts for review | Sync |
| 5.2 / 5.7 Fast entry | One-tap service buttons (keys 1–9), whole-household toggle (H), visit templates (several services in one tap), Undo, auto-fill from last visit | Client page |
| 5.7 Swipe | Swipe a search result right to record the first service button for that person, left for the whole household (with Undo) | Search |
| 5.2 Bulk family entry | Register partner, children and dependents on the same form | New client |
| 5.2 Auto-save | Unfinished registrations are kept as a draft | New client |
| 5.3 Advanced search | Fuzzy names, DOB, phone, address, postcode, client ID, CRN / Medicare / licence, background and language, household members | Search |
| 5.3 Filters & saved searches | Alert, interpreter, disability, visited recently, suburb, income, culture; save and reuse | Search → Filters |
| 5.4 Relationships | Household tree, add member, shared household services | Client page |
| 5.5 Traceability | Every change stamped with user, site and time; change history per client; logins, exports and conflicts logged | Client page → Change history |
| 5.5 Duplicates | Live warning while registering, plus a cross-site duplicate review with merge | New client, Duplicates |
| 5.5 Consent | Consent method, date and on-screen signature | New client |
| 5.6 Configurable fields | Admins add custom questions (text, number, date, yes/no, list), required or restricted | Admin → Custom fields |
| 5.8 Reporting | Funder summary, 15+ breakdowns, date / site / service filters; CSV, Excel and real PDF files | Reports |
| 5.8 Automated reports | Weekly or monthly schedules; reports are made automatically into a Report inbox, with optional desktop notifications | Reports → Scheduled reports |
| 5.9 Dockets | Printable docket or PDF with household, services, eligibility date, next appointment | Client page → Print docket |
| 5.9 Docket branding | Logo, accent colour, contact line, A4 or 80 mm receipt paper, choose which sections show (incl. signature lines), live preview | Admin → Docket design |
| 11 Training | Guided walkthrough on first sign-in (tailored to each role), tips the first time each screen opens, Help page with how-to guides, shortcuts and FAQs (printable as a training handout) | Help |
| Security | PIN sign-in, 4 roles, restricted fields hidden from volunteers, ID numbers masked, auto-lock, lock on reload | Everywhere |
| Admin tools | Users and roles, PIN reset, sites, service types, support methods, service buttons, visit templates, eligibility days, auto-lock time | Admin |

### Roles

- **Volunteer**: search, register, record services, print dockets. Disability notes, alert details and ID numbers are hidden or masked.
- **Staff**: the above plus sensitive details, void services, reports and change history.
- **Coordinator**: the above plus exports, merging duplicates and resolving sync conflicts.
- **Admin**: everything, including the Admin page.

### Walkthroughs and help

- The first time each person signs in, a short **guided tour** points out the main parts of the screen. It's tailored to their role.
- The first time they open a client record, the registration form, Reports, Sync or Admin, they get a few tips about that screen.
- Tours can be skipped (Esc) and replayed any time from **Help**. Help also has step-by-step guides, keyboard shortcuts and FAQs.
- Use **Print guide** to get a paper handout for volunteer inductions.

Keyboard: `/` search · `Alt+N` new client · `Alt+L` lock · `1`–`9` service buttons · `H` whole household.

## Put it online for testing (Render, free)

The project includes a `Dockerfile`. It builds the app with Node, then serves it with nginx.

1. Push this project to GitHub.
2. In Render: **New → Web Service**, then pick the GitHub repo. Render detects the Dockerfile. Choose the **Free** instance type.
   Or use **New → Blueprint**, which reads `render.yaml` and sets this up for you.
3. After the first build (a few minutes), the app is live at the `onrender.com` address Render shows.
4. Every `git push` to `main` redeploys it automatically.

Notes:

- On the free plan, Render puts the service to sleep after about 15 minutes without visits. The next visit takes up to a minute to wake it. Once someone has opened the app, it still opens offline from their device.
- The yellow **TEST VERSION** banner is on by default. Testers' data stays in their own browser, so use made-up details only.
- To run the same container on your own computer: `docker build -t adra . && docker run -p 10000:10000 adra`, then open http://localhost:10000

## Try offline mode and sync

Offline mode is most reliable with the production build:

```
npm run build
npm run preview
```

1. Open http://localhost:4173 once while online.
2. Turn Wi-Fi off and reload. Enter your PIN, then search, register and record services as normal.
3. Turn Wi-Fi back on. The app syncs by itself within a few seconds.

To see a **conflict** and a **cross-site duplicate**:

1. Edit a client's phone number.
2. Go to **Sync → Simulate changes from another site**, then press **Sync now**.
3. Review the conflict on the Sync page and the new duplicate on the Duplicates page.

## Important limits of the prototype

- **The "server" is pretend.** It's a second database inside your browser (`src/sync/mockServer.ts`). A real cloud database replaces it in the next stage.
- **Sign-in is a PIN stored on the device.** The live system needs proper accounts with passwords and multi-factor authentication.
- **Data on the device isn't encrypted**, beyond what the operating system does. The live system needs device encryption and remote sign-out.
- **Settings and users are per device.** The live system stores them centrally.
- **Scheduled reports are made when the app is open** (it catches up next time it opens). Emailing them to people needs the cloud server.

## How it's built

- **React + TypeScript + Vite**: the screens
- **vite-plugin-pwa (Workbox)**: saves the app on the device for offline use
- **Dexie (IndexedDB)**: the on-device database
- **write-excel-file**: Excel export
- **jsPDF + jspdf-autotable**: PDF reports and dockets

```
src/
  db/types.ts        data model (matches docs/schema.sql)
  db/db.ts           on-device database + settings
  db/repo.ts         save / audit / search / duplicates / merge
  db/demo.ts         fictional demo data
  sync/sync.ts       sync engine (push, pull, conflicts)
  sync/mockServer.ts pretend cloud server: replace with Supabase / PowerSync
  lib/auth.ts        PIN sign-in
  lib/permissions.ts what each role can do
  lib/tours.ts       walkthrough content (components/Tour.tsx draws it)
  lib/reportData.ts  report numbers, shared by screen, exports and schedules
  lib/exporters.ts   CSV / Excel / PDF files
  lib/schedules.ts   scheduled reports
  pages/             Search, ClientForm, ClientPage, Docket, Reports, Sync, Duplicates, Admin, Device, Help
docs/schema.sql      the future cloud database (PostgreSQL)
```

## Next stage: going live

1. **Cloud database** in Sydney (e.g. Supabase) using `docs/schema.sql`, with row-level security matching `lib/permissions.ts`.
2. **Real sync**: swap `mockServer` in `src/sync/sync.ts` for PowerSync or a Supabase adapter.
3. **Real accounts**: Supabase Auth or Microsoft Entra ID with MFA. Users, settings and custom fields move to the server.
4. **Device security**: encrypted local storage and remote sign-out.
5. **Funder reporting**: map fields and exports to DSS Data Exchange (DEX) definitions.
6. **Security review and privacy impact assessment** before any real client data goes in.
