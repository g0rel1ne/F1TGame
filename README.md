# F1 Team Principal Online

Build a team. Beat the grid. Run the whole paddock.

F1 Team Principal Online is a browser-based Formula 1 management and race-simulation game. Create your own constructor, sign drivers, develop the car, manage the budget, and take your team from backmarker to world champion. Play solo or share one career with friends in a live multiplayer lobby.

**Play online:** <https://g0rel1ne.github.io/F1TGame/>

---

## What you can do

- **Create your team** - choose your name, colours, livery, engine supplier, headquarters and development philosophy.
- **Run race weekends** - practice programmes, car setup, qualifying, tyre strategy, pit stops, weather, damage, incidents and classified results.
- **Manage a real paddock** - driver contracts and transfers, staff, morale, sponsors, facilities, research projects and a full finance ledger.
- **Watch races live** - top-down cars on every circuit, a camera that follows your team, radio commands, ERS and fuel modes, pit stops, safety cars and track-limit penalties.
- **Build a legacy** - championship standings, prize money, season rollover, records and history.
- **Play together** - every principal owns one team in the same shared career. The host runs the race; everyone can issue radio commands for their own drivers and vote on the replay speed.

## Race weekends

Each round follows the real shape of a Formula 1 weekend:

1. **Practice** - run setup, long-run, qualifying-sim, tyre and reliability programmes.
2. **Setup** - tune downforce and balance for the circuit.
3. **Qualifying** - set the grid.
4. **Race** - choose your pace, fuel mixture, ERS deployment and pit strategy while weather, tyres and incidents change the race.
5. **Results** - points, prize money, sponsor bonuses, repair costs and standings are applied before the calendar advances.

Races can be simulated instantly or run live with everyone watching. Live races include a shareable session, host control, reconnect support, majority speed votes and a server-validated final result.

## Multiplayer

One player creates a lobby and a shared career. Everyone else joins with an invite code, creates their own team, and races in the same world.

- One team per player.
- The host controls race starts, pauses, calendar advancement and host transfer.
- Every member marks themselves ready before a race.
- The host streams the live race; guests see the same positions, gaps, tyres and events.
- Official results are recomputed by the server, so a modified client cannot award itself points or money.

Offline, the same live-race transport works between tabs in one browser, so you can try multiplayer without creating an account.

## Technology

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS
- **Simulation:** deterministic TypeScript engine shared by the browser and Supabase Edge Functions
- **Multiplayer:** Supabase Auth, Postgres, Realtime and Edge Functions
- **Offline mode:** IndexedDB with no backend required
- **Hosting:** GitHub Pages via GitHub Actions

## Run it locally

You need Node.js 20 or newer.

```powershell
npm.cmd install
npm.cmd run dev
```

Open <http://localhost:5173/>, then choose **Play offline** to start a solo career immediately.

For multiplayer, copy `.env.example` to `.env.local`, add your Supabase project URL and anon public key, then restart the dev server. Database migrations live in `supabase/migrations/`, and the Edge Functions live in `supabase/functions/`.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm.cmd run dev` | Start the development server |
| `npm.cmd run build` | Typecheck and build the production site |
| `npm.cmd run preview` | Preview the production build |
| `npm.cmd test` | Run the simulation test suite |
| `npm.cmd run typecheck` | Check TypeScript |
| `npm.cmd run sync:engine` | Copy the shared engine into the Supabase Functions bundle |
| `npx.cmd supabase db push` | Apply database migrations |
| `npx.cmd supabase functions deploy <name>` | Deploy an Edge Function |

## Project layout

```text
src/engine/      deterministic simulation and live-race logic
src/data/        teams, drivers, circuits, sponsors and staff
src/backend/     offline IndexedDB backend and Supabase backend
src/state/       session and shared-career state
src/pages/       game screens
src/components/  race views, maps, cars and UI
supabase/        migrations and Edge Functions
tests/           engine, live-race and protocol tests
scripts/         engine sync tooling
```

## Notes

This is an unofficial fan project and is not affiliated with Formula 1, the FIA or any team. Real driver data is included but disabled by default; the default grid is fictional. Car artwork is original SVG. Circuit outlines are derived from the open-source [f1-circuits](https://github.com/bacinger/f1-circuits) GeoJSON set under the MIT licence.

---

Made by **g0rel1ne**.
