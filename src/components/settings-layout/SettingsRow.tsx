import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

interface SettingsRowProps {
  /** Label text */
  label?: string;
  /** HTML for attribute for the label (links to control id) */
  htmlFor?: string;
  /** Optional description below the label */
  description?: string;
  /** Control element(s) on the right side */
  children?: ReactNode;
  /** Whether to stack vertically instead of side-by-side */
  vertical?: boolean;
  /** Custom className for the row container */
  className?: string;
}

export function SettingsRow({
  label,
  htmlFor,
  description,
  children,
  vertical,
  className,
}: SettingsRowProps) {
  if (vertical) {
    return (
      <div className={`space-y-3 px-4 py-3 ${className ?? ""}`}>
        {label && (
          <div className="space-y-0.5">
            <Label htmlFor={htmlFor}>{label}</Label>
            {description && (
              <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between px-4 py-3 ${className ?? ""}`}>
      {label && (
        <div className="min-w-0 space-y-0.5 pr-4">
          <Label htmlFor={htmlFor}>{label}</Label>
          {description && (
            <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="shrink-0">{children}</div>
    </div>
  );
}
