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

/**
 * Webpack-specific runtime require. When the plugin source is bundled by
 * webpack (target: node), webpack replaces `__non_webpack_require__` with
 * the real Node `require` function at runtime instead of its own
 * bundle-time `__webpack_require__`. This is what lets the bundled
 * `runtime/index.cjs` load external `.authority/server.cjs` files from disk
 * by absolute path. Declared as possibly-undefined so callers can fall back
 * to `node:module.createRequire` in unbundled contexts (vitest, ts-node).
 */
declare const __non_webpack_require__: NodeRequire | undefined;
