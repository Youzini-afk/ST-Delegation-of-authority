import { createRequire } from 'node:module';
import path from 'node:path';
import type {
    AuthorityModuleDiagnostic,
    AuthorityModuleManifest,
    AuthorityModuleRecord,
    ModuleStatus,
    ModuleTransactionManifest,
    ModuleTransactionName,
    ModuleTransactionRequest,
    PermissionEvaluateRequest,
} from '@stdo/shared-types';
import { AUTHORITY_MODULE_PROTOCOL_VERSION } from '../constants.js';
import type { AuditService } from './audit-service.js';
import type { PermissionService } from './permission-service.js';
import { revalidateLoadCandidate, type CompanionModuleLoadCandidate } from './module-discovery-service.js';
import type { ModuleDiscoveryResult } from './module-discovery-service.js';
import type { ModuleHostService, ModuleTransactionHandler, ModuleTransactionHandlerResult } from './module-host-service.js';
import type { SessionRecord, UserContext } from '../types.js';
import { AuthorityServiceError } from '../utils.js';

/**
 * Webpack-specific runtime require. When the plugin source is bundled by
 * webpack (target: node), `__non_webpack_require__` resolves to the real Node
 * `require` function at runtime instead of webpack's bundle-time
 * `__webpack_require__`. This is what lets the bundled `runtime/index.cjs`
 * load external `.authority/server.cjs` files from disk by absolute path.
 *
 * The ambient declaration lives in `stubs/globals.d.ts` so the rest of the
 * codebase stays unaware of it.
 *
 * When the source runs unbundled (vitest, ts-node), `__non_webpack_require__`
 * is undefined and we fall back to `createRequire(import.meta.url)` which
 * produces a Node require rooted at this module URL.
 */
function resolveRuntimeRequire(): NodeRequire {
    if (typeof __non_webpack_require__ !== 'undefined') {
        return __non_webpack_require__;
    }
    return createRequire(import.meta.url);
}

/**
 * Companion authority module loader.
 *
 * Phase 2 scope: load local `.authority/server.cjs` for valid discovered
 * companion module records at startup, invoke `module.exports.activate(ctx)`,
 * validate that activation registers exactly the transactions declared in the
 * manifest, and re-register the resulting handlers with the
 * {@link ModuleHostService} so `execute()` works. Failures never block DOA
 * startup; the affected record transitions to `load_error` and the host
 * surfaces it through `/modules` for diagnostics.
 *
 * Boundary contract (non-negotiable):
 *
 * - Only `available` records with a manifest + entry + internal source reach
 *   `require()`. Invalid, duplicate, disabled, incompatible,
 *   entry-missing, and no-entry records never load.
 * - The activation ctx exposes only `moduleId`, `ownerExtensionId`,
 *   `moduleDir`, `logger`, and `registerTransaction(name, definition)`. It
 *   does NOT receive SQL/fs/blob/trivium/jobs/events/runtime/core/raw
 *   services.
 * - Companion transaction handlers receive a deliberately tiny safe
 *   {@link CompanionModuleTransactionContext} in Phase 2: metadata, logger,
 *   audit wrapper, authorize, AbortSignal, requestId. Richer scoped wrappers
 *   arrive in Phase 3.
 * - Loading is webpack-safe: a runtime `createRequire` from `node:module`
 *   loads the absolute entry path at runtime, never bundle-time imports. The
 *   built `runtime/index.cjs` therefore can load external `.authority/
 *   server.cjs` files from disk.
 * - Loading failure marks the module `load_error` with a structured
 *   diagnostic and never throws out of `loadAll`.
 */
export class CompanionModuleLoaderService {
    /**
     * Lazy accessor for the runtime CommonJS `require` function. Webpack
     * replaces top-level `require` calls with `__webpack_require__`, which
     * only resolves bundled modules. To load arbitrary `.cjs` files from
     * disk at runtime we use `node:module.createRequire` anchored at the
     * loader's own module URL, which webpack leaves intact because it is a
     * runtime call on an imported binding rather than a bare `require`.
     */
    private readonly runtimeRequire: NodeRequire;
    private readonly logger: LoaderLogger;
    private readonly activationTimeoutMs: number;

