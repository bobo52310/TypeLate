import { useSyncExternalStore, useCallback, lazy, Suspense } from "react";

const DashboardView = lazy(() => import("@/views/DashboardView"));
const HistoryView = lazy(() => import("@/views/HistoryView"));
const DictionaryView = lazy(() => import("@/views/DictionaryView"));
const AiSettingsView = lazy(() => import("@/views/AiSettingsView"));
const SettingsView = lazy(() => import("@/views/SettingsView"));

export type RoutePath = "/dashboard" | "/history" | "/dictionary" | "/ai" | "/settings/general" | "/settings/voice" | "/settings/dictionary" | "/settings/about";

export const ROUTES: RoutePath[] = ["/dashboard", "/history", "/dictionary", "/ai", "/settings/general", "/settings/voice", "/settings/dictionary", "/settings/about"];

const ROUTE_COMPONENTS: Record<RoutePath, React.LazyExoticComponent<React.ComponentType>> = {
  "/dashboard": DashboardView,
  "/history": HistoryView,
  "/dictionary": DictionaryView,
  "/ai": AiSettingsView,
  "/settings/general": SettingsView,
  "/settings/voice": SettingsView,
  "/settings/dictionary": SettingsView,
  "/settings/about": SettingsView,
};

function getHashPath(): RoutePath {
  const raw = window.location.hash.slice(1).split("?")[0] || "/dashboard";
  // Redirect legacy /settings to /settings/general
  if (raw === "/settings") {
    window.location.hash = "/settings/general";
    return "/settings/general";
  }
  if (ROUTES.includes(raw as RoutePath)) return raw as RoutePath;
  return "/dashboard";
}

function subscribeToHash(callback: () => void): () => void {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function useHashRouter() {
  const currentPath = useSyncExternalStore(subscribeToHash, getHashPath, getHashPath);

  const navigate = useCallback((path: RoutePath) => {
    window.location.hash = path;
  }, []);

  return { currentPath, navigate };
}

export function RouterOutlet() {
  const { currentPath } = useHashRouter();
  const Component = ROUTE_COMPONENTS[currentPath];

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}
