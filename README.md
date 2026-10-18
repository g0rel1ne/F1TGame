# F1 Team Principal Online

A browser-based Formula 1 team-management and race-simulation career game.
Everything in this guide is copy-paste friendly for Windows PowerShell.

There are two ways to play:

| Mode | What you need | Where data is saved |
| --- | --- | --- |
| **Solo (offline)** | Node.js only | Your browser (IndexedDB) |
| **Multiplayer** | Node.js + a free Supabase project | Supabase (shared lobby) |

You can start solo in about two minutes. Multiplayer takes about ten minutes the
first time, then it is just `npm.cmd run dev`.

---

## Part 1 - Run it solo (no account, no backend)

### Step 1. Install Node.js

Install **Node.js 20 or newer** from <https://nodejs.org> (the LTS installer is
fine). Then open PowerShell and check:

```powershell
node --version
npm.cmd --version
```

> **Windows note:** use `npm.cmd` and `npx.cmd` instead of `npm` / `npx`. If you
> type plain `npm`, PowerShell may block `npm.ps1` with an execution-policy error.

### Step 2. Install the project

```powershell
cd C:\Users\fspal\Documents\f1game
npm.cmd install
```

### Step 3. Start the game

```powershell
npm.cmd run dev
```

You will see something like:

```
  VITE v5.4.21  ready in 300 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.20:5173/
```

Open **http://localhost:5173/** in your browser.

### Step 4. In the game

1. Click **Play offline**.
2. Click **Create career**.
3. Fill in the team wizard (name, colours, engine, philosophy) and create your team.
4. You are now on the dashboard. Progress is saved automatically in this browser.

That is solo mode. No Supabase, no accounts, no internet required after install.

### Stopping and restarting

- Stop the terminal with `Ctrl + C`.
- Start again later with `npm.cmd run dev`.
- Data stays in the same browser profile. Clearing site data deletes the career.
- Offline solo careers are stored in one browser profile only. Two different
  browsers (or a browser and an incognito window) cannot share one — use online
  multiplayer for that.
- Invitation codes work between **tabs of the same browser** (they share the
  local database), but never across devices. "No lobby found with that
  invitation code" in offline mode means the code was made in a different
  browser or device.

---

## Part 2 - Run it multiplayer (Supabase)

Multiplayer needs one shared database so every player sees the same career.
Supabase's free tier is enough.

### Step 1. Create a Supabase project

1. Go to <https://supabase.com> and sign in.
2. Click **New project**.
3. Pick an organisation, a name (for example `f1-game`), a strong database
   password, and the region closest to you.
4. Wait until the project finishes provisioning (about a minute).

### Step 2. Copy your API credentials

In the Supabase dashboard:

1. Open **Project Settings** (gear icon) → **API**.
2. Copy **Project URL** (looks like `https://abcdefghijklm.supabase.co`).
3. Copy the **anon public** key.

> Never use the `service_role` key in the frontend or in `.env.local`. The anon
> key is the public one and is safe to ship. Row Level Security enforces access.

### Step 3. Create `.env.local`

In the project folder, create a file named `.env.local` (it is gitignored) with:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
VITE_BASE_PATH=/
```

Replace the two placeholder values with what you copied. Keep `VITE_BASE_PATH=/`
for local development.

If you already ran the dev server, stop it (`Ctrl + C`) and start it again after
saving this file. Vite only reads env files at startup.

### Step 4. Install/link the Supabase CLI

Run these from the project folder:

```powershell
npx.cmd supabase --version
npx.cmd supabase login
```

`login` opens a browser window; approve it and return to the terminal.

Find your **project ref** (the part before `.supabase.co` in your Project URL),
then:

```powershell
npx.cmd supabase link --project-ref YOUR-PROJECT-REF
```

It asks for the database password you set in Step 1.

> Docker is **not** required for `link`, `db push` or `functions deploy`.
> It is only needed for running Supabase locally with `supabase start`.

### Step 5. Create the database tables

```powershell
npx.cmd supabase db push
```

Confirm with `y` if asked. This applies
`supabase/migrations/0001_init.sql`, which creates:

- `profiles` - public username for each account
- `lobbies`, `lobby_members` - lobbies, hosts, invite codes, readiness
- `chat_messages` - lobby chat
- `careers` - the shared career snapshot
- Row Level Security policies, lobby join function, and Realtime publication

**Alternative without the CLI:** open **SQL Editor** in the Supabase dashboard,
paste the entire contents of `supabase/migrations/0001_init.sql`, and click
**Run**. Then continue with Step 6.

### Step 6. Deploy the game server functions

These Edge Functions run the authoritative simulation and finance logic. First
copy the shared engine into the functions bundle:

```powershell
npm.cmd run sync:engine
```

Then deploy all six functions:

```powershell
npx.cmd supabase functions deploy apply-action
npx.cmd supabase functions deploy start-race
npx.cmd supabase functions deploy set-ready
npx.cmd supabase functions deploy negotiate
npx.cmd supabase functions deploy transfer-host
npx.cmd supabase functions deploy remove-member
```

Supabase automatically provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` to deployed functions. You do not need to set them.