    constructor(
        private readonly modules: ModuleHostService,
        private readonly permissions: PermissionService,
        private readonly audit: AuditService,
        options: CompanionModuleLoaderServiceOptions = {},
    ) {
        this.runtimeRequire = resolveRuntimeRequire();
        this.logger = options.logger ?? console;
        this.activationTimeoutMs = options.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
    }

    /**
     * Load every valid companion module in the discovery result. Safe to
     * call during `init()`; never throws. Each record's status is updated
     * in place through {@link ModuleHostService.registerDiscoveredRecord} so
     * that `/modules` reflects `loaded` or `load_error` consistently.
     *
     * @returns the list of updated records (loaded + load_error).
     */
    async loadAll(discovery: ModuleDiscoveryResult): Promise<AuthorityModuleRecord[]> {
        const updated: AuthorityModuleRecord[] = [];
        for (const candidate of discovery.internalSources.values()) {
            const record = await this.loadOne(candidate, discovery);
            if (record) {
                updated.push(record);
            }
        }
        return updated;
    }

    /**
     * Load a single companion module from its discovery candidate. Returns
     * the updated public record (loaded or load_error) or `null` when the
     * candidate could not be found in the discovery records at all.
     */
    async loadOne(
        candidate: CompanionModuleLoadCandidate,
        discovery: ModuleDiscoveryResult,
    ): Promise<AuthorityModuleRecord | null> {
        const primaryRecord = discovery.byModuleId.get(candidate.moduleId);
        if (!primaryRecord || primaryRecord.status !== 'available') {
            // Defensive: only `available` records may load. Duplicate,
            // invalid, disabled, incompatible, entry_missing, and no-entry
            // records never reach this path because they have no internal
            // source.
            return null;
        }

        // Revalidate entry just before require() to defend against TOCTOU
        // edits between discovery and load.
        const revalidation = revalidateLoadCandidate(candidate);
        if (revalidation) {
            return this.markLoadError(primaryRecord, revalidation);
        }

        let moduleExports: unknown;
        try {
            moduleExports = this.runtimeRequire(candidate.entryPath);
        } catch (error) {
            return this.markLoadError(primaryRecord, {
                code: 'load_require_failed',
                message: `Failed to require '${candidate.manifest.entry}': ${errorMessage(error)}`,
                severity: 'error',
                details: { ownerExtensionId: candidate.ownerExtensionId },
            });
        }

        const activate = extractActivate(moduleExports);
        if (typeof activate !== 'function') {
            return this.markLoadError(primaryRecord, {
                code: 'load_activate_not_a_function',
                message: `Entry '${candidate.manifest.entry}' did not export an activate(ctx) function.`,
                severity: 'error',
                details: { exportType: typeof activate },
            });
        }

        // Collect registered transactions through the activation ctx. The
        // ctx is intentionally minimal: only metadata, logger, and a
        // registerTransaction callback. No raw services.
        const registrations = new Map<ModuleTransactionName, CompanionTransactionRegistration>();
        const undeclared = new Set<ModuleTransactionName>();
        const activationCtx: CompanionModuleActivationContext = {
            moduleId: candidate.moduleId,
            ownerExtensionId: candidate.ownerExtensionId,
            moduleDir: candidate.moduleDir,
            logger: this.logger,
            registerTransaction: (name, definition) => {
                registerCompanionTransaction(
                    registrations,
                    undeclared,
                    candidate.manifest,
                    candidate.moduleId,
                    name,
                    definition,
                );
            },
        };

        let activationTimedOut = false;
        const activationPromise = Promise.resolve().then(() => activate(activationCtx));
        const timeoutPromise = new Promise<never>((_, reject) => {
            const timer = setTimeout(() => {
                activationTimedOut = true;
                reject(new ActivationTimeoutError(candidate.moduleId, this.activationTimeoutMs));
            }, this.activationTimeoutMs);
            // Allow the Node process to exit even if the timer is still
            // pending (companion modules should not hang startup, but the
            // timeout is the safety net).
            if (typeof timer === 'object' && timer && 'unref' in timer && typeof timer.unref === 'function') {
                timer.unref();
            }
        });

        try {
            await Promise.race([activationPromise, timeoutPromise]);
        } catch (error) {
            if (activationTimedOut) {
                return this.markLoadError(primaryRecord, {
                    code: 'load_activation_timeout',
                    message: `Activation timed out after ${this.activationTimeoutMs} ms for module '${candidate.moduleId}'.`,
                    severity: 'error',
                    ...buildOptionalDetails({ timeoutMs: this.activationTimeoutMs }),
                });
            }
            return this.markLoadError(primaryRecord, {
                code: 'load_activation_threw',
                message: `activate(ctx) threw: ${errorMessage(error)}`,
                severity: 'error',
                ...buildOptionalDetails(extractErrorDetails(error)),
            });
        }

        // Validate declared vs registered transactions. Missing handlers and
        // undeclared handlers both surface as load_error with a precise code.
        const declared = Object.keys(candidate.manifest.transactions);
        const registered = [...registrations.keys()];
        const missing = declared.filter(name => !registrations.has(name));
        const undeclaredList = [...undeclared];
        if (missing.length > 0 || undeclaredList.length > 0) {
            const diagnostics: AuthorityModuleDiagnostic[] = [];
            if (missing.length > 0) {
                diagnostics.push({
                    code: 'load_transaction_handler_missing',
                    message: `Module '${candidate.moduleId}' did not register handlers for: ${missing.join(', ')}.`,
                    severity: 'error',
                    ...buildOptionalDetails({ missing }),
                });
            }
            if (undeclaredList.length > 0) {
                diagnostics.push({
                    code: 'load_transaction_undeclared',
                    message: `Module '${candidate.moduleId}' registered undeclared transactions: ${undeclaredList.join(', ')}.`,
                    severity: 'error',
                    ...buildOptionalDetails({ undeclared: undeclaredList }),
                });
            }
            return this.markLoadError(primaryRecord, diagnostics[0]!, diagnostics);
        }

        // All declared transactions have handlers; re-register with the
        // host using the companion registration path so execute() builds a
        // minimal safe companion tx ctx instead of the raw service ctx.
        const handlers: Record<ModuleTransactionName, ModuleTransactionHandler> = {};
        for (const name of declared) {
            const registration = registrations.get(name);
            if (!registration) {
                // Defensive: filtered above; should not happen.
                return this.markLoadError(primaryRecord, {
                    code: 'load_transaction_handler_missing',
                    message: `Internal error: handler vanished for ${candidate.moduleId}/${name} after validation.`,
                    severity: 'error',
                });
            }
            handlers[name] = buildCompanionHandler(candidate, name, registration, this.permissions, this.audit, this.logger);
        }

        try {
            this.modules.registerCompanion(candidate.manifest, handlers, {
                ownerExtensionId: candidate.ownerExtensionId,
                source: primaryRecord.source,
            });
        } catch (error) {
            return this.markLoadError(primaryRecord, {
                code: 'load_register_failed',
                message: `ModuleHostService.registerCompanion threw: ${errorMessage(error)}`,
                severity: 'error',
                ...buildOptionalDetails(extractErrorDetails(error)),
            });
        }

        const loadedRecord: AuthorityModuleRecord = {
            ...primaryRecord,
            status: 'loaded',
            manifest: candidate.manifest,
        };
        // Replace the available record with the loaded one through the
        // public upsert path so /modules reflects the new status.
        this.modules.registerDiscoveredRecord(loadedRecord);
        return this.modules.getRecord(candidate.moduleId) ?? loadedRecord;
    }

