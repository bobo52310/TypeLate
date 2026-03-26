interface SettingsFeedbackProps {
  message: string;
  type: "success" | "error" | "";
  className?: string;
}

export function SettingsFeedback({ message, type, className }: SettingsFeedbackProps) {
  if (!message) return null;

  return (
    <p
      className={`px-4 py-2 text-sm ${
        type === "success" ? "text-primary" : "text-destructive"
      } ${className ?? ""}`}
    >
      {message}
    </p>
  );
}
