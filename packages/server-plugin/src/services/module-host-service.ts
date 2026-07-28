import type {
    AuthorityModuleDiagnostic,
    AuthorityModuleManifest,
    AuthorityModuleRecord,
    AuthorityModuleRecordSource,
    ModuleErrorCode,
    ModuleGetResponse,
    ModuleListResponse,
    ModuleTransactionDiagnostics,
    ModuleTransactionEffectiveLimits,
    ModuleTransactionManifest,
    ModuleTransactionName,
    ModuleTransactionRequest,
    ModuleTransactionRequiredResource,
    ModuleTransactionResponse,
    PermissionEvaluateRequest,
} from '@stdo/shared-types';
import { AUTHORITY_MODULE_PROTOCOL_VERSION } from '../constants.js';
import type { AuditService } from './audit-service.js';
import type { JobService } from './job-service.js';
import {
    MODULE_DEFAULT_REQUEST_BYTES,
    MODULE_DEFAULT_RESPONSE_BYTES,
    MODULE_DEFAULT_TIMEOUT_MS,
    MODULE_MAX_REQUEST_BYTES,
    MODULE_MAX_RESPONSE_BYTES,
    MODULE_MAX_TIMEOUT_MS,
} from './module-discovery-service.js';
import type { PermissionService } from './permission-service.js';
import type { PrivateFsService } from './private-fs-service.js';
import type { SseBroker } from '../events/sse-broker.js';
import type { StorageService } from './storage-service.js';
import type { TriviumService } from './trivium-service.js';
import type { SessionRecord, UserContext } from '../types.js';
import { AuthorityServiceError } from '../utils.js';

const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TRANSACTION_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** Result returned by a module transaction handler. */
export interface ModuleTransactionHandlerResult {
    result?: unknown;
    diagnostics?: ModuleTransactionDiagnostics;
}

/** Scoped context handed to a module transaction handler. */
export interface ModuleTransactionContext {
    user: UserContext;
    session: SessionRecord;
    callerExtensionId: string;
    moduleId: string;
    transactionName: string;
    authorize: (request: PermissionEvaluateRequest) => Promise<boolean>;
    audit: AuditService;
    trivium: TriviumService;
    storage: StorageService;
    files: PrivateFsService;
    jobs: JobService;
    events: SseBroker;
    /**
     * Phase 3: AbortSignal owned by the host's timeout enforcement. When the
     * host applies a per-transaction timeout (companion modules always;
     * built-ins when their manifest declares `timeoutMs`), this signal is
     * aborted when the timer fires so cooperative handlers can cancel early.
     *
     * Built-in handlers may ignore this; the host's race rejects with
     * `transaction_timeout` independently. Companion handler wrappers
     * propagate this signal onto the companion ctx so companion code sees
     * the same abort event as the host.
     *
     * When no timeout is enforced (built-in without explicit manifest
     * timeout), this is an already-aborted=false signal that never fires —
     * callers can still read `signal.aborted` safely.
     */
    signal: AbortSignal;
}

/** Handler invoked when a transaction is executed. */
export type ModuleTransactionHandler = (
    ctx: ModuleTransactionContext,
    input: unknown,
    request: ModuleTransactionRequest,
) => Promise<ModuleTransactionHandlerResult>;

/**
 * Server-only resolver that derives a transaction's required permission
 * resources from its input at execution time. Kept out of the public
 * {@link ModuleTransactionManifest} shape so that manifests stay
 * JSON-serializable on the wire.
 */
export type ModuleTransactionRequiredResourceResolver = (
    input: unknown,
) => ModuleTransactionRequiredResource[] | Promise<ModuleTransactionRequiredResource[]>;

/** Server-only options accepted by {@link ModuleHostService.register}. */
export interface ModuleHostRegistrationOptions {
    /**
     * Optional dynamic required-resource resolvers keyed by transaction name.
     * When a resolver is present for a transaction it is invoked at execution
     * time; otherwise the transaction's static `requiredResources` are used.
     */
    requiredResourceResolvers?: Partial<Record<ModuleTransactionName, ModuleTransactionRequiredResourceResolver>>;
    /**
     * Owner extension id for an executable module registered by trusted
     * built-in code. Stored on the discovery record so `/modules` can show
     * the owner alongside discovered companion modules.
     */
    ownerExtensionId?: string;
    /**
     * Optional filesystem source for the registered module. Discovery records
     * carry this for discovered companion modules; built-in registrations
     * usually leave it undefined.
     */
    source?: AuthorityModuleRecordSource;
    /**
     * Phase 2 marker: when `'companion'`, handlers are companion module code
     * loaded from disk and must receive a minimal safe
     * {@link CompanionModuleTransactionContext} via the
     * {@link CompanionModuleLoaderService}. The host refuses to forward raw
     * runtime services (trivium/storage/files/jobs/events) to companion
     * handlers in Phase 2.
     *
     * Built-in compiled modules continue to use the default `'builtin'`
     * context mode and receive the existing {@link ModuleTransactionContext}.
     */
    contextMode?: 'builtin' | 'companion';
}

interface RegisteredModule {
    manifest: AuthorityModuleManifest;
    handlers: Map<ModuleTransactionName, ModuleTransactionHandler>;
    resolvers: Partial<Record<ModuleTransactionName, ModuleTransactionRequiredResourceResolver>>;
    ownerExtensionId?: string;
    source?: AuthorityModuleRecordSource;
    /**
     * Phase 2: tracks whether this module's handlers receive the built-in
     * raw-service ctx or the minimal safe companion tx ctx. Companion
     * handlers are wrapped by the loader to ignore the host-supplied ctx
     * anyway, but this flag lets execute() short-circuit building the raw
     * ctx for companion modules and validates the trust boundary.
     */
    contextMode: 'builtin' | 'companion';
}

function validateModuleId(moduleId: string): void {
    if (!MODULE_ID_PATTERN.test(moduleId)) {
        throw new AuthorityServiceError(
            `Invalid module id: ${moduleId}`,
            400,
            'validation_error',
            'validation',
        );
    }
}

function validateTransactionName(transactionName: string): void {
    if (transactionName.includes(':')) {
        throw new AuthorityServiceError(
            `Invalid transaction name: ${transactionName}`,
            400,
            'validation_error',
            'validation',
        );
    }
    if (!TRANSACTION_NAME_PATTERN.test(transactionName)) {
        throw new AuthorityServiceError(
            `Invalid transaction name: ${transactionName}`,
            400,
            'validation_error',
            'validation',
        );
    }
}

