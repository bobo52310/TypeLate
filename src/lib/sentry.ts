/// <reference types="vite/client" />
import * as Sentry from "@sentry/react";

import { APP_VERSION } from "@/lib/version";

function getSentryDsn(): string {
  return import.meta.env.VITE_SENTRY_DSN?.trim() ?? "";
}

function getSentryEnvironment(): string {
  return import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE;
}

function getSentryRelease(): string {
  return import.meta.env.VITE_SENTRY_RELEASE?.trim() || `typelate@${APP_VERSION}`;
}

function getTracesSampleRate(): number {
  const rawValue = import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE?.trim();
  if (!rawValue) return 0;

  const rate = Number(rawValue);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

function isSentryEnabled(): boolean {
  return import.meta.env.PROD && Boolean(getSentryDsn());
}

export function initSentryForHud(): void {
  if (!isSentryEnabled()) return;

  Sentry.init({
    dsn: getSentryDsn(),
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    sendDefaultPii: false,
    integrations: [],
    initialScope: {
      tags: { window: "hud" },
    },
  });
}

export function initSentryForDashboard(): void {
  if (!isSentryEnabled()) return;

  const tracesSampleRate = getTracesSampleRate();

  Sentry.init({
    dsn: getSentryDsn(),
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    sendDefaultPii: false,
    integrations: tracesSampleRate > 0 ? [Sentry.browserTracingIntegration()] : [],
    ...(tracesSampleRate > 0 ? { tracesSampleRate } : {}),
    initialScope: {
      tags: { window: "dashboard" },
    },
  });
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!isSentryEnabled()) return;

  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
    return;
  }

  Sentry.captureException(error);
}