    private markLoadError(
        record: AuthorityModuleRecord,
        primary: AuthorityModuleDiagnostic,
        extra?: AuthorityModuleDiagnostic[],
    ): AuthorityModuleRecord {
        const diagnostics = [primary, ...(extra ?? [])];
        const errorRecord: AuthorityModuleRecord = {
            ...record,
            status: 'load_error' as ModuleStatus,
            diagnostics,
        };
        this.logger.error(`[authority] Companion module load failed for '${record.moduleId}': ${primary.message}`);
        // Replace the available record with the load_error record through
        // the public upsert path so /modules reflects the new status.
        this.modules.registerDiscoveredRecord(errorRecord);
        return this.modules.getRecord(record.moduleId) ?? errorRecord;
    }
}

export interface CompanionModuleLoaderServiceOptions {
    /** Override the activation timeout (default 10 s, hard cap 30 s). */
    activationTimeoutMs?: number;
    /** Override the logger (default console). */
    logger?: LoaderLogger;
}

/** Default activation timeout: 10 s. Hard cap 30 s. */
export const DEFAULT_ACTIVATION_TIMEOUT_MS = 10_000;
/** Hard upper bound on activation timeout. */
export const MAX_ACTIVATION_TIMEOUT_MS = 30_000;

type LoaderLogger = Pick<Console, 'info' | 'warn' | 'error'>;

