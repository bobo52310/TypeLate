import type { ReactNode } from "react";

interface SettingsGroupProps {
  /** Small muted title above the group container */
  title?: string;
  /** Optional description below the title, before the group */
  description?: string;
  children: ReactNode;
}

export function SettingsGroup({ title, description, children }: SettingsGroupProps) {
  return (
    <section className="space-y-1.5">
      {title && (
        <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      )}
      {description && (
        <p className="px-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {children}
      </div>
    </section>
  );
}