Re-run `npm.cmd run sync:engine` and redeploy the functions every time
`src/engine` or `src/data` changes, otherwise the server and browser will run
different versions of the game.

### Step 7. Make sign-in easy for testing

Supabase may require email confirmation by default.

In the dashboard go to **Authentication** → **Providers** → **Email** and either:

- turn **Confirm email** off for quick testing, or
- keep it on and click the confirmation link in each test account's email.

Also set **Authentication** → **URL Configuration** → **Site URL** to
`http://localhost:5173` while developing.

### Step 8. Start and play

```powershell
npm.cmd run dev
```

Open <http://localhost:5173>. You now get the online sign-in screen instead of
the offline button.

**Host:**

1. Sign up with email + password + username.
2. Create a lobby (public or private).
3. Copy the invite code or the `?join=CODE` link.
4. Create your team.

**Every other player:**

1. Open the link, or sign up and enter the invite code on the home page.
2. Create their own team in the same career.

**Race weekend:**

1. Everyone runs practice and sets up their car.
2. **Every online member must press Ready** - including the host, and even in a
   one-player online lobby.
3. Only the **host** can start the race, advance the calendar, or begin a new
   season.

### Testing multiplayer on one PC

Use two different browsers (for example Chrome and Edge), or one normal window
and one incognito window. Two tabs in the same profile share the same login.

### Playing with a friend on your Wi-Fi

Start the dev server with the host flag:

```powershell
npm.cmd run dev -- --host
```

Vite prints a **Network** URL such as `http://192.168.1.20:5173/`. Your friend
opens that address on the same Wi-Fi and uses the invite code. They still need
internet access because the game data lives in Supabase.

### Playing with a friend anywhere (recommended)

Deploy the frontend to GitHub Pages (Part 3) and share that URL plus the invite
code. Do not share your localhost address - it only works on your machine.

---

## Part 3 - Put it online with GitHub Pages

The repository already contains `.github/workflows/deploy.yml`.

### Step 1. Push the project to GitHub

If this folder is not a git repository yet:

```powershell
git init
git add .
git commit -m "F1 Team Principal Online"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

### Step 2. Add your Supabase secrets

In the GitHub repository: **Settings** → **Secrets and variables** → **Actions**
→ **New repository secret**. Add:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | your Project URL |
| `VITE_SUPABASE_ANON_KEY` | your anon public key |

### Step 3. Enable Pages

**Settings** → **Pages** → **Build and deployment** → **Source**:
**GitHub Actions**.

### Step 4. Deploy

Push to `main` again (or run the workflow manually from the **Actions** tab).
The workflow installs, typechecks, tests, builds and publishes the site.

Your game will be at:

```
https://YOUR-USERNAME.github.io/YOUR-REPO/
```

The workflow automatically uses `/<repo-name>/` as the base path. If you use a
custom domain or a `username.github.io` root repository, add a repository
**variable** named `VITE_BASE_PATH` with the value `/`.

### Step 5. Allow the deployed URL in Supabase

In **Authentication** → **URL Configuration**, add your Pages URL to **Site URL**
and **Redirect URLs** (for example `https://YOUR-USERNAME.github.io/YOUR-REPO/`).

---

## Part 4 - Everyday commands

Run these from `C:\Users\fspal\Documents\f1game`.

| Command | What it does |
| --- | --- |
| `npm.cmd run dev` | Start the game (solo or online, depending on `.env.local`) |
| `npm.cmd run dev -- --host` | Same, but reachable by other devices on your Wi-Fi |
| `npm.cmd run build` | Typecheck and build the static site into `dist/` |
| `npm.cmd run preview` | Serve the production build locally |
| `npm.cmd test` | Run the automated engine tests |
| `npm.cmd run typecheck` | TypeScript checks only |
| `npm.cmd run sync:engine` | Copy engine/data into Supabase Functions (run before deploying functions) |
| `npx.cmd supabase db push` | Apply new database migrations |
| `npx.cmd supabase functions deploy <name>` | Deploy one Edge Function |

