declare const toastr: {
  success(message: string, title?: string): void;
  error(message: string, title?: string): void;
  warning(message: string, title?: string): void;
  info(message: string, title?: string): void;
  clear(target?: any): void;
};

interface Window {
  STAuthority?: {
    AuthoritySDK: unknown;
    openSecurityCenter: (options?: { focusExtensionId?: string }) => Promise<void>;
  };
}