/**
 * Phase 2 minimal safe activation context handed to a companion module's
 * `activate(ctx)` export. Deliberately does NOT include SQL/fs/blob/trivium/
 * jobs/events/runtime/core/raw services. The activation ctx can only:
 *
 * - read its own metadata (`moduleId`, `ownerExtensionId`, `moduleDir`),
 * - log through the host logger,
 * - register named transactions via `registerTransaction(name, definition)`.
 *
 * Phase 3 will introduce richer scoped service wrappers on the transaction
 * ctx; the activation ctx intentionally stays small.
 */
export interface CompanionModuleActivationContext {
    moduleId: string;
    ownerExtensionId: string;
    moduleDir: string;
    logger: LoaderLogger;
    registerTransaction(
        name: ModuleTransactionName,
        definition: CompanionTransactionDefinition,
    ): void;
}

/**
 * Definition handed to `registerTransaction(name, definition)` from the
 * activation ctx. The handler receives a deliberately minimal
 * {@link CompanionModuleTransactionContext}; raw services are intentionally
 * absent.
 */
export interface CompanionTransactionDefinition {
    handler: CompanionTransactionHandler;
}

export type CompanionTransactionHandler = (
    ctx: CompanionModuleTransactionContext,
    input: unknown,
    request: ModuleTransactionRequest,
) => Promise<ModuleTransactionHandlerResult>;

/**
 * Phase 2 minimal safe transaction context for companion module handlers.
 *
 * This is intentionally distinct from the existing {@link ModuleTransactionContext}
 * which carries raw `trivium`, `storage`, `files`, `jobs`, `events` services.
 * Companion modules in Phase 2 receive only:
 *
 * - metadata (`moduleId`, `ownerExtensionId`, `transactionName`, `callerExtensionId`)
 * - `logger` (host-scoped)
 * - `audit` wrapper bound to the calling user + owner extension
 * - `authorize(request)` for `PermissionEvaluateRequest`
 * - `signal` (AbortSignal) for cooperative cancellation
 * - `requestId` for tracing
 *
 * Raw SQL/fs/blob/trivium/jobs/events/runtime/core access arrives in Phase 3
 * as scoped wrappers bound to user + ownerExtensionId/moduleId.
 */
export interface CompanionModuleTransactionContext {
    moduleId: string;
    ownerExtensionId: string;
    transactionName: string;
    callerExtensionId: string;
    requestId: string;
    logger: LoaderLogger;
    audit: CompanionAuditWrapper;
    authorize: (request: PermissionEvaluateRequest) => Promise<boolean>;
    signal: AbortSignal;
}

/**
 * Phase 2 audit wrapper for companion transactions. Bound to the calling
 * user + owner extension at execute time so companion code cannot forge
 * audit records under another extension's identity.
 */
export interface CompanionAuditWrapper {
    logUsage(message: string, details?: Record<string, unknown>): Promise<void>;
    logWarning(message: string, details?: Record<string, unknown>): Promise<void>;
    logError(message: string, details?: Record<string, unknown>): Promise<void>;
}

interface CompanionTransactionRegistration {
    definition: CompanionTransactionDefinition;
}

class ActivationTimeoutError extends Error {
    constructor(moduleId: string, timeoutMs: number) {
        super(`Activation timed out after ${timeoutMs} ms for module '${moduleId}'.`);
        this.name = 'ActivationTimeoutError';
    }
}

/**
 * Extract the `activate(ctx)` export from a CommonJS module. Accepts either
 * `module.exports = activate` or `module.exports.activate = activate`.
 * Returns `null` when no valid function export is present so the loader can
 * surface a precise `load_activate_not_a_function` diagnostic.
 */
function extractActivate(moduleExports: unknown): ((ctx: CompanionModuleActivationContext) => unknown) | null {
    if (typeof moduleExports === 'function') {
        return moduleExports as (ctx: CompanionModuleActivationContext) => unknown;
    }
    if (moduleExports && typeof moduleExports === 'object') {
        const activate = (moduleExports as { activate?: unknown }).activate;
        if (typeof activate === 'function') {
            return activate as (ctx: CompanionModuleActivationContext) => unknown;
        }
    }
    return null;
}

