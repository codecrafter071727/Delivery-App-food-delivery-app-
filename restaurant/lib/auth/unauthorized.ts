type UnauthorizedHandler = () => void | Promise<void>;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler;
}

export async function notifyUnauthorized(): Promise<void> {
  if (!unauthorizedHandler) return;
  await unauthorizedHandler();
}
