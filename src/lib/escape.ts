export const APP_ESCAPE_REQUEST_EVENT = "app-escape-request";

export interface AppEscapeRequestDetail {
  originalEvent: KeyboardEvent;
  handled: boolean;
  handle: () => void;
}

export type AppEscapeRequestEvent = CustomEvent<AppEscapeRequestDetail>;
export type AppEscapeRequestHandler = (event: AppEscapeRequestEvent) => void;

export const requestAppEscape = (originalEvent: KeyboardEvent) => {
  const detail: AppEscapeRequestDetail = {
    originalEvent,
    handled: false,
    handle: () => {
      detail.handled = true;
    },
  };

  const event = new CustomEvent<AppEscapeRequestDetail>(APP_ESCAPE_REQUEST_EVENT, {
    cancelable: true,
    detail,
  });
  window.dispatchEvent(event);

  return detail.handled || event.defaultPrevented;
};

export const addAppEscapeRequestListener = (handler: AppEscapeRequestHandler) => {
  const listener = (event: Event) => handler(event as AppEscapeRequestEvent);
  window.addEventListener(APP_ESCAPE_REQUEST_EVENT, listener);
  return () => window.removeEventListener(APP_ESCAPE_REQUEST_EVENT, listener);
};