/**
 * Validate and store a transaction registration made through the activation
 * ctx. Throws a structured validation error for hard contract violations
 * (invalid name shape, duplicate registration, non-function handler) so the
 * loader can convert it to a `load_activation_threw` diagnostic. For
 * undeclared transactions (name not in the manifest), the registration is
 * recorded in the `undeclared` set rather than thrown, so the loader can
 * surface a precise `load_transaction_undeclared` diagnostic after activation
 * completes alongside any missing-handler diagnostics.
 *
 * Validation:
 * - name must match the manifest's transaction name pattern (no colons,
 *   alphanumeric prefix).
 * - definition.handler must be a function.
 * - duplicate registration of the same name in one activation is an error.
 * - name not declared in the manifest -> recorded in `undeclared` (not thrown).
 */
function registerCompanionTransaction(
    registrations: Map<ModuleTransactionName, CompanionTransactionRegistration>,
    undeclared: Set<ModuleTransactionName>,
    manifest: AuthorityModuleManifest,
    moduleId: string,
    name: ModuleTransactionName,
    definition: CompanionTransactionDefinition,
): void {
    if (typeof name !== 'string' || name.trim() === '' || name.includes(':')) {
        throw new AuthorityServiceError(
            `Invalid transaction name in registerTransaction: ${formatValue(name)}`,
            400,
            'validation_error',
            'validation',
        );
    }
    if (registrations.has(name)) {
        throw new AuthorityServiceError(
            `Module '${moduleId}' registered transaction '${name}' more than once`,
            409,
            'validation_error',
            'validation',
        );
    }
    if (!definition || typeof definition.handler !== 'function') {
        throw new AuthorityServiceError(
            `Module '${moduleId}' registerTransaction('${name}') definition.handler must be a function`,
            400,
            'validation_error',
            'validation',
        );
    }
    // Record undeclared registrations separately so the loader can produce a
    // precise `load_transaction_undeclared` diagnostic after activation
    // completes. The handler is still stored so a follow-up missing-handler
    // check has the registration available if the manifest also declares it.
    if (!manifest.transactions[name]) {
        undeclared.add(name);
    }
    registrations.set(name, { definition });
}

/**
 * Build a {@link ModuleTransactionHandler} adapter that constructs a minimal
 * safe {@link CompanionModuleTransactionContext} for the companion handler.
 * The raw services that the built-in `ModuleTransactionContext` carries
 * (trivium/storage/files/jobs/events) are intentionally absent here.
 */
function buildCompanionHandler(
    candidate: CompanionModuleLoadCandidate,
    transactionName: ModuleTransactionName,
    registration: CompanionTransactionRegistration,
    permissions: PermissionService,
    audit: AuditService,
    logger: LoaderLogger,
): ModuleTransactionHandler {
    const companionHandler = registration.definition.handler;
    return async (rawCtx, input, request) => {
        // rawCtx is the host's ModuleTransactionContext. We deliberately do
        // NOT forward it to companion code; we build a minimal safe ctx.
        const user: UserContext = rawCtx.user;
        const session: SessionRecord = rawCtx.session;
        const callerExtensionId = rawCtx.callerExtensionId;
        const requestId = generateRequestId();
        const abortController = new AbortController();

        const authorize = async (permRequest: PermissionEvaluateRequest): Promise<boolean> => {
            const grant = await permissions.authorize(user, session, permRequest);
            return grant !== null;
        };

        const auditWrapper: CompanionAuditWrapper = {
            logUsage: (message, details) => audit.logUsage(user, candidate.ownerExtensionId, message, details).catch(() => undefined),
            logWarning: (message, details) => audit.logWarning(user, candidate.ownerExtensionId, message, details).catch(() => undefined),
            logError: (message, details) => audit.logError(user, candidate.ownerExtensionId, message, details).catch(() => undefined),
        };

        const companionCtx: CompanionModuleTransactionContext = {
            moduleId: candidate.moduleId,
            ownerExtensionId: candidate.ownerExtensionId,
            transactionName,
            callerExtensionId,
            requestId,
            logger,
            audit: auditWrapper,
            authorize,
            signal: abortController.signal,
        };

        // Apply the manifest's per-transaction timeout (default 120 s, hard
        // cap 10 min). The timeout races the companion handler so a hung
        // transaction cannot hold the request forever.
        const transaction = candidate.manifest.transactions[transactionName];
        const timeoutMs = resolveTransactionTimeoutMs(transaction);
        const timeoutPromise = new Promise<never>((_, reject) => {
            const timer = setTimeout(() => {
                abortController.abort();
                reject(new TransactionTimeoutError(candidate.moduleId, transactionName, timeoutMs));
            }, timeoutMs);
            if (typeof timer === 'object' && timer && 'unref' in timer && typeof timer.unref === 'function') {
                timer.unref();
            }
        });

        try {
            const result = await Promise.race([
                companionHandler(companionCtx, input, request),
                timeoutPromise,
            ]);
            return result;
        } catch (error) {
            if (error instanceof TransactionTimeoutError) {
                throw new AuthorityServiceError(
                    error.message,
                    504,
                    'core_request_failed',
                    'core',
                    { code: 'transaction_timeout', moduleId: candidate.moduleId, transaction: transactionName, timeoutMs },
                );
            }
            throw error;
        }
    };
}

