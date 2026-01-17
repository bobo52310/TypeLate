interface SiteHeaderProps {
  title: string;
}

export function SiteHeader({ title }: SiteHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
      <h1 className="text-base font-semibold text-foreground">{title}</h1>
    </header>
  );
}
