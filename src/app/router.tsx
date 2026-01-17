import { useSyncExternalStore, useCallback, lazy, Suspense } from "react";

// Lazy-loaded view components
const DashboardView = lazy(() => import("@/views/DashboardView"));
const HistoryView = lazy(() => import("@/views/HistoryView"));
const DictionaryView = lazy(() => import("@/views/DictionaryView"));
const SettingsView = lazy(() => import("@/views/SettingsView"));

// ── Route definitions ──

export type RoutePath = "/dashboard" | "/history" | "/dictionary" | "/settings";

export const ROUTES: RoutePath[] = [
  "/dashboard",
  "/history",
  "/dictionary",
  "/settings",
];

const ROUTE_COMPONENTS: Record<RoutePath, React.LazyExoticComponent<React.ComponentType>> = {
  "/dashboard": DashboardView,
  "/history": HistoryView,
  "/dictionary": DictionaryView,
  "/settings": SettingsView,
};

// ── Hash-based router ──

function getHashPath(): RoutePath {
  const raw = window.location.hash.slice(1) || "/dashboard";
  if (ROUTES.includes(raw as RoutePath)) return raw as RoutePath;
  return "/dashboard";
}

function subscribeToHash(callback: () => void): () => void {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

/**
 * Lightweight hash-based router hook.
 * Uses `useSyncExternalStore` to stay in sync with `window.location.hash`.
 */
export function useHashRouter() {
  const currentPath = useSyncExternalStore(subscribeToHash, getHashPath, getHashPath);

  const navigate = useCallback((path: RoutePath) => {
    window.location.hash = path;
  }, []);

  return { currentPath, navigate };
}

/**
 * Renders the view component for the current hash route.
 */
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