### Switching between solo and online

- **Online:** keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` filled in
  `.env.local`, then restart `npm.cmd run dev`.
- **Solo offline:** comment out both values (or rename `.env.local`), then restart
  `npm.cmd run dev`. The **Play offline** button returns.

Solo careers in offline mode exist only in that browser. If you want a solo
career saved online, use multiplayer mode and simply create a private lobby
alone.

---

## Part 5 - How the game works

### Weekend flow

1. **Practice** - run setup, long-run, qualifying-sim, tyre and reliability
   programs to learn the ideal setup.
2. **Setup** - tune downforce and balance for the circuit.
3. **Ready** - every online member confirms.
4. **Race** - qualifying, strategy, pit stops, weather, tyre wear, damage,
   incidents and a classified result. The replay can be scrubbed on the map.
5. **Results** - points, prize money, sponsor bonuses, repair costs and
   standings update. The host advances to the next round.

### Career systems

- Team identity, colours, livery, logo and engine supplier
- Driver contracts, negotiation, morale and a three-driver limit
- Research projects with quality rolls, failures and installation
- Nine upgradable facilities
- Staff market across ten roles
- Salaries, prize money, sponsors, transaction ledger and emergency funding
- Championship standings, calendar, statistics, history and season rollover

### Multiplayer rules

- One team per player per career.
- The host owns calendar advancement, race starts, pause, host transfer and
  member removal.
- Every online member must be ready before the host can start a race.
- Career state is stored as one versioned JSON snapshot. Browsers can read it;
  only Edge Functions can write it, so clients cannot fake results or money.
- If two players act at the same instant, one gets a "career was updated"
  message. Refresh and repeat the action.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `npm.ps1 cannot be loaded` | Use `npm.cmd` / `npx.cmd`. |
| `Port 5173 is already in use` | Stop the other dev server, or run `npm.cmd run dev -- --port 5174`. |
| The app still shows **Play offline** after adding `.env.local` | Stop and restart `npm.cmd run dev`; env files are read at startup. |
| Sign-up says "Email not confirmed" | Confirm the email, or disable **Confirm email** in Supabase Auth settings. |
| `join_lobby_by_code` does not exist | The migration was not applied. Run `npx.cmd supabase db push` or run the SQL file in the SQL Editor. |
| `Career not found for this lobby` | Create a fresh lobby after applying the migration. |
| "X not ready" when starting | Every online member, including the host, must press Ready first. |
| `Unauthorized` / `Invalid or expired session` | Sign out and back in; make sure the function was deployed with JWT verification (default). |
| Edge Function returns `Missing environment variable` | Redeploy through the Supabase CLI; platform secrets are injected automatically. |
| Engine changes do not affect online races | Run `npm.cmd run sync:engine` and redeploy the six functions. |
| GitHub Pages shows a blank page | Set repository variable `VITE_BASE_PATH` to `/<repo-name>/` (or `/` for a root site). |
| Refreshing a deep link gives 404 | The workflow copies `index.html` to `404.html`; make sure the latest workflow ran. |
| Supabase project paused | Free projects pause after inactivity. Restore it from the dashboard. |
| Build fails on `node:url` / `process` | Run `npm.cmd install`; `@types/node` and `tsconfig.node.json` types are required. |

---

## Assumptions and legal notes

- Circuit outlines trace the real track layouts, derived from the open-source
  [f1-circuits](https://github.com/bacinger/f1-circuits) GeoJSON set (MIT
  licence), then simplified and normalised for the map.
- Cars use an original SVG design. No official logos, liveries, photographs or
  fonts are included.
- Real driver names are present in the data but disabled by default; the default
  roster is fictional.
- AI teams use real constructor names as competitors. This is an unofficial fan
  project, not affiliated with Formula 1, the FIA or any team.
- All money values are fictional and simplified for gameplay.

## Project layout

```
src/engine/      pure deterministic simulation (shared by browser and server)
src/data/        teams, drivers, circuits, sponsors, staff
src/backend/     offline IndexedDB backend + Supabase backend
src/state/       session provider
src/pages/       all screens
supabase/        migration + six Edge Functions
scripts/         sync-engine.mjs
tests/           Vitest engine tests
```
