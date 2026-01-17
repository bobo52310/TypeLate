import { useCallback, useRef, useState } from "react";

type FeedbackType = "success" | "error" | "";

const FEEDBACK_DISPLAY_DURATION_MS = 2500;

export function useFeedbackMessage() {
  const [message, setMessage] = useState("");
  const [type, setType] = useState<FeedbackType>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(
    (feedbackType: "success" | "error", feedbackMessage: string) => {
      clearTimer();
      setType(feedbackType);
      setMessage(feedbackMessage);
      timerRef.current = setTimeout(() => {
        setMessage("");
        setType("");
      }, FEEDBACK_DISPLAY_DURATION_MS);
    },
    [clearTimer],
  );

  return { message, type, show, clearTimer };
}
