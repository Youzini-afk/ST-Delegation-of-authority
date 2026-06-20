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
 */

/** Module identifier. Lowercase, dotted segments allowed (e.g. `st-bme`). */
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
}

/** Manifest describing an authority module. */
export interface AuthorityModuleManifest {
    id: ModuleId;
    displayName: string;
    version: string;
    description?: string;
    protocolVersion: number;
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

/** Response payload for listing registered modules. */
export interface ModuleListResponse {
    modules: AuthorityModuleManifest[];
    count: number;
}

/** Response payload for fetching a single module manifest. */
export interface ModuleGetResponse {
    module: AuthorityModuleManifest;
}
