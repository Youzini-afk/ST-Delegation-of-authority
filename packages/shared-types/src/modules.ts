import type { PermissionResource, RiskLevel } from './permissions.js';

/**
 * Authority module transaction host shared types.
 *
 * Phase 1 keeps the host restricted to built-in compiled modules. A module
 * exposes a manifest describing its transactions and a set of typed named
 * handlers. Module transactions are invoked through
 * `/modules/:moduleId/transactions/:transactionName` and run inside a scoped
 * context that intentionally avoids handing the full {@link AuthorityRuntime}
 * to module code.
 *
 * Phase 1 also introduces discovery records (`AuthorityModuleRecord`) so that
 * companion modules shipped inside SillyTavern frontend extensions can be
 * surfaced, validated, and diagnosed before their server-side handlers are
 * loaded. Discovery records never change the element type of `modules[]` in
 * {@link ModuleListResponse}; they are exposed alongside the existing
 * executable manifests via the optional `records`/`recordCount` fields.
 */

/** Module identifier. Lowercase, dotted segments allowed (e.g. `sample.module`). */
export type ModuleId = string;

/** Transaction identifier as declared by a module manifest. */
export type ModuleTransactionName = string;

/** Transaction version as declared by a module manifest. */
export type ModuleTransactionVersion = string;

/**
 * Idempotency posture for a transaction.
 *
 * - `none`      -> caller may pass an idempotency key but the host will not require it.
 * - `optional`  -> host stores the key for diagnostics/audit when provided.
 * - `required`  -> host rejects execution when the caller omits the key.
 *
 * Phase 1 only validates presence; durable idempotency replay is out of scope.
 */
export type ModuleTransactionIdempotency = 'none' | 'optional' | 'required';

/** Permission target strategy for a transaction. */
export type ModuleTransactionPermissionTarget =
    | { kind: 'module' }
    | { kind: 'transaction' }
    | { kind: 'custom'; target: string };

/** A permission resource required by a transaction. */
export interface ModuleTransactionRequiredResource {
    resource: PermissionResource;
    target?: string;
    reason?: string;
}

/**
 * Manifest describing a single transaction exposed by a module.
 *
 * The public manifest shape is JSON-serializable so it can be returned
 * verbatim from `listManifests()`/`getManifest()`. Dynamic required-resource
 * resolution lives on the server side
 * (see {@link ModuleHostService.register}'s `requiredResourceResolvers`)
 * and is intentionally not part of this wire shape.
 */
export interface ModuleTransactionManifest {
    name: ModuleTransactionName;
    version: ModuleTransactionVersion;
    title: string;
    description?: string;
    riskLevel: RiskLevel;
    permissionTarget: ModuleTransactionPermissionTarget;
    requiredResources: ModuleTransactionRequiredResource[];
    idempotency: ModuleTransactionIdempotency;
    lockScope?: string;
    timeoutMs?: number;
    /**
     * Optional per-transaction inline request byte limit. When omitted the
     * host default is used. Values are validated against the host hard cap
     * (see {@link MODULE_DEFAULT_REQUEST_BYTES}/{@link MODULE_MAX_REQUEST_BYTES}
     * on the server side) at discovery time so that oversized manifests are
     * rejected up front rather than at execute time.
     */
    maxRequestBytes?: number;
    /**
     * Optional per-transaction inline response byte limit. Same validation
     * posture as {@link maxRequestBytes}.
     */
    maxResponseBytes?: number;
    /** Optional JSON Schema used by Agent hosts and generated clients. */
    inputSchema?: Record<string, unknown>;
    /** Optional JSON Schema describing the successful `result` payload. */
    outputSchema?: Record<string, unknown>;
}

/** Manifest describing an authority module. */
export interface AuthorityModuleManifest {
    id: ModuleId;
    displayName: string;
    version: string;
    description?: string;
    /**
     * Module host protocol version. Must match
     * {@link AUTHORITY_MODULE_PROTOCOL_VERSION} on the server side.
     */
    protocolVersion: number;
    /**
     * Manifest schema version. Phase 1 only accepts schema version `1`.
     */
    schemaVersion?: number;
    /**
     * Owner SillyTavern extension identity (e.g. `third-party/some-extension`
     * or `some-extension`). Discovery validates this against the extension
     * directory that hosts the manifest. The field is contractual metadata
     * only; it never carries runtime status.
     */
    ownerExtensionId?: string;
    /**
     * Relative entry path (e.g. `./server.cjs`). Phase 1 only validates the
     * entry; Phase 2 loads it as CommonJS.
     */
    entry?: string;
    transactions: Record<ModuleTransactionName, ModuleTransactionManifest>;
}

