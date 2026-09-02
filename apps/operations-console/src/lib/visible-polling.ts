export function canPollNow(): boolean {
  return document.visibilityState !== "hidden" && navigator.onLine;
}

// One timer and one recovery refresh per availability transition. Callers own
// request cancellation and stale-state display; resuming never replays a POST.
export function startVisiblePolling(
  poll: () => void,
  pause: () => void,
  intervalMs: number,
  pollImmediately = true,
): () => void {
  let available = canPollNow();
  let timer: number | undefined;
  const start = (immediate: boolean) => {
    if (immediate) poll();
    timer = window.setInterval(() => {
      if (canPollNow()) poll();
      else changed();
    }, intervalMs);
  };
  const changed = () => {
    const next = canPollNow();
    if (next === available) return;
    available = next;
    window.clearInterval(timer);
    timer = undefined;
    if (available) start(true);
    else pause();
  };
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  if (available) start(pollImmediately);
  else pause();
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", changed);
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
}