function assertTransactionManifest(
    module: RegisteredModule,
    transactionName: string,
): ModuleTransactionManifest | null {
    const transaction = module.manifest.transactions[transactionName];
    if (!transaction) {
        return null;
    }
    return transaction;
}

/**
 * Resolved effective per-transaction limits used internally by
 * {@link ModuleHostService.execute()}. Built-ins without an explicit manifest
 * limit get `Infinity`; companion modules always get host defaults.
 */
interface ResolvedEffectiveLimits {
    maxRequestBytes: number;
    maxResponseBytes: number;
    timeoutMs: number;
    requestSource: ModuleTransactionEffectiveLimits['source'];
    responseSource: ModuleTransactionEffectiveLimits['source'];
    timeoutSource: ModuleTransactionEffectiveLimits['source'];
}

/**
 * Resolve a single limit (bytes or timeout) for a transaction.
 *
 * - Built-in modules without an explicit manifest limit return `Infinity` so
 *   they are not accidentally subject to companion defaults. This preserves
 *   Phase 1 backward compatibility.
 * - Companion modules without an explicit manifest limit use the host default
 *   (e.g. 64 MiB bytes, 120 s timeout).
 * - Any explicit manifest limit is capped by the hard max so a malicious
 *   companion manifest cannot raise the cap above the host ceiling.
 */
function resolveLimit(
    isCompanion: boolean,
    manifestValue: number | undefined,
    hostDefault: number,
    hardMax: number,
): number {
    if (manifestValue !== undefined && typeof manifestValue === 'number' && Number.isFinite(manifestValue) && manifestValue > 0) {
        return Math.min(manifestValue, hardMax);
    }
    return isCompanion ? hostDefault : Infinity;
}

function limitSource(
    manifestValue: number | undefined,
    hardMax: number,
): ModuleTransactionEffectiveLimits['source'] {
    if (manifestValue === undefined) {
        return 'host_default';
    }
    return manifestValue > hardMax ? 'hard_cap' : 'manifest';
}

/**
 * Measure the byte size of a transaction request payload. Phase 3 measures
 * the WHOLE `ModuleTransactionRequest` (input + idempotencyKey + options +
 * future fields), not just `request.input`, so a malicious huge idempotencyKey
 * or options object cannot bypass the limit. Uses JSON serialization to count
 * the actual wire bytes the host would emit; returns 0 for `undefined`/
 * `null` requests so empty requests never trip the limit.
 */
function measureRequestBytes(request: ModuleTransactionRequest): number {
    if (request === undefined || request === null) {
        return 0;
    }
    try {
        return Buffer.byteLength(JSON.stringify(request), 'utf8');
    } catch {
        // Non-serializable input: treat as oversized so the handler never
        // sees a payload it cannot round-trip. The precise non-serializable
        // code is reserved for response checks; for requests we surface
        // module_request_too_large with a sentinel byte count.
        return Number.POSITIVE_INFINITY;
    }
}

/**
 * Validate that a value is JSON-serializable WITHOUT silent data loss.
 * `JSON.stringify` silently drops `undefined` object fields, function-valued
 * properties, and symbol-keyed properties; it throws on circular refs and
 * BigInt; it converts Map/Set/Date/RegExp/class instances to `{}` or string
 * forms that lose their semantic meaning. Phase 3 must reject all of these
 * explicitly so a handler cannot return a result that round-trips through
 * JSON with missing fields or unexpected type coercions the caller never
 * sees.
 *
 * Returns `null` when the value is a clean JSON value, or a human-readable
 * reason string describing the first violation found.
 */
function validateJsonValue(value: unknown, path = '$', seen = new WeakSet<object>()): string | null {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        if (typeof value === 'number' && !Number.isFinite(value)) {
            return `${path}: non-finite number (NaN/Infinity) is not JSON-serializable`;
        }
        return null;
    }
    if (typeof value === 'undefined') {
        // Top-level undefined is not a valid JSON value. Nested undefined
        // in objects/arrays is caught by the object/array branches below.
        return `${path}: undefined is not a JSON value`;
    }
    if (typeof value === 'function') {
        return `${path}: function is not JSON-serializable`;
    }
    if (typeof value === 'symbol') {
        return `${path}: symbol is not JSON-serializable`;
    }
    if (typeof value === 'bigint') {
        return `${path}: BigInt is not JSON-serializable`;
    }
    if (typeof value !== 'object') {
        return `${path}: unknown type ${typeof value} is not JSON-serializable`;
    }
    // Object or array. Check for circular references via a WeakSet of
    // already-visited objects on the current path.
    if (seen.has(value as object)) {
        return `${path}: circular reference detected`;
    }
    seen.add(value as object);
    try {
        if (Array.isArray(value)) {
            // Reject arrays created via subclasses (e.g. `class MyArray
            // extends Array`) because JSON.stringify serializes them as
            // plain arrays but the caller may rely on the subclass
            // semantics. Only plain Array instances are accepted.
            if (Object.getPrototypeOf(value) !== Array.prototype) {
                return `${path}: array subclass is not a plain JSON array`;
            }
            for (let i = 0; i < value.length; i++) {
                const item = value[i];
                if (item === undefined) {
                    // JSON.stringify converts array undefined to null, which
                    // IS data loss for a caller expecting to distinguish
                    // undefined from null. Reject explicitly.
                    return `${path}[${i}]: undefined array element is not JSON-serializable`;
                }
                const reason = validateJsonValue(item, `${path}[${i}]`, seen);
                if (reason) {
                    return reason;
                }
            }
            return null;
        }
        // Reject non-plain objects. JSON.stringify silently converts Map to
        // `{}`, Set to `{}`, Date to an ISO string (which may be intended
        // but is a type coercion the caller should make explicit), RegExp
        // to `{}`, and class instances to `{}` (dropping private fields).
        // Require plain objects (Object.prototype or null prototype) so the
        // wire payload matches what the handler actually returned.
        const proto = Object.getPrototypeOf(value);
        if (proto !== null && proto !== Object.prototype) {
            const ctorName = proto.constructor?.name ?? 'unknown';
            return `${path}: non-plain object (${ctorName}) is not JSON-serializable; convert to a plain object or array first`;
        }
        // Plain object. Check own enumerable symbol keys (JSON.stringify
        // silently drops ALL symbol-keyed properties) and own enumerable
        // string keys for undefined/function/symbol values.
        const obj = value as Record<string | symbol, unknown>;
        // Object.getOwnPropertySymbols returns own symbol keys (enumerable
        // or not). JSON.stringify drops symbol keys entirely; reject them.
        const symbolKeys = Object.getOwnPropertySymbols(obj);
        for (const sym of symbolKeys) {
            if (Object.prototype.propertyIsEnumerable.call(obj, sym)) {
                return `${path}: symbol-keyed property ${sym.toString()} is not JSON-serializable`;
            }
        }
        for (const key of Object.keys(obj)) {
            const propValue = obj[key];
            if (propValue === undefined) {
                return `${path}.${key}: undefined property value is not JSON-serializable`;
            }
            if (typeof propValue === 'function' || typeof propValue === 'symbol') {
                return `${path}.${key}: ${typeof propValue} property value is not JSON-serializable`;
            }
            const reason = validateJsonValue(propValue, `${path}.${key}`, seen);
            if (reason) {
                return reason;
            }
        }
        return null;
    } finally {
        seen.delete(value as object);
    }
}