/** Caller-provided options for a module transaction invocation. */
export interface ModuleTransactionRequestOptions {
    dryRun?: boolean;
    timeoutMs?: number;
}

/** Request payload for invoking a module transaction. */
export interface ModuleTransactionRequest {
    idempotencyKey?: string;
    input?: unknown;
    options?: ModuleTransactionRequestOptions;
}

/** Diagnostics returned alongside a module transaction result. */
export interface ModuleTransactionDiagnostics {
    warnings?: string[];
    notes?: Record<string, unknown>;
}

/** Response payload returned by the module host after a successful execution. */
export interface ModuleTransactionResponse {
    ok: true;
    moduleId: ModuleId;
    transaction: ModuleTransactionName;
    transactionVersion: ModuleTransactionVersion;
    idempotencyKey?: string;
    result?: unknown;
    diagnostics?: ModuleTransactionDiagnostics;
}

/**
 * Standardized module transaction error detail codes.
 *
 * Phase 3 hardening requires `ModuleHostService.execute()` to surface these
 * stable codes inside `AuthorityServiceError.details.code` so frontends can
 * branch on a known set rather than parsing free-form messages. The host's
 * existing top-level `code: AuthorityErrorCode` field is preserved for
 * backward compatibility with route-layer normalization.
 *
 * - `module_not_found`               -> no record and no executable module
 *                                       registered under this id.
 * - `transaction_not_found`          -> module exists but the named
 *                                       transaction is not declared.
 * - `module_not_loaded`              -> discovered-but-not-loaded record;
 *                                       execute forbidden.
 * - `module_load_error`             -> record carries `load_error` status;
 *                                       execute forbidden with sanitized
 *                                       diagnostics.
 * - `idempotency_required`           -> manifest declares idempotency
 *                                       `required` and caller omitted the
 *                                       idempotency key.
 * - `dry_run_unsupported`           -> caller passed `options.dryRun = true`
 *                                       but dry-run is not supported.
 * - `module_request_too_large`       -> request payload size exceeded the
 *                                       effective per-transaction
 *                                       `maxRequestBytes` limit.
 * - `module_response_too_large`      -> response payload size exceeded the
 *                                       effective per-transaction
 *                                       `maxResponseBytes` limit.
 * - `module_response_not_serializable` -> handler returned a result that
 *                                       cannot be JSON-serialized (e.g.
 *                                       circular reference, BigInt, function).
 * - `transaction_timeout`           -> handler did not complete within the
 *                                       effective per-transaction timeout.
 * - `transaction_handler_failed`     -> handler threw an error; the original
 *                                       error message is sanitized and
 *                                       included in `details.message`.
 */
export type ModuleErrorCode =
    | 'module_not_found'
    | 'transaction_not_found'
    | 'module_not_loaded'
    | 'module_load_error'
    | 'idempotency_required'
    | 'dry_run_unsupported'
    | 'module_request_too_large'
    | 'module_response_too_large'
    | 'module_response_not_serializable'
    | 'transaction_timeout'
    | 'transaction_handler_failed';

/**
 * Effective per-transaction byte and timeout limits enforced centrally by
 * {@link ModuleHostService.execute()}.
 *
 * Phase 3 exposes these on the companion transaction ctx as safe metadata
 * only; they are NOT service handles. Built-in compiled modules receive the
 * existing {@link ModuleTransactionContext} and are only constrained by
 * these limits when the manifest explicitly declares them — built-ins are
 * not accidentally subject to companion defaults.
 */
export interface ModuleTransactionEffectiveLimits {
    /** Effective max inline request bytes for this transaction. */
    maxRequestBytes: number;
    /** Effective max inline response bytes for this transaction. */
    maxResponseBytes: number;
    /** Effective per-transaction timeout in milliseconds. */
    timeoutMs: number;
    /** Source of the resolved limits: manifest, host default, or hard cap. */
    source: 'manifest' | 'host_default' | 'hard_cap' | 'request';
}

