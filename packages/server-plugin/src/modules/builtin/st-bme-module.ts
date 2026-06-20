import type {
    AuthorityModuleManifest,
    BmeVectorApplyRequest,
    BmeVectorApplyResponse,
    BmeVectorManifestRequest,
    BmeVectorManifestResponse,
    ModuleTransactionManifest,
    ModuleTransactionName,
    ModuleTransactionRequiredResource,
} from '@stdo/shared-types';
import { AUTHORITY_MODULE_PROTOCOL_VERSION } from '../../constants.js';
import type {
    ModuleHostService,
    ModuleTransactionContext,
    ModuleTransactionHandler,
    ModuleTransactionRequiredResourceResolver,
} from '../../services/module-host-service.js';
import type { TriviumService } from '../../services/trivium-service.js';
import { AUTHORITY_VERSION } from '../../version.js';

/**
 * Built-in `st-bme` module.
 *
 * Phase 2 wires the existing BME vector manifest/apply operations into the
 * authority module host without expanding {@link AuthorityFeatureFlags.bme}.
 * The legacy `/bme/vector-*` HTTP routes continue to require only
 * `trivium.private` for backwards compatibility with existing ST-BME clients
 * that may not yet declare `modules.execute`; they reuse the same normalized
 * payload helpers and trivium calls as the module handlers so the two paths
 * cannot drift.
 */

export const ST_BME_MODULE_ID = 'st-bme';

export const ST_BME_MODULE_VERSION = AUTHORITY_VERSION;

export const ST_BME_TRANSACTION_MANIFEST: ModuleTransactionName = 'vector.manifest';
export const ST_BME_TRANSACTION_APPLY: ModuleTransactionName = 'vector.apply';

const MANIFEST_REASON = 'BME vector manifest target database';
const APPLY_REASON = 'BME vector apply target database';

/**
 * Normalize a BME database name the same way the trivium service does so the
 * module host, dynamic required-resource resolvers, and legacy HTTP routes all
 * agree on the permission target before invoking the trivium handler.
 */