/**
 * Sanitize a thrown error message for inclusion in public error details.
 * Strips stack traces and absolute filesystem paths so a handler that throws
 * `Error('at /tmp/authority-companion-XYZ/...')` cannot leak the host's
 * filesystem layout through the wire payload.
 */
function sanitizeErrorMessage(message: string): string {
    let sanitized = message;
    // Strip stack trace fragments (lines starting with "    at ").
    sanitized = sanitized.replace(/\n\s*at\s+[^\n]+/g, '').trim();
    // Strip absolute filesystem paths. Matches a leading `/` followed by at
    // least two path segments (e.g. `/tmp/secret/...`, `/home/user/...`).
    // Single-segment paths like `/api` are preserved because they read as
    // URL paths, not filesystem paths.
    sanitized = sanitized.replace(ABSOLUTE_PATH_PATTERN, '<redacted-path>');
    return sanitized;
}

/**
 * Pattern matching absolute filesystem paths with at least two segments.
 * Used by {@link sanitizeErrorMessage} and {@link sanitizeDetailsObject} to
 * scrub host filesystem layout from public wire payloads. The pattern
 * intentionally requires a path separator after the first segment so that
 * URL-like single-segment paths (`/api`, `/modules`) are preserved.
 */
const ABSOLUTE_PATH_PATTERN = /(?:\b[a-zA-Z]:[\\/][^\r\n"'<>|]*|\\\\[^\\/\s]+[\\/][^\r\n"'<>|]*|\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+)/g;

/**
 * Sanitize discovery/load diagnostics for inclusion in public error details.
 * Strips absolute paths, stack traces, and raw thrown objects from
 * `details` while preserving useful `code`/`message`/`severity` fields.
 */
function sanitizeDiagnosticsForWire(diagnostics: AuthorityModuleDiagnostic[] | undefined): AuthorityModuleDiagnostic[] {
    if (!diagnostics || diagnostics.length === 0) {
        return [];
    }
    return diagnostics.map(diagnostic => {
        const sanitized: AuthorityModuleDiagnostic = {
            code: diagnostic.code,
            message: sanitizeErrorMessage(diagnostic.message),
            severity: diagnostic.severity,
        };
        if (diagnostic.details !== undefined) {
            sanitized.details = sanitizeDetailsObject(diagnostic.details);
        }
        return sanitized;
    });
}

/**
 * Internal-only keys that must NEVER appear in public wire payloads. These
 * are server-side absolute path fields used by the loader and discovery
 * service, plus raw error/stack structures that can leak host internals
 * (filesystem layout, source file paths, internal call sites). Even if a
 * loader or discovery path accidentally stores them on a public record's
 * diagnostics details, the sanitizer strips both the key and its value so
 * the host filesystem layout, stack traces, and raw thrown objects cannot
 * leak through `/modules` or `/modules/:moduleId/record` or
 * `module_load_error` payloads.
 */
const FORBIDDEN_DETAIL_KEYS = new Set([
    // Internal absolute path fields used by the loader and discovery.
    'extensionDir',
    'moduleDir',
    'manifestPath',
    'entryPath',
    'absolutePath',
    'resolvedEntry',
    'realEntry',
    'realModuleDir',
    // Raw error / stack structures. These carry host filesystem paths,
    // internal call sites, and raw thrown objects. The sanitizer strips
    // them entirely rather than echoing the key name (which would leak that
    // the host has such structures). Useful fragments like the sanitized
    // error message are preserved on the diagnostic `message` field.
    'stack',
    'rawError',
    'error',
    'cause',
    'originalError',
    'thrown',
    'exception',
    'trace',
    'stacktrace',
]);

/**
 * Recursively sanitize a details object: strip strings that look like
 * absolute paths or stack traces, and drop internal-only keys entirely.
 * Numbers, booleans, and arrays are preserved; nested objects are recursed.
 */
function sanitizeDetailsObject(details: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
        // Drop forbidden keys entirely so the wire payload does not even
        // echo the key name (which would leak that the host has such
        // paths/stack/raw-error structures).
        if (FORBIDDEN_DETAIL_KEYS.has(key)) {
            continue;
        }
        if (typeof value === 'string') {
            result[key] = sanitizeErrorMessage(value);
        } else if (Array.isArray(value)) {
            result[key] = value.map(item => (typeof item === 'string' ? sanitizeErrorMessage(item) : item));
        } else if (value && typeof value === 'object') {
            result[key] = sanitizeDetailsObject(value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Sanitize a public {@link AuthorityModuleRecord} for wire exposure.
 *
 * Phase 3 blocker fix: `CompanionModuleLoaderService.markLoadError()` stores
 * raw diagnostics on public records; `listRecords()` / `getRecord()` /
 * `listManifests()` / `getManifest()` return records directly. This helper
 * is the single sanitization boundary for ALL public reads so that absolute
 * paths, stack traces, raw thrown objects, and forbidden detail keys
 * (`extensionDir`, `moduleDir`, `manifestPath`, `entryPath`, `stack`,
 * `rawError`, `error`, `cause`, etc. — see {@link FORBIDDEN_DETAIL_KEYS})
 * never leak through `/modules`, `/modules/:moduleId`, or
 * `module_load_error` payloads even if a loader or discovery path
 * accidentally stored them on the record.
 *
 * The returned record is a shallow copy with sanitized diagnostics; the
 * manifest and source are already JSON-serializable shapes from discovery
 * and are passed through unchanged.
 */
function sanitizeRecordForWire(record: AuthorityModuleRecord): AuthorityModuleRecord {
    const sanitized: AuthorityModuleRecord = {
        moduleId: record.moduleId,
        ownerExtensionId: record.ownerExtensionId,
        status: record.status,
        manifest: record.manifest,
        source: record.source,
    };
    if (record.diagnostics !== undefined && record.diagnostics.length > 0) {
        sanitized.diagnostics = sanitizeDiagnosticsForWire(record.diagnostics);
    }
    return sanitized;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class ModuleHandlerTimeoutError extends Error {
    constructor(moduleId: string, transactionName: string, timeoutMs: number) {
        super(`Transaction '${moduleId}/${transactionName}' timed out after ${timeoutMs} ms.`);
        this.name = 'ModuleHandlerTimeoutError';
    }
}

/**
 * Authority module host.
 *
 * Phase 1 keeps this restricted to built-in compiled modules registered through
 * {@link register}. Modules expose typed named transactions; the host performs
 * manifest lookup, idempotency-key validation, dry-run rejection, permission
 * authorization for `module.execute` and any declared
 * {@link ModuleTransactionManifest.requiredResources} (optionally resolved
 * dynamically via {@link ModuleHostRegistrationOptions.requiredResourceResolvers}),
 * then dispatches to the handler with a scoped {@link ModuleTransactionContext}.
 *
 * Public manifests returned from {@link listManifests}/{@link getManifest} are
 * JSON-serializable: they contain no functions.
 */
export class ModuleHostService {
    private readonly modules = new Map<string, RegisteredModule>();
    private readonly records: AuthorityModuleRecord[] = [];
    private readonly primaryRecordByModuleId = new Map<string, number>();
    private readonly recordsByOwner = new Map<string, Set<string>>();

    constructor(
        private readonly permissions: PermissionService,
        private readonly audit: AuditService,
        private readonly trivium: TriviumService,
        private readonly storage: StorageService,
        private readonly files: PrivateFsService,
        private readonly jobs: JobService,
        private readonly events: SseBroker,
    ) {}

    register(
        manifest: AuthorityModuleManifest,
        handlers: Record<ModuleTransactionName, ModuleTransactionHandler>,
        options: ModuleHostRegistrationOptions = {},
    ): void {
        this.registerInternal(manifest, handlers, options, 'builtin');
    }

    /**
     * Phase 2 companion module registration. Companion modules are loaded
     * from disk by {@link CompanionModuleLoaderService} and their handlers
     * are wrapped so they receive a minimal safe
     * {@link CompanionModuleTransactionContext} (no raw trivium/storage/files/
     * jobs/events services). The host treats the registered module as
     * `contextMode: 'companion'` so execute() knows not to build the raw
     * service ctx for its handlers.
     */
    registerCompanion(
        manifest: AuthorityModuleManifest,
        handlers: Record<ModuleTransactionName, ModuleTransactionHandler>,
        options: Omit<ModuleHostRegistrationOptions, 'contextMode'> = {},
    ): void {
        this.registerInternal(manifest, handlers, options, 'companion');
    }

    private registerInternal(
        manifest: AuthorityModuleManifest,
        handlers: Record<ModuleTransactionName, ModuleTransactionHandler>,
        options: ModuleHostRegistrationOptions,
        contextMode: 'builtin' | 'companion',
    ): void {
        validateModuleId(manifest.id);
        if (manifest.protocolVersion !== AUTHORITY_MODULE_PROTOCOL_VERSION) {
            throw new AuthorityServiceError(
                `Unsupported module protocol version: ${manifest.protocolVersion}`,
                400,
                'validation_error',
                'validation',
            );
        }
        if (this.modules.has(manifest.id)) {
            throw new AuthorityServiceError(
                `Module already registered: ${manifest.id}`,
                409,
                'validation_error',
                'validation',
            );
        }

        const handlerMap = new Map<ModuleTransactionName, ModuleTransactionHandler>();
        for (const name of Object.keys(manifest.transactions)) {
            validateTransactionName(name);
            const transaction = manifest.transactions[name];
            if (!transaction) {
                throw new AuthorityServiceError(
                    `Transaction entry missing for: ${manifest.id}/${name}`,
                    400,
                    'validation_error',
                    'validation',
                );
            }
            if (transaction.name !== name) {
                throw new AuthorityServiceError(
                    `Transaction name mismatch for ${manifest.id}/${name}: declared name '${transaction.name}'`,
                    400,
                    'validation_error',
                    'validation',
                );
            }
            const handler = handlers[name];
            if (!handler) {
                throw new AuthorityServiceError(
                    `Missing handler for transaction: ${manifest.id}/${name}`,
                    400,
                    'validation_error',
                    'validation',
                );
            }
            handlerMap.set(name, handler);
        }

        const registered: RegisteredModule = {
            manifest,
            handlers: handlerMap,
            resolvers: options.requiredResourceResolvers ?? {},
            contextMode,
            ...(options.ownerExtensionId !== undefined ? { ownerExtensionId: options.ownerExtensionId } : {}),
            ...(options.source !== undefined ? { source: options.source } : {}),
        };
        this.modules.set(manifest.id, registered);

        // Reflect the executable module as a `loaded` record so /modules can
        // surface one consistent picture across built-in and discovered modules.
        this.upsertRecord(this.buildLoadedRecord(registered));
    }

    /**
     * Register (or replace) a discovery record that is not (yet) backed by an
     * executable handler. Used by {@link ModuleDiscoveryService} and admin
     * shims. Records with `loaded` status are kept in sync with executable
     * registrations through {@link register} and should not normally be
     * registered here.
     *
     * Duplicate handling: if a primary record (`available`/`loaded`) already
     * exists for the same moduleId from a different owner extension, the
     * incoming record is stored as a `duplicate_id` record alongside the
     * original rather than overwriting it. The first valid record wins.
     */
    registerDiscoveredRecord(record: AuthorityModuleRecord): void {
        const existingIndex = this.primaryRecordByModuleId.get(record.moduleId);
        const existing = existingIndex !== undefined ? this.records[existingIndex] : undefined;

        // Preserve any already-loaded executable record: a discovered
        // `available` record for an id that is currently loaded must not
        // overwrite the loaded status.
        if (existing?.status === 'loaded' && record.status !== 'loaded') {
            this.appendDuplicateRecord(record, existing);
            return;
        }

        // Duplicate handling: when an existing record is already present with
        // a primary status (available/loaded) and the incoming record also
        // claims the same moduleId with a primary status from a different
        // owner, treat the incoming one as a duplicate_id rather than
        // silently overwriting the winner.
        if (
            existing
            && (existing.status === 'available' || existing.status === 'loaded')
            && (record.status === 'available' || record.status === 'loaded')
            && existing.source.extensionId !== record.source.extensionId
        ) {
            this.appendDuplicateRecord(record, existing);
            return;
        }

        this.upsertRecord(record);
    }

    /**
     * Bulk-register discovery records. Deterministic: first valid record for
     * a module id wins; later duplicates become `duplicate_id` records.
     */
    registerDiscoveredRecords(records: Iterable<AuthorityModuleRecord>): void {
        for (const record of records) {
            this.registerDiscoveredRecord(record);
        }
    }

    /**
     * Returns all discovery records (loaded + discovered + error statuses).
     *
     * Phase 3: returns sanitized copies so `/modules` never leaks absolute
     * paths, stack traces, or internal keys even if a loader or discovery
     * path accidentally stored them on the record.
     */
    listRecords(): AuthorityModuleRecord[] {
        return this.records.map(record => sanitizeRecordForWire(record));
    }

    /**
     * Returns the primary discovery record for a module id, if any.
     *
     * Phase 3: returns a sanitized copy so `/modules/:moduleId/record` and
     * `getManifest()` never leak absolute paths, stack traces, or internal
     * keys.
     */
    getRecord(moduleId: string): AuthorityModuleRecord | null {
        const index = this.primaryRecordByModuleId.get(moduleId);
        if (index === undefined) {
            return null;
        }
        const record = this.records[index];
        return record ? sanitizeRecordForWire(record) : null;
    }

    /** Returns the total number of discovery records (visible module count). */
    recordCount(): number {
        return this.records.length;
    }

    listManifests(): ModuleListResponse {
        const modules = [...this.modules.values()].map(entry => entry.manifest);
        const records = this.listRecords();
        return {
            modules,
            count: modules.length,
            records,
            recordCount: records.length,
        };
    }

    getManifest(moduleId: string): ModuleGetResponse {
        validateModuleId(moduleId);
        const module = this.modules.get(moduleId);
        const record = this.getRecord(moduleId);
        if (!module) {
            if (record && record.manifest) {
                return { module: record.manifest, record };
            }
            throw new AuthorityServiceError(
                `Module not found: ${moduleId}`,
                404,
                'validation_error',
                'validation',
            );
        }
        return {
            module: module.manifest,
            ...(record ? { record } : {}),
        };
    }

    count(): number {
        return this.modules.size;
    }

    /**
     * Returns the visible module count for probe/session features. Phase 1
     * prefers discovery record count (loaded + available + error statuses)
     * so that installed companion modules surface even before their handlers
     * are loaded. Falls back to executable count when no records exist.
     */
    visibleCount(): number {
        const recordCount = this.records.length;
        return recordCount > 0 ? recordCount : this.modules.size;
    }

    async execute(
        user: UserContext,
        session: SessionRecord,
        moduleId: string,
        transactionName: string,
        request: ModuleTransactionRequest,
        externalSignal?: AbortSignal,
    ): Promise<ModuleTransactionResponse> {
        validateModuleId(moduleId);
        validateTransactionName(transactionName);

        if (request.options?.dryRun === true) {
            throw new AuthorityServiceError(
                `Dry-run execution is not supported: ${moduleId}/${transactionName}`,
                400,
                'validation_error',
                'validation',
                { code: 'dry_run_unsupported' as ModuleErrorCode, moduleId, transaction: transactionName },
            );
        }
        const requestedTimeoutMs = request.options?.timeoutMs;
        if (requestedTimeoutMs !== undefined
            && (!Number.isSafeInteger(requestedTimeoutMs) || requestedTimeoutMs < 1 || requestedTimeoutMs > MODULE_MAX_TIMEOUT_MS)) {
            throw new AuthorityServiceError(
                `Transaction timeoutMs must be an integer between 1 and ${MODULE_MAX_TIMEOUT_MS}`,
                400,
                'validation_error',
                'validation',
                { code: 'validation_error', moduleId, transaction: transactionName, timeoutMs: requestedTimeoutMs },
            );
        }

        const module = this.modules.get(moduleId);
        if (!module) {
            const record = this.getRecord(moduleId);
            if (record && record.status === 'load_error') {
                // Phase 3: load_error records return a structured
                // module_load_error with sanitized diagnostics, NOT the
                // generic module_not_loaded path. This lets the frontend
                // distinguish "broken module" from "not yet loaded".
                throw new AuthorityServiceError(
                    `Module failed to load: ${moduleId}`,
                    409,
                    'validation_error',
                    'validation',
                    {
                        code: 'module_load_error' as ModuleErrorCode,
                        moduleId,
                        status: record.status,
                        diagnostics: sanitizeDiagnosticsForWire(record.diagnostics),
                    },
                );
            }
            if (record && record.manifest) {
                // Discovered-but-not-loaded module: structured error so the
                // frontend can distinguish "missing" from "available but
                // not activated yet".
                throw new AuthorityServiceError(
                    `Module not loaded: ${moduleId}`,
                    409,
                    'validation_error',
                    'validation',
                    { code: 'module_not_loaded' as ModuleErrorCode, moduleId, status: record.status },
                );
            }
            throw new AuthorityServiceError(
                `Module not found: ${moduleId}`,
                404,
                'validation_error',
                'validation',
                { code: 'module_not_found' as ModuleErrorCode, moduleId },
            );
        }
        const transaction = assertTransactionManifest(module, transactionName);
        if (!transaction) {
            throw new AuthorityServiceError(
                `Transaction not found: ${moduleId}/${transactionName}`,
                404,
                'validation_error',
                'validation',
                { code: 'transaction_not_found' as ModuleErrorCode, moduleId, transaction: transactionName },
            );
        }

        if (transaction.idempotency === 'required') {
            const key = typeof request.idempotencyKey === 'string' ? request.idempotencyKey.trim() : '';
            if (!key) {
                throw new AuthorityServiceError(
                    `Idempotency key required for transaction: ${moduleId}/${transactionName}`,
                    400,
                    'validation_error',
                    'validation',
                    { code: 'idempotency_required' as ModuleErrorCode, moduleId, transaction: transactionName },
                );
            }
        }

        // Resolve effective limits. Built-in modules are NOT accidentally
        // subject to companion defaults: built-ins only enforce limits when
        // the manifest explicitly declares them (source: 'manifest'). When
        // a built-in manifest omits a limit, the host does not enforce it
        // for that module — preserving backward compatibility with Phase 1
        // built-ins that have no byte/timeout expectations. Companion
        // modules always get host defaults (source: 'host_default' or
        // 'hard_cap') because they are untrusted external code.
        const limits = this.resolveEffectiveLimits(module, transaction, requestedTimeoutMs);

        // Phase 3: enforce request size centrally before dispatching to the
        // handler. Measure the WHOLE request payload (input + idempotencyKey
        // + options + future fields), not just `request.input`, so a
        // malicious huge idempotencyKey or options object cannot bypass the
        // limit. Built-ins without an explicit manifest limit have
        // maxRequestBytes: Infinity and are not constrained.
        const requestBytes = measureRequestBytes(request);
        if (requestBytes > limits.maxRequestBytes) {
            throw new AuthorityServiceError(
                `Transaction request too large: ${moduleId}/${transactionName} (${requestBytes} bytes > ${limits.maxRequestBytes} bytes)`,
                413,
                'limit_exceeded',
                'limit',
                {
                    code: 'module_request_too_large' as ModuleErrorCode,
                    moduleId,
                    transaction: transactionName,
                    requestBytes,
                    maxRequestBytes: limits.maxRequestBytes,
                    limitSource: limits.requestSource,
                },
            );
        }

        const permissionTarget = this.resolvePermissionTarget(transaction, moduleId, transactionName);
        const authorize = this.buildAuthorize(user, session);
        const authorized = await authorize({
            resource: 'module.execute',
            target: permissionTarget,
        });
        if (!authorized) {
            throw new Error(`Permission not granted: module.execute for ${permissionTarget}`);
        }

        const requiredResources = await this.resolveRequiredResources(module, transaction, request.input);
        for (const required of requiredResources) {
            const requiredAuthorized = await authorize({
                resource: required.resource,
                ...(required.target === undefined ? {} : { target: required.target }),
                ...(required.reason === undefined ? {} : { reason: required.reason }),
            });
            if (!requiredAuthorized) {
                const target = required.target ?? '';
                throw new Error(
                    target
                        ? `Permission not granted: ${required.resource} for ${target}`
                        : `Permission not granted: ${required.resource}`,
                );
            }
        }

        // Phase 3: the host owns the AbortController for timeout
        // enforcement. The same signal is exposed on the ctx (both the
        // built-in ModuleTransactionContext.signal and, via the loader
        // wrapper, CompanionModuleTransactionContext.signal) so cooperative
        // handlers see the abort event when the timer fires. The host's race
        // also rejects with `transaction_timeout` independently.
        const abortController = new AbortController();

        // Phase 2: companion modules do NOT receive the raw service ctx.
        // Their handlers are wrapped by the CompanionModuleLoaderService to
        // build a minimal safe CompanionModuleTransactionContext from the
        // metadata below; the raw trivium/storage/files/jobs/events services
        // are intentionally absent for companion code. We still pass a
        // metadata-only stub ctx here so that built-in handlers continue to
        // receive the full ModuleTransactionContext, and so companion
        // handler wrappers can read user/session/callerExtensionId and the
        // host-owned `signal` without needing the raw services.
        const ctx: ModuleTransactionContext = {
            user,
            session,
            callerExtensionId: session.extension.id,
            moduleId,
            transactionName,
            authorize,
            audit: this.audit,
            trivium: this.trivium,
            storage: this.storage,
            files: this.files,
            jobs: this.jobs,
            events: this.events,
            signal: abortController.signal,
        };

        const handler = module.handlers.get(transactionName);
        if (!handler) {
            throw new AuthorityServiceError(
                `Handler missing for transaction: ${moduleId}/${transactionName}`,
                500,
                'core_request_failed',
                'core',
                { code: 'transaction_handler_failed' as ModuleErrorCode, moduleId, transaction: transactionName, reason: 'handler_missing' },
            );
        }

        const input = request.input ?? undefined;
        // For companion modules the handler is already wrapped by the loader
        // to ignore the raw ctx and build a CompanionModuleTransactionContext
        // internally. We still pass the metadata-bearing ctx so the wrapper
        // can read user/session/callerExtensionId and the host-owned
        // `signal` without us leaking raw services into companion code paths.
        void module.contextMode;

        // Phase 3: enforce timeout centrally. The handler races a timer so a
        // hung transaction cannot hold the request forever. Built-ins
        // without an explicit manifest timeout have timeoutMs: Infinity and
        // are not constrained, preserving Phase 1 compatibility. When a
        // timeout IS enforced, the host aborts `abortController` when the
        // timer fires so cooperative handlers (built-in and companion) see
        // `signal.aborted === true`.
        const handlerResult = await this.invokeHandlerWithLimits(
            handler,
            ctx,
            input,
            request,
            module,
            transaction,
            limits,
            abortController,
            externalSignal,
        );

        // Phase 3: serialize the response to detect non-serializable results
        // before returning to the HTTP route. JSON.stringify throws on
        // circular references, BigInt, functions, etc.
        const response: ModuleTransactionResponse = {
            ok: true,
            moduleId,
            transaction: transactionName,
            transactionVersion: transaction.version,
        };

        const idempotencyKey = typeof request.idempotencyKey === 'string' && request.idempotencyKey.trim()
            ? request.idempotencyKey.trim()
            : undefined;
        if (idempotencyKey !== undefined) {
            response.idempotencyKey = idempotencyKey;
        }
        if (handlerResult.result !== undefined) {
            response.result = handlerResult.result;
        }
        if (handlerResult.diagnostics !== undefined) {
            response.diagnostics = handlerResult.diagnostics;
        }

        // Phase 3: response size + serializability check. We validate the
        // JSON shape FIRST (catches functions, symbols, undefined object
        // fields/array elements, BigInt, and circular refs that
        // JSON.stringify would either throw on or silently drop), then
        // serialize to measure byte length (catches oversized responses).
        // Both surface as structured module error codes.
        const validationReason = validateJsonValue(response);
        if (validationReason !== null) {
            throw new AuthorityServiceError(
                `Transaction response is not JSON-serializable: ${moduleId}/${transactionName}: ${validationReason}`,
                500,
                'core_request_failed',
                'core',
                {
                    code: 'module_response_not_serializable' as ModuleErrorCode,
                    moduleId,
                    transaction: transactionName,
                    reason: validationReason,
                },
            );
        }
        let serializedResponseBytes: number;
        try {
            const serialized = JSON.stringify(response);
            serializedResponseBytes = Buffer.byteLength(serialized, 'utf8');
        } catch (error) {
            // Defensive: the validator should have caught everything
            // stringify would throw on, but if a new edge case slips through
            // we still surface it as module_response_not_serializable rather
            // than letting an opaque TypeError reach the route layer.
            throw new AuthorityServiceError(
                `Transaction response is not JSON-serializable: ${moduleId}/${transactionName}`,
                500,
                'core_request_failed',
                'core',
                {
                    code: 'module_response_not_serializable' as ModuleErrorCode,
                    moduleId,
                    transaction: transactionName,
                    reason: errorMessage(error),
                },
            );
        }
        if (serializedResponseBytes > limits.maxResponseBytes) {
            throw new AuthorityServiceError(
                `Transaction response too large: ${moduleId}/${transactionName} (${serializedResponseBytes} bytes > ${limits.maxResponseBytes} bytes)`,
                413,
                'limit_exceeded',
                'limit',
                {
                    code: 'module_response_too_large' as ModuleErrorCode,
                    moduleId,
                    transaction: transactionName,
                    responseBytes: serializedResponseBytes,
                    maxResponseBytes: limits.maxResponseBytes,
                    limitSource: limits.responseSource,
                },
            );
        }

        await this.audit.logUsage(user, session.extension.id, `Module transaction executed: ${moduleId}/${transactionName}`, {
            moduleId,
            transaction: transactionName,
            transactionVersion: transaction.version,
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        }).catch(() => undefined);

        return response;
    }

    /**
     * Resolve effective per-transaction limits. Built-in compiled modules
     * are only constrained when their manifest explicitly declares a limit;
     * built-ins without explicit limits get `Infinity` and are not
     * accidentally subject to companion defaults. Companion modules always
     * get host defaults (64 MiB / 120 s) capped by the hard max (256 MiB /
     * 10 min) because they are untrusted external code.
     */
    private resolveEffectiveLimits(
        module: RegisteredModule,
        transaction: ModuleTransactionManifest,
        requestedTimeoutMs?: number,
    ): ResolvedEffectiveLimits {
        const isCompanion = module.contextMode === 'companion';
        const maxRequestBytes = resolveLimit(
            isCompanion,
            transaction.maxRequestBytes,
            MODULE_DEFAULT_REQUEST_BYTES,
            MODULE_MAX_REQUEST_BYTES,
        );
        const maxResponseBytes = resolveLimit(
            isCompanion,
            transaction.maxResponseBytes,
            MODULE_DEFAULT_RESPONSE_BYTES,
            MODULE_MAX_RESPONSE_BYTES,
        );
        const configuredTimeoutMs = resolveLimit(
            isCompanion,
            transaction.timeoutMs,
            MODULE_DEFAULT_TIMEOUT_MS,
            MODULE_MAX_TIMEOUT_MS,
        );
        const requestSource = limitSource(transaction.maxRequestBytes, MODULE_MAX_REQUEST_BYTES);
        const responseSource = limitSource(transaction.maxResponseBytes, MODULE_MAX_RESPONSE_BYTES);
        let timeoutSource = limitSource(transaction.timeoutMs, MODULE_MAX_TIMEOUT_MS);
        const timeoutMs = requestedTimeoutMs === undefined
            ? configuredTimeoutMs
            : Math.min(configuredTimeoutMs, requestedTimeoutMs);
        if (requestedTimeoutMs !== undefined && requestedTimeoutMs <= configuredTimeoutMs) {
            timeoutSource = 'request';
        }
        return { maxRequestBytes, maxResponseBytes, timeoutMs, requestSource, responseSource, timeoutSource };
    }

    /**
     * Invoke the handler with a timeout race. Phase 3 owns timeout
     * enforcement centrally so it applies uniformly to built-ins (when their
     * manifest declares a timeout) and companion modules (always). Built-ins
     * without an explicit timeout have `timeoutMs: Infinity` and are not
     * constrained.
     *
     * When a timeout IS enforced, the host aborts `abortController` when the
     * timer fires. The same signal is exposed on the ctx (both built-in and,
     * via the loader wrapper, companion) so cooperative handlers see
     * `signal.aborted === true` and can cancel early. The host's race also
     * rejects with `transaction_timeout` independently — the abort is a
     * cooperative hint, not a force-stop.
     *
     * The timer is cleared on both resolve and reject so it cannot fire
     * after the handler has completed and abort a signal that the caller
     * may have retained for post-processing (e.g. a companion handler that
     * stored the signal on a long-lived object).
     */
    private async invokeHandlerWithLimits(
        handler: ModuleTransactionHandler,
        ctx: ModuleTransactionContext,
        input: unknown,
        request: ModuleTransactionRequest,
        module: RegisteredModule,
        transaction: ModuleTransactionManifest,
        limits: ResolvedEffectiveLimits,
        abortController: AbortController,
        externalSignal?: AbortSignal,
    ): Promise<ModuleTransactionHandlerResult> {
        if (externalSignal?.aborted) {
            throw abortSignalError(externalSignal);
        }

        let timer: ReturnType<typeof setTimeout> | undefined;
        let abortListener: (() => void) | undefined;
        let timedOut = false;
        const contenders: Promise<ModuleTransactionHandlerResult>[] = [
            Promise.resolve().then(() => handler(ctx, input, request)),
        ];
        if (limits.timeoutMs !== Infinity) {
            contenders.push(new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    timedOut = true;
                    const timeoutError = new ModuleHandlerTimeoutError(module.manifest.id, transaction.name, limits.timeoutMs);
                    abortController.abort(timeoutError);
                    reject(timeoutError);
                }, limits.timeoutMs);
                if (typeof timer === 'object' && timer && 'unref' in timer && typeof timer.unref === 'function') {
                    timer.unref();
                }
            }));
        }
        if (externalSignal) {
            contenders.push(new Promise<never>((_, reject) => {
                abortListener = () => {
                    abortController.abort(externalSignal.reason);
                    reject(abortSignalError(externalSignal));
                };
                externalSignal.addEventListener('abort', abortListener, { once: true });
                if (externalSignal.aborted) {
                    abortListener();
                }
            }));
        }

        try {
            const result = await Promise.race(contenders);
            return result;
        } catch (error) {
            if (timedOut || error instanceof ModuleHandlerTimeoutError) {
                throw new AuthorityServiceError(
                    `Module transaction timed out: ${module.manifest.id}/${transaction.name}`,
                    504,
                    'timeout',
                    'timeout',
                    {
                        code: 'transaction_timeout' as ModuleErrorCode,
                        moduleId: module.manifest.id,
                        transaction: transaction.name,
                        timeoutMs: limits.timeoutMs,
                        limitSource: limits.timeoutSource,
                    },
                );
            }
            if (externalSignal?.aborted) {
                throw abortSignalError(externalSignal);
            }
            throw this.wrapHandlerError(error, module.manifest.id, transaction.name);
        } finally {
            // Always clear the timer on settle so it cannot fire after the
            // race has resolved/rejected. Without this, a timer scheduled
            // with `unref()` could still abort the controller later if the
            // caller retained the signal for post-processing, surprising
            // downstream code that did not expect an abort.
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            if (abortListener) {
                externalSignal?.removeEventListener('abort', abortListener);
            }
        }
    }

    private wrapHandlerError(error: unknown, moduleId: string, transactionName: string): AuthorityServiceError {
        // If the handler already threw an AuthorityServiceError with a module
        // error code, preserve it rather than double-wrapping. This lets
        // companion handler wrappers (e.g. the loader's timeout wrapper)
        // surface their own structured codes.
        if (error instanceof AuthorityServiceError) {
            return error;
        }
        const message = sanitizeErrorMessage(errorMessage(error));
        return new AuthorityServiceError(
            `Transaction handler failed: ${moduleId}/${transactionName}: ${message}`,
            500,
            'core_request_failed',
            'core',
            {
                code: 'transaction_handler_failed' as ModuleErrorCode,
                moduleId,
                transaction: transactionName,
                message,
            },
        );
    }

    private buildAuthorize(user: UserContext, session: SessionRecord): (request: PermissionEvaluateRequest) => Promise<boolean> {
        return async (request: PermissionEvaluateRequest): Promise<boolean> => {
            const grant = await this.permissions.authorize(user, session, request);
            return grant !== null;
        };
    }

    private resolvePermissionTarget(
        transaction: ModuleTransactionManifest,
        moduleId: string,
        transactionName: string,
    ): string {
        switch (transaction.permissionTarget.kind) {
            case 'module':
                return moduleId;
            case 'transaction':
                return `${moduleId}:${transactionName}`;
            case 'custom':
                return transaction.permissionTarget.target || `${moduleId}:${transactionName}`;
            default:
                return `${moduleId}:${transactionName}`;
        }
    }

    private async resolveRequiredResources(
        module: RegisteredModule,
        transaction: ModuleTransactionManifest,
        input: unknown,
    ): Promise<ModuleTransactionRequiredResource[]> {
        const resolver = module.resolvers[transaction.name];
        if (resolver) {
            return await resolver(input);
        }
        return transaction.requiredResources;
    }

    private upsertRecord(record: AuthorityModuleRecord): void {
        const existingIndex = this.primaryRecordByModuleId.get(record.moduleId);
        if (existingIndex !== undefined) {
            const existing = this.records[existingIndex];
            if (existing) {
                // Preserve diagnostics across upserts so callers can see why a
                // record was originally marked unavailable.
                const mergedDiagnostics = [
                    ...(existing.diagnostics ?? []),
                    ...(record.diagnostics ?? []),
                ];
                const merged: AuthorityModuleRecord = {
                    ...record,
                    ...(mergedDiagnostics.length > 0 ? { diagnostics: mergedDiagnostics } : {}),
                };
                this.records[existingIndex] = merged;
            } else {
                this.records.push(record);
                this.primaryRecordByModuleId.set(record.moduleId, this.records.length - 1);
            }
        } else {
            this.records.push(record);
            this.primaryRecordByModuleId.set(record.moduleId, this.records.length - 1);
        }

        const ownerSet = this.recordsByOwner.get(record.ownerExtensionId) ?? new Set<string>();
        ownerSet.add(record.moduleId);
        this.recordsByOwner.set(record.ownerExtensionId, ownerSet);
    }

    /**
     * Append a `duplicate_id` record to the records list without disturbing
     * the primary record for this module id. The duplicate is stored as a
     * separate entry so `/modules` can show both the winner and the
     * rejected duplicate for diagnostics.
     */
    private appendDuplicateRecord(record: AuthorityModuleRecord, winner: AuthorityModuleRecord): void {
        const duplicate: AuthorityModuleRecord = {
            ...record,
            status: 'duplicate_id',
            diagnostics: [
                ...(record.diagnostics ?? []),
                {
                    code: 'duplicate_module_id',
                    message: `Module id '${record.moduleId}' already registered from ${winner.source.extensionId}.`,
                    severity: 'warning',
                },
            ],
        };
        this.records.push(duplicate);

        const ownerSet = this.recordsByOwner.get(duplicate.ownerExtensionId) ?? new Set<string>();
        ownerSet.add(duplicate.moduleId);
        this.recordsByOwner.set(duplicate.ownerExtensionId, ownerSet);
    }

    private buildLoadedRecord(module: RegisteredModule): AuthorityModuleRecord {
        const ownerExtensionId = module.ownerExtensionId ?? 'builtin';
        const source: AuthorityModuleRecordSource = module.source ?? { extensionId: ownerExtensionId };
        return {
            moduleId: module.manifest.id,
            ownerExtensionId,
            status: 'loaded',
            manifest: module.manifest,
            source,
        };
    }
}

function abortSignalError(signal: AbortSignal): Error {
    if (signal.reason instanceof Error) {
        return signal.reason;
    }
    return Object.assign(new Error('Module transaction cancelled'), { name: 'AbortError' });
}