/**
 * Lifecycle / discovery status for an authority module record.
 *
 * - `loaded`                -> executable handler registered; execute allowed.
 * - `available`             -> valid manifest discovered, handler not loaded;
 *                              execute forbidden with structured `module_not_loaded`.
 * - `disabled`              -> admin/debug switch turned this module off
 *                              (Phase 1 placeholder; not set by discovery itself).
 * - `invalid_manifest`      -> manifest JSON/shape/schema/protocol failed validation.
 * - `incompatible_host`    -> manifest references features the host does not support
 *                              (e.g. unsupported protocol version).
 * - `load_error`           -> Phase 2 marker; preserved here so shared types
 *                              do not need to be re-released when Phase 2 ships.
 * - `duplicate_id`         -> another record already won the module id; this
 *                              record is not executable.
 * - `entry_missing`        -> manifest declared an entry that does not exist
 *                              on disk or that escapes the `.authority` dir.
 */
export type ModuleStatus =
    | 'loaded'
    | 'available'
    | 'disabled'
    | 'invalid_manifest'
    | 'incompatible_host'
    | 'load_error'
    | 'duplicate_id'
    | 'entry_missing';

/** Severity for {@link AuthorityModuleDiagnostic}. */
export type ModuleDiagnosticSeverity = 'info' | 'warning' | 'error';

/**
 * Structured diagnostic attached to an {@link AuthorityModuleRecord}.
 *
 * Codes are stable strings so frontends can branch on them without parsing
 * free-form messages.
 */
export interface AuthorityModuleDiagnostic {
    code: string;
    message: string;
    severity: ModuleDiagnosticSeverity;
    details?: Record<string, unknown>;
}

/**
 * Filesystem source of a discovered companion module record.
 *
 * Only safe, relative metadata is exposed on the public wire shape:
 * absolute local paths are intentionally NOT included so that `/modules` and
 * `/modules/:moduleId` responses cannot leak the host's filesystem layout to
 * frontend extensions or SDK callers. The host keeps absolute paths in
 * private server-only state when it needs them for Phase 2 loading.
 *
 * - `extensionId` is the discovered SillyTavern extension identity (e.g.
 *   `third-party/some-extension` or `some-extension`).
 * - `modulePath` is the manifest path relative to the extension dir, always
 *   `.authority/module.json` for Phase 1.
 * - `entry` is the manifest-declared entry path (e.g. `./server.cjs`).
 */
export interface AuthorityModuleRecordSource {
    extensionId: string;
    modulePath?: string;
    entry?: string;
}

/**
 * Discovered-or-registered authority module record.
 *
 * A record describes the current status of one module identity known to the
 * host. Executable modules registered through {@link ModuleHostService.register}
 * surface as `loaded`; modules discovered from a companion extension's
 * `.authority/module.json` surface as `available` (or one of the error
 * statuses when discovery validation failed).
 *
 * Records are intentionally JSON-serializable so they can be returned from
 * `/modules` and `/modules/:moduleId` without leaking handler functions or
 * runtime service objects.
 */
export interface AuthorityModuleRecord {
    moduleId: ModuleId;
    ownerExtensionId: string;
    status: ModuleStatus;
    manifest: AuthorityModuleManifest | null;
    source: AuthorityModuleRecordSource;
    diagnostics?: AuthorityModuleDiagnostic[];
}

/** Response payload for listing registered modules. */
export interface ModuleListResponse {
    /** Executable manifests registered through {@link ModuleHostService.register}. */
    modules: AuthorityModuleManifest[];
    /** Number of entries in {@link modules}. Preserved for backward compatibility. */
    count: number;
    /**
     * All discovery records (loaded, available, and error statuses). Optional
     * because older callers may not request it; the host always populates it
     * for Phase 1+ responses.
     */
    records?: AuthorityModuleRecord[];
    /** Total number of discovery records, including non-executable ones. */
    recordCount?: number;
}

/** Response payload for fetching a single module manifest. */
export interface ModuleGetResponse {
    module: AuthorityModuleManifest;
    /**
     * Discovery record for the requested module, when available. For
     * discovered-but-not-loaded modules this carries the diagnostic status
     * (`available`, `invalid_manifest`, ...) without exposing handlers.
     */
    record?: AuthorityModuleRecord;
}
