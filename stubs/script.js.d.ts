export function getRequestHeaders(options?: { omitContentType?: boolean }): Record<string, string>;

export const event_types: Record<string, string>;

export const eventSource: {
  on(eventName: string, handler: (...args: any[]) => any): void;
  off(eventName: string, handler: (...args: any[]) => any): void;
  emit(eventName: string, payload?: any): Promise<any>;
};
