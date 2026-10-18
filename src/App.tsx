import { useEffect, useRef, type ComponentType } from "react";
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SessionProvider, useSession } from "./state/session";
import { ToastHost, Spinner } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/Auth";
import { HomePage } from "./pages/Home";
import { LobbyPage } from "./pages/Lobby";
import { TeamWizardPage } from "./pages/TeamWizard";
import { DashboardPage } from "./pages/Dashboard";
import { TeamPage } from "./pages/Team";
import { DriversPage } from "./pages/Drivers";
import { DevelopmentPage } from "./pages/Development";
import { GaragePage } from "./pages/Garage";
import { StaffPage } from "./pages/Staff";
import { FacilitiesPage } from "./pages/Facilities";
import { FinancePage } from "./pages/Finance";
import { SponsorsPage } from "./pages/Sponsors";
import { RaceWeekendPage } from "./pages/RaceWeekend";
import { ChampionshipPage } from "./pages/Championship";
import { CalendarPage } from "./pages/Calendar";
import { StatisticsPage } from "./pages/Statistics";
import { HistoryPage } from "./pages/History";
import { SettingsPage } from "./pages/Settings";

function Splash({ label = "Loading career…" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-carbon-950">
      <Spinner label={label} />
    </div>
  );
}

function HomeRoute() {
  const { user, loading } = useSession();
  if (loading) return <Splash label="Connecting…" />;
  return user ? <HomePage /> : <AuthPage />;
}

function JoinFromQuery() {
  const [params] = useSearchParams();
  const { user, joinLobby, pushToast } = useSession();
  const navigate = useNavigate();
  const attempted = useRef(false);

  useEffect(() => {
    const code = params.get("join");
    if (!user || !code || attempted.current) return;
    attempted.current = true;
    (async () => {
      try {
        await joinLobby(code.toUpperCase());
        pushToast("success", "Joined the lobby");
        navigate("/career/dashboard", { replace: true });
      } catch (e) {
        pushToast("error", (e as Error).message);
      }
    })();
  }, [user, params, joinLobby, navigate, pushToast]);

  return null;
}

function LobbyRoute() {
  const { id } = useParams();
  const { user, lobby, openLobby, loading } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    if (id && lobby?.id !== id) {
      void openLobby(id).catch(() => navigate("/", { replace: true }));
    }
  }, [id, user, lobby?.id, openLobby, navigate]);

  if (loading && !lobby) return <Splash label="Opening lobby…" />;
  if (!user) return <Navigate to="/" replace />;
  if (!lobby || lobby.id !== id) return <Splash label="Opening lobby…" />;
  return <LobbyPage />;
}

const PAGES: Record<string, ComponentType> = {
  dashboard: DashboardPage,
  team: TeamPage,
  drivers: DriversPage,
  garage: GaragePage,
  development: DevelopmentPage,
  staff: StaffPage,
  facilities: FacilitiesPage,
  finance: FinancePage,
  sponsors: SponsorsPage,
  race: RaceWeekendPage,
  championship: ChampionshipPage,
  calendar: CalendarPage,
  statistics: StatisticsPage,
  history: HistoryPage,
  settings: SettingsPage,
};

function CareerRoute() {
  const { section } = useParams();
  const { user, lobby, myTeamId, loading } = useSession();

  if (loading && !lobby) return <Splash label="Loading your team…" />;
  if (!user) return <Navigate to="/" replace />;
  if (!lobby) return <Navigate to="/" replace />;
  if (!myTeamId) return <TeamWizardPage />;

  const Page = PAGES[section ?? "dashboard"] ?? DashboardPage;
  return (
    <AppShell>
      <Page />
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <JoinFromQuery />
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/lobby/:id" element={<LobbyRoute />} />
          <Route path="/career" element={<CareerRoute />} />
          <Route path="/career/:section" element={<CareerRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <ToastHost />
      </SessionProvider>
    </ErrorBoundary>
  );
}