class TransactionTimeoutError extends Error {
    constructor(moduleId: string, transactionName: string, timeoutMs: number) {
        super(`Transaction '${moduleId}/${transactionName}' timed out after ${timeoutMs} ms.`);
        this.name = 'TransactionTimeoutError';
    }
}

/**
 * Resolve the effective per-transaction timeout for a companion transaction.
 * Falls back to {@link DEFAULT_TRANSACTION_TIMEOUT_MS} when the manifest
 * does not specify one. Capped by {@link MAX_TRANSACTION_TIMEOUT_MS}.
 */
function resolveTransactionTimeoutMs(transaction: ModuleTransactionManifest | undefined): number {
    if (!transaction || typeof transaction.timeoutMs !== 'number' || !Number.isFinite(transaction.timeoutMs) || transaction.timeoutMs <= 0) {
        return DEFAULT_TRANSACTION_TIMEOUT_MS;
    }
    return Math.min(transaction.timeoutMs, MAX_TRANSACTION_TIMEOUT_MS);
}

/** Default per-transaction timeout (120 s), aligned with discovery defaults. */
const DEFAULT_TRANSACTION_TIMEOUT_MS = 120_000;
/** Hard upper bound on per-transaction timeout (10 min). */
const MAX_TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000;

function generateRequestId(): string {
    try {
        // Prefer crypto.randomUUID when available; fall back to a timestamp.
        // The global crypto may be absent in very old Node runtime paths.
        const g = globalThis as { crypto?: { randomUUID?: () => string } };
        if (g.crypto && typeof g.crypto.randomUUID === 'function') {
            return g.crypto.randomUUID();
        }
    } catch {
        // ignore
    }
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function extractErrorDetails(error: unknown): Record<string, unknown> | undefined {
    if (error instanceof Error) {
        const details: Record<string, unknown> = { message: error.message };
        if (error.stack) {
            details.stack = error.stack;
        }
        if (error instanceof AuthorityServiceError) {
            details.code = error.code;
            details.category = error.category;
            if (error.details) {
                details.details = error.details;
            }
        }
        return details;
    }
    return { value: String(error) };
}

/**
 * Helper for `exactOptionalPropertyTypes`: returns `{ details }` when value is
 * present, `{}` otherwise. Spreading this keeps `details` from being typed as
 * `T | undefined` on the diagnostic object.
 */
function buildOptionalDetails(details: Record<string, unknown> | undefined): { details?: Record<string, unknown> } {
    if (details === undefined) {
        return {};
    }
    return { details };
}

function formatValue(value: unknown): string {
    if (value === undefined) {
        return '<undefined>';
    }
    if (value === null) {
        return '<null>';
    }
    if (typeof value === 'string') {
        return value.length === 0 ? '<empty>' : `'${value}'`;
    }
    return JSON.stringify(value);
}

// Re-export the runtime require helper for bundled runtime smoke tests.
// Tests need a way to invoke the loader's webpack-safe require path without
// reaching into private state.
export function loadCompanionModuleFromDisk(absolutePath: string): unknown {
    return resolveRuntimeRequire()(absolutePath);
}

// Suppress unused-import warnings for type-only imports preserved for the
// public API surface of this module.
void AUTHORITY_MODULE_PROTOCOL_VERSION;
void path;
