export const POPUP_TYPE: Record<string, number>;
export const POPUP_RESULT: Record<string, number | null>;

export class Popup {
  result: number | null | string;
  inputResults?: Map<string, string | boolean>;
  constructor(content: string | Element, type: number, inputValue?: string, options?: Record<string, any>);
  show(): Promise<any>;
  complete(result: number | null | string): Promise<any>;
}

export function callGenericPopup(content: string | Element, type: number, defaultValue?: string, options?: Record<string, any>): Promise<any>;