export function normalizeBmeDatabase(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

/**
 * Clone the manifest request payload with a normalized `database`. The trivium
 * service re-normalizes internally, but we patch the payload so authorization
 * target resolution and the trivium call see the same value.
 */
export function buildBmeManifestPayload(input: unknown): BmeVectorManifestRequest {
    const raw = (input ?? {}) as BmeVectorManifestRequest;
    return { database: normalizeBmeDatabase(raw.database) };
}

/**
 * Clone the apply request payload with a normalized `database`. Preserves all
 * caller-provided fields (items, links, vectorSpaceId, etc.) so the only
 * difference from the input is the patched `database` value.
 */
export function buildBmeApplyPayload(input: unknown): BmeVectorApplyRequest {
    const raw = (input ?? {}) as BmeVectorApplyRequest;
    return { ...raw, database: normalizeBmeDatabase(raw.database) };
}

/**
 * Shared trivium call used by both the module transaction handler and the
 * legacy `/bme/vector-manifest` HTTP route so the two paths cannot diverge.
 */
export async function executeBmeVectorManifest(
    trivium: TriviumService,
    user: { handle: string; isAdmin: boolean; rootDir: string },
    callerExtensionId: string,
    input: unknown,
): Promise<BmeVectorManifestResponse> {
    return await trivium.getBmeVectorManifest(user, callerExtensionId, buildBmeManifestPayload(input));
}

/**
 * Shared trivium call used by both the module transaction handler and the
 * legacy `/bme/vector-apply` HTTP route so the two paths cannot diverge.
 */
export async function executeBmeVectorApply(
    trivium: TriviumService,
    user: { handle: string; isAdmin: boolean; rootDir: string },
    callerExtensionId: string,
    input: unknown,
): Promise<BmeVectorApplyResponse> {
    return await trivium.applyBmeVectorManifest(user, callerExtensionId, buildBmeApplyPayload(input));
}

/**
 * Dynamic required-resource resolver for `vector.manifest`. Resolves to a
 * single `trivium.private` target derived from the (normalized) input
 * `database`, defaulting to `default`.
 */
export const resolveBmeManifestRequiredResources: ModuleTransactionRequiredResourceResolver = (input): ModuleTransactionRequiredResource[] => {
    const target = normalizeBmeDatabase((input as { database?: unknown } | null)?.database);
    return [{ resource: 'trivium.private', target, reason: MANIFEST_REASON }];
};

/**
 * Dynamic required-resource resolver for `vector.apply`. Resolves to a single
 * `trivium.private` target derived from the (normalized) input `database`,
 * defaulting to `default`.
 */
export const resolveBmeApplyRequiredResources: ModuleTransactionRequiredResourceResolver = (input): ModuleTransactionRequiredResource[] => {
    const target = normalizeBmeDatabase((input as { database?: unknown } | null)?.database);
    return [{ resource: 'trivium.private', target, reason: APPLY_REASON }];
};

const manifestTransaction: ModuleTransactionManifest = {
    name: ST_BME_TRANSACTION_MANIFEST,
    version: '1.0.0',
    title: 'BME vector manifest',
    description: 'Reads the BME vector manifest for a private trivium database.',
    riskLevel: 'low',
    permissionTarget: { kind: 'transaction' },
    requiredResources: [],
    idempotency: 'none',
};

const applyTransaction: ModuleTransactionManifest = {
    name: ST_BME_TRANSACTION_APPLY,
    version: '1.0.0',
    title: 'BME vector apply',
    description: 'Applies a BME vector manifest batch to a private trivium database.',
    riskLevel: 'high',
    permissionTarget: { kind: 'transaction' },
    requiredResources: [],
    idempotency: 'optional',
};

/**
 * Build the public manifest for the built-in `st-bme` module. The manifest is
 * JSON-serializable so it can be returned verbatim from `listManifests()` and
 * `getManifest()`; dynamic resolvers stay server-side only.
 */
export function buildStBmeModuleManifest(): AuthorityModuleManifest {
    return {
        id: ST_BME_MODULE_ID,
        displayName: 'ST-BME',
        version: ST_BME_MODULE_VERSION,
        description: 'Built-in authority module exposing BME vector manifest and apply transactions.',
        protocolVersion: AUTHORITY_MODULE_PROTOCOL_VERSION,
        transactions: {
            [ST_BME_TRANSACTION_MANIFEST]: manifestTransaction,
            [ST_BME_TRANSACTION_APPLY]: applyTransaction,
        },
    };
}

const bmeVectorManifestHandler: ModuleTransactionHandler = async (ctx, input) => {
    const result = await executeBmeVectorManifest(ctx.trivium, ctx.user, ctx.callerExtensionId, input);
    return { result };
};

const bmeVectorApplyHandler: ModuleTransactionHandler = async (ctx, input) => {
    const result = await executeBmeVectorApply(ctx.trivium, ctx.user, ctx.callerExtensionId, input);
    return { result };
};

/** Handlers for the built-in `st-bme` module, keyed by transaction name. */
export const stBmeModuleHandlers: Record<ModuleTransactionName, ModuleTransactionHandler> = {
    [ST_BME_TRANSACTION_MANIFEST]: bmeVectorManifestHandler,
    [ST_BME_TRANSACTION_APPLY]: bmeVectorApplyHandler,
};

/** Dynamic required-resource resolvers for the built-in `st-bme` module. */
export const stBmeModuleRequiredResourceResolvers: Partial<Record<ModuleTransactionName, ModuleTransactionRequiredResourceResolver>> = {
    [ST_BME_TRANSACTION_MANIFEST]: resolveBmeManifestRequiredResources,
    [ST_BME_TRANSACTION_APPLY]: resolveBmeApplyRequiredResources,
};

/**
 * Register the built-in `st-bme` module with the authority module host. Called
 * once during {@link createAuthorityRuntime} after the host has been
 * constructed.
 */
export function registerStBmeModule(modules: ModuleHostService): void {
    modules.register(
        buildStBmeModuleManifest(),
        stBmeModuleHandlers,
        { requiredResourceResolvers: stBmeModuleRequiredResourceResolvers },
    );
}
