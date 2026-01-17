const isDev = import.meta.env.DEV;

export function logInfo(tag: string, message: string): void {
  if (isDev) {
    console.log(`[${tag}]`, message);
  }
}

export function logWarn(tag: string, message: string): void {
  if (isDev) {
    console.warn(`[${tag}]`, message);
  }
}

export function logError(tag: string, message: string, error?: unknown): void {
  if (isDev) {
    console.error(`[${tag}]`, message, error);
  }
}
