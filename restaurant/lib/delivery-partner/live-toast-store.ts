export type LiveToast = {
  id: string;
  title: string;
  body: string;
  tone: 'info' | 'success' | 'warn';
};

type ToastListener = (toasts: LiveToast[]) => void;

let toasts: LiveToast[] = [];
const listeners = new Set<ToastListener>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function subscribeLiveToasts(listener: ToastListener) {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

export function pushLiveToast(toast: Omit<LiveToast, 'id'> & { id?: string }) {
  const next: LiveToast = {
    id: toast.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: toast.title,
    body: toast.body,
    tone: toast.tone,
  };
  toasts = [next, ...toasts].slice(0, 3);
  emit();
  setTimeout(() => dismissLiveToast(next.id), 5200);
}

export function dismissLiveToast(id: string) {
  const next = toasts.filter((row) => row.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function getLiveToasts() {
  return toasts;
}
