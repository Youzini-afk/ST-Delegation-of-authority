import fs from 'node:fs';
import path from 'node:path';
import type {
    AuthorityModuleDiagnostic,
    AuthorityModuleManifest,
    AuthorityModuleRecord,
    AuthorityModuleRecordSource,
    ModuleStatus,
    ModuleTransactionIdempotency,
    ModuleTransactionManifest,
    ModuleTransactionName,
    ModuleTransactionPermissionTarget,
    ModuleTransactionRequiredResource,
} from '@stdo/shared-types';
import { AUTHORITY_MODULE_PROTOCOL_VERSION } from '../constants.js';
import type { InstallService } from './install-service.js';

/**
 * Authority companion module discovery service.
 *
 * Phase 1 scope: scan installed SillyTavern extensions for
 * `.authority/module.json`, validate the manifest shape, schema, protocol
 * version, module id, transaction names, required resources, idempotency,
 * realistic inline byte limits, owner-extension identity, and entry path
 * containment; produce {@link AuthorityModuleRecord}s that the
 * {@link ModuleHostService} can surface through `/modules` without loading
 * any companion `server.cjs`.
 *
 * This service never executes companion code. It does not follow symlinks,
 * does not recurse into nested directories, and skips `node_modules`, `dist`,
 * `.git`, `target`, and hidden directories other than the exact `.authority`
 * candidate path.
 */

/** Module id pattern, mirroring {@link ModuleHostService}. */
const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Transaction name pattern, mirroring {@link ModuleHostService}. */
const TRANSACTION_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
/** Owner extension id segment pattern (e.g. `third-party/some-extension`). */
const OWNER_EXTENSION_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
/** Manifest schema version accepted by Phase 1. */
const AUTHORITY_MODULE_SCHEMA_VERSION = 1;
/** Default inline request/response byte limit (64 MiB). */
export const MODULE_DEFAULT_REQUEST_BYTES = 64 * 1024 * 1024;
export const MODULE_DEFAULT_RESPONSE_BYTES = 64 * 1024 * 1024;
/**
 * Hard inline transaction byte cap (256 MiB), aligned with
 * {@link UNMANAGED_TRANSFER_MAX_BYTES} and below SillyTavern's 500 MB body
 * parser limit. Larger payloads must use DOA transfer/blob primitives, not
 * inline transaction bodies.
 */
export const MODULE_MAX_REQUEST_BYTES = 256 * 1024 * 1024;
export const MODULE_MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
/** Default per-transaction timeout (120 s). */
export const MODULE_DEFAULT_TIMEOUT_MS = 120_000;
/** Hard upper bound on per-transaction timeout (10 min). */
export const MODULE_MAX_TIMEOUT_MS = 10 * 60 * 1000;

const SKIP_DIRECTORY_NAMES = new Set([
    'node_modules',
    'dist',
    '.git',
    'target',
]);

const SUPPORTED_RISK_LEVELS = new Set(['low', 'medium', 'high']);
const SUPPORTED_IDEMPOTENCY = new Set<ModuleTransactionIdempotency>(['none', 'optional', 'required']);
const SUPPORTED_PERMISSION_TARGET_KINDS = new Set(['module', 'transaction', 'custom']);

type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

export interface ModuleDiscoveryResult {
    records: AuthorityModuleRecord[];
    /** Records keyed by module id. Later duplicates are not present here. */
    byModuleId: Map<string, AuthorityModuleRecord>;
    /**
     * Server-only internal source metadata keyed by module id. Carries
     * absolute filesystem paths for valid `available` records so that the
     * Phase 2 companion loader can `require()` the entry without re-resolving
     * paths. This map is intentionally NOT exposed through public shared
     * types or `/modules` JSON; only the loader consumes it.
     */
    internalSources: Map<string, CompanionModuleLoadCandidate>;
}

/**
 * Server-only load candidate for a discovered companion module.
 *
 * Phase 2 keeps absolute filesystem paths here, separate from the public
 * {@link AuthorityModuleRecordSource} shape so that `/modules` responses
 * cannot leak the host filesystem layout to SDK callers or frontend
 * extensions. Only valid `available` records (manifest + entry + revalidated
 * paths) appear here; invalid/duplicate/disabled records never reach the
 * loader.
 */
export interface CompanionModuleLoadCandidate {
    moduleId: string;
    ownerExtensionId: string;
    extensionDir: string;
    moduleDir: string;
    manifestPath: string;
    entryPath: string;
    manifest: AuthorityModuleManifest;
}

export interface ModuleDiscoveryServiceOptions {
    /** Override the resolved SillyTavern root (used by tests). */
    sillyTavernRoot?: string;
    /** Override the candidate extension directories (used by tests). */
    extensionDirs?: string[];
    logger?: Logger;
}

export class ModuleDiscoveryService {
    private readonly logger: Logger;
    private readonly sillyTavernRootOverride: string | undefined;
    private readonly extensionDirsOverride: string[] | undefined;

    constructor(
        private readonly install: InstallService,
        options: ModuleDiscoveryServiceOptions = {},
    ) {
        this.logger = options.logger ?? console;
        this.sillyTavernRootOverride = options.sillyTavernRoot;
        this.extensionDirsOverride = options.extensionDirs;
    }

    /**
     * Discover all companion module records under the resolved SillyTavern
     * extension directories. Discovery never throws on a per-module failure;
     * failures are recorded as diagnostics on the returned records. A throw
     * here only signals that the SillyTavern root itself could not be
     * resolved, in which case the caller should treat discovery as a no-op.
     */
    discover(): ModuleDiscoveryResult {
        const sillyTavernRoot = this.resolveSillyTavernRoot();
        if (!sillyTavernRoot) {
            return { records: [], byModuleId: new Map(), internalSources: new Map() };
        }

        const extensionDirs = this.resolveExtensionDirs(sillyTavernRoot);
        const records: AuthorityModuleRecord[] = [];
        const byModuleId = new Map<string, AuthorityModuleRecord>();
        const internalSources = new Map<string, CompanionModuleLoadCandidate>();

        for (const { extensionId, extensionDir } of extensionDirs) {
            const moduleDir = path.join(extensionDir, '.authority');
            const manifestPath = path.join(moduleDir, 'module.json');

            // Skip silently when there is no module.json at all. When the path
            // exists but is a symlink (or otherwise not a regular file), fall
            // through to discoverRecord so the failure is recorded as a
            // diagnostic on a record rather than silently dropped.
            const manifestExists = pathExistsAny(manifestPath);
            if (!manifestExists) {
                continue;
            }

            const record = this.discoverRecord(extensionId, extensionDir, moduleDir, manifestPath);
            records.push(record);

            if (record.manifest && (record.status === 'available' || record.status === 'loaded')) {
                const existing = byModuleId.get(record.moduleId);
                if (existing && existing.manifest && (existing.status === 'available' || existing.status === 'loaded')) {
                    // First valid record wins; later duplicate becomes a non-executable duplicate.
                    records[records.length - 1] = markDuplicate(record, existing);
                } else {
                    byModuleId.set(record.moduleId, record);
                    // Only the winning record contributes an internal load
                    // candidate. The candidate requires an entry; manifests
                    // without an entry surface as available-but-unloadable
                    // and intentionally have no candidate.
                    const candidate = this.buildLoadCandidate(extensionDir, moduleDir, manifestPath, record);
                    if (candidate) {
                        internalSources.set(record.moduleId, candidate);
                    }
                }
            }
        }

        return { records, byModuleId, internalSources };
    }

    /**
     * Build a server-only {@link CompanionModuleLoadCandidate} for a valid
     * `available` record. Returns `null` when the record has no manifest
     * entry (Phase 1 allows manifests without an entry; Phase 2 simply does
     * not load them) or when the entry path cannot be revalidated.
     */
    private buildLoadCandidate(
        extensionDir: string,
        moduleDir: string,
        manifestPath: string,
        record: AuthorityModuleRecord,
    ): CompanionModuleLoadCandidate | null {
        if (!record.manifest || typeof record.manifest.entry !== 'string' || record.manifest.entry.trim() === '') {
            return null;
        }
        const entryPath = path.resolve(moduleDir, record.manifest.entry);
        return {
            moduleId: record.moduleId,
            ownerExtensionId: record.ownerExtensionId,
            extensionDir,
            moduleDir,
            manifestPath,
            entryPath,
            manifest: record.manifest,
        };
    }

    private discoverRecord(
        extensionId: string,
        extensionDir: string,
        moduleDir: string,
        manifestPath: string,
    ): AuthorityModuleRecord {
        // Public source carries only safe relative metadata; absolute paths
        // are kept in local variables for server-side validation only.
        const source: AuthorityModuleRecordSource = {
            extensionId,
            modulePath: '.authority/module.json',
        };

        // Refuse to follow symlinks at the extension, module dir, or manifest
        // file level. lstat-based checks catch all three before any read.
        if (isSymlink(extensionDir) || isSymlink(moduleDir)) {
            return buildRecord(extensionId, null, 'incompatible_host', source, {
                code: 'symlink_extension_ignored',
                message: 'Symlinked extension or .authority directories are ignored.',
                severity: 'warning',
            });
        }
        if (isSymlink(manifestPath)) {
            return buildRecord(extensionId, null, 'incompatible_host', source, {
                code: 'manifest_symlink_rejected',
                message: 'Symlinked .authority/module.json is rejected.',
                severity: 'warning',
            });
        }
        if (!isRegularFileStrict(manifestPath)) {
            return buildRecord(extensionId, null, 'invalid_manifest', source, {
                code: 'manifest_not_a_file',
                message: '.authority/module.json is not a regular file.',
                severity: 'error',
            });
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (error) {
            return buildRecord(extensionId, null, 'invalid_manifest', source, {
                code: 'manifest_json_parse_error',
                message: `Failed to parse module.json: ${errorMessage(error)}`,
                severity: 'error',
            });
        }

        const manifestValidation = validateManifest(parsed, extensionId);
        if (!manifestValidation.ok) {
            // Distinguish protocol mismatch from generic manifest invalidity so
            // hosts can show "incompatible host" vs "broken manifest".
            const status: ModuleStatus = manifestValidation.incompatibleHost ? 'incompatible_host' : 'invalid_manifest';
            return buildRecord(extensionId, null, status, source, manifestValidation.diagnostic);
        }

        const manifest = manifestValidation.manifest;
        const moduleId = manifest.id;

        // Reflect the manifest-declared entry (relative) on the public source.
        if (typeof manifest.entry === 'string') {
            source.entry = manifest.entry;
        }

        // Validate entry: relative, .cjs only, resolves inside .authority,
        // not a symlink, and realpath stays inside realpath(moduleDir).
        const entryValidation = validateEntry(manifest.entry, moduleDir);
        if (entryValidation.status !== 'available') {
            const record = buildRecord(extensionId, manifest, entryValidation.status, source, entryValidation.diagnostic);
            record.moduleId = moduleId;
            return record;
        }

        const record = buildRecord(extensionId, manifest, 'available', source);
        record.moduleId = moduleId;
        return record;
    }

    private resolveSillyTavernRoot(): string | null {
        if (this.sillyTavernRootOverride !== undefined) {
            return this.sillyTavernRootOverride && isSillyTavernRoot(this.sillyTavernRootOverride)
                ? this.sillyTavernRootOverride
                : null;
        }
        return this.install.getSillyTavernRoot();
    }

    private resolveExtensionDirs(sillyTavernRoot: string): Array<{ extensionId: string; extensionDir: string }> {
        if (this.extensionDirsOverride !== undefined) {
            return this.extensionDirsOverride.map(extensionDir => ({
                extensionId: deriveExtensionId(sillyTavernRoot, extensionDir),
                extensionDir,
            }));
        }

        const dirs: Array<{ extensionId: string; extensionDir: string }> = [];
        const extensionsRoot = path.join(sillyTavernRoot, 'public', 'scripts', 'extensions');
        const thirdPartyRoot = path.join(extensionsRoot, 'third-party');

        // Direct extension dirs: <extensionsRoot>/<name>
        if (fs.existsSync(extensionsRoot)) {
            for (const entry of listDirectoryEntries(extensionsRoot)) {
                if (!entry.isDirectory() || entry.name === 'third-party') {
                    continue;
                }
                if (SKIP_DIRECTORY_NAMES.has(entry.name) || isHiddenName(entry.name)) {
                    continue;
                }
                const extensionDir = path.join(extensionsRoot, entry.name);
                if (isSymlink(extensionDir)) {
                    continue;
                }
                dirs.push({ extensionId: entry.name, extensionDir });
            }
        }

        // Third-party extensions: <extensionsRoot>/third-party/<name>
        if (fs.existsSync(thirdPartyRoot)) {
            for (const entry of listDirectoryEntries(thirdPartyRoot)) {
                if (!entry.isDirectory()) {
                    continue;
                }
                if (SKIP_DIRECTORY_NAMES.has(entry.name) || isHiddenName(entry.name)) {
                    continue;
                }
                const extensionDir = path.join(thirdPartyRoot, entry.name);
                if (isSymlink(extensionDir)) {
                    continue;
                }
                dirs.push({ extensionId: `third-party/${entry.name}`, extensionDir });
            }
        }

        return dirs;
    }
}

interface ManifestValidationOk {
    ok: true;
    manifest: AuthorityModuleManifest;
}
interface ManifestValidationFail {
    ok: false;
    incompatibleHost: boolean;
    diagnostic: AuthorityModuleDiagnostic;
}
type ManifestValidation = ManifestValidationOk | ManifestValidationFail;

function validateManifest(parsed: unknown, ownerExtensionId: string): ManifestValidation {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail('manifest_shape_invalid', 'module.json must be a JSON object.', false);
    }

    const raw = parsed as Record<string, unknown>;

    const schemaVersion = raw.schemaVersion;
    if (schemaVersion !== AUTHORITY_MODULE_SCHEMA_VERSION) {
        return fail(
            'manifest_schema_version_unsupported',
            `Unsupported manifest schemaVersion: ${formatValue(schemaVersion)} (expected ${AUTHORITY_MODULE_SCHEMA_VERSION}).`,
            false,
        );
    }

    const protocolVersion = raw.protocolVersion;
    if (protocolVersion !== AUTHORITY_MODULE_PROTOCOL_VERSION) {
        return fail(
            'manifest_protocol_version_incompatible',
            `Unsupported module protocolVersion: ${formatValue(protocolVersion)} (expected ${AUTHORITY_MODULE_PROTOCOL_VERSION}).`,
            true,
        );
    }

    const id = raw.id;
    if (typeof id !== 'string' || !MODULE_ID_PATTERN.test(id)) {
        return fail('manifest_id_invalid', `Invalid module id: ${formatValue(id)}.`, false);
    }

    const displayName = raw.displayName;
    if (typeof displayName !== 'string' || displayName.trim() === '') {
        return fail('manifest_display_name_invalid', `Invalid displayName: ${formatValue(displayName)}.`, false);
    }

    const version = raw.version;
    if (typeof version !== 'string' || version.trim() === '') {
        return fail('manifest_version_invalid', `Invalid module version: ${formatValue(version)}.`, false);
    }

    const ownerExtensionIdInManifest = raw.ownerExtensionId;
    if (typeof ownerExtensionIdInManifest !== 'string' || ownerExtensionIdInManifest.trim() === '') {
        return fail('manifest_owner_extension_id_missing', 'ownerExtensionId is required.', false);
    }
    if (ownerExtensionIdInManifest !== ownerExtensionId) {
        return fail(
            'manifest_owner_extension_id_mismatch',
            `ownerExtensionId '${ownerExtensionIdInManifest}' does not match discovered extension id '${ownerExtensionId}'.`,
            false,
        );
    }

    if (!isModuleIdOwnedByExtension(id, ownerExtensionId)) {
        return fail(
            'manifest_id_owner_mismatch',
            `Module id '${id}' must equal the normalized owner id '${normalizeOwnerExtensionId(ownerExtensionId)}' or start with that prefix followed by '.'.`,
            false,
        );
    }

    const entry = raw.entry;
    if (entry !== undefined && (typeof entry !== 'string' || entry.trim() === '')) {
        return fail('manifest_entry_invalid', `Invalid entry: ${formatValue(entry)}.`, false);
    }

    const transactions = raw.transactions;
    if (!transactions || typeof transactions !== 'object' || Array.isArray(transactions)) {
        return fail('manifest_transactions_invalid', 'transactions must be a record of transaction manifests.', false);
    }

    const transactionEntries = Object.entries(transactions as Record<string, unknown>);
    if (transactionEntries.length === 0) {
        return fail('manifest_transactions_empty', 'transactions must declare at least one transaction.', false);
    }

    const validatedTransactions: Record<ModuleTransactionName, ModuleTransactionManifest> = {};
    for (const [transactionName, transactionRaw] of transactionEntries) {
        const transactionValidation = validateTransaction(transactionName, transactionRaw, id);
        if (!transactionValidation.ok) {
            return fail(transactionValidation.code, transactionValidation.message, false);
        }
        validatedTransactions[transactionName] = transactionValidation.transaction;
    }

    const manifest: AuthorityModuleManifest = {
        id,
        displayName,
        version,
        protocolVersion,
        schemaVersion,
        ownerExtensionId,
        ...(typeof entry === 'string' ? { entry } : {}),
        transactions: validatedTransactions,
    };

    return { ok: true, manifest };
}

interface TransactionValidationOk {
    ok: true;
    transaction: ModuleTransactionManifest;
}
interface TransactionValidationFail {
    ok: false;
    code: string;
    message: string;
}
type TransactionValidation = TransactionValidationOk | TransactionValidationFail;

function validateTransaction(name: string, raw: unknown, moduleId: string): TransactionValidation {
    if (typeof name !== 'string' || name.includes(':') || !TRANSACTION_NAME_PATTERN.test(name)) {
        return transactionFail(
            'manifest_transaction_name_invalid',
            `Invalid transaction name: ${formatValue(name)}`,
        );
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return transactionFail('manifest_transaction_shape_invalid', `Transaction '${name}' must be an object.`);
    }

    const tx = raw as Record<string, unknown>;

    const declaredName = tx.name;
    if (typeof declaredName !== 'string' || declaredName !== name) {
        return transactionFail(
            'manifest_transaction_name_mismatch',
            `Transaction name mismatch for ${moduleId}/${name}: declared name ${formatValue(declaredName)}.`,
        );
    }

    const version = tx.version;
    if (typeof version !== 'string' || version.trim() === '') {
        return transactionFail(
            'manifest_transaction_version_invalid',
            `Transaction '${name}' version must be a non-empty string.`,
        );
    }

    const title = tx.title;
    if (typeof title !== 'string' || title.trim() === '') {
        return transactionFail(
            'manifest_transaction_title_invalid',
            `Transaction '${name}' title must be a non-empty string.`,
        );
    }

    const riskLevel = tx.riskLevel;
    if (typeof riskLevel !== 'string' || !SUPPORTED_RISK_LEVELS.has(riskLevel)) {
        return transactionFail(
            'manifest_transaction_risk_level_invalid',
            `Transaction '${name}' riskLevel must be one of low|medium|high.`,
        );
    }

    const permissionTarget = tx.permissionTarget;
    const permissionTargetValidation = validatePermissionTarget(name, permissionTarget, moduleId);
    if (!permissionTargetValidation.ok) {
        return permissionTargetValidation;
    }

    const requiredResources = tx.requiredResources;
    if (!Array.isArray(requiredResources)) {
        return transactionFail(
            'manifest_transaction_required_resources_invalid',
            `Transaction '${name}' requiredResources must be an array.`,
        );
    }
    const validatedRequiredResources: ModuleTransactionRequiredResource[] = [];
    for (const item of requiredResources) {
        const resourceValidation = validateRequiredResource(name, item);
        if (!resourceValidation.ok) {
            return resourceValidation;
        }
        validatedRequiredResources.push(resourceValidation.value);
    }

    const idempotency = tx.idempotency;
    if (typeof idempotency !== 'string' || !SUPPORTED_IDEMPOTENCY.has(idempotency as ModuleTransactionIdempotency)) {
        return transactionFail(
            'manifest_transaction_idempotency_invalid',
            `Transaction '${name}' idempotency must be one of none|optional|required.`,
        );
    }

    const timeoutMsRaw = tx.timeoutMs;
    if (timeoutMsRaw !== undefined) {
        if (typeof timeoutMsRaw !== 'number' || !Number.isFinite(timeoutMsRaw) || timeoutMsRaw <= 0 || timeoutMsRaw > MODULE_MAX_TIMEOUT_MS) {
            return transactionFail(
                'manifest_transaction_timeout_invalid',
                `Transaction '${name}' timeoutMs must be a positive number up to ${MODULE_MAX_TIMEOUT_MS} ms.`,
            );
        }
    }
    const timeoutMs: number | undefined = typeof timeoutMsRaw === 'number' ? timeoutMsRaw : undefined;

    const maxRequestBytesRaw = tx.maxRequestBytes;
    if (maxRequestBytesRaw !== undefined) {
        if (!isByteLimit(maxRequestBytesRaw, MODULE_MAX_REQUEST_BYTES)) {
            return transactionFail(
                'manifest_transaction_max_request_bytes_invalid',
                `Transaction '${name}' maxRequestBytes must be a positive integer up to ${MODULE_MAX_REQUEST_BYTES}.`,
            );
        }
    }
    const maxRequestBytes: number | undefined = isByteLimit(maxRequestBytesRaw, MODULE_MAX_REQUEST_BYTES) ? maxRequestBytesRaw : undefined;

    const maxResponseBytesRaw = tx.maxResponseBytes;
    if (maxResponseBytesRaw !== undefined) {
        if (!isByteLimit(maxResponseBytesRaw, MODULE_MAX_RESPONSE_BYTES)) {
            return transactionFail(
                'manifest_transaction_max_response_bytes_invalid',
                `Transaction '${name}' maxResponseBytes must be a positive integer up to ${MODULE_MAX_RESPONSE_BYTES}.`,
            );
        }
    }
    const maxResponseBytes: number | undefined = isByteLimit(maxResponseBytesRaw, MODULE_MAX_RESPONSE_BYTES) ? maxResponseBytesRaw : undefined;

    const transaction: ModuleTransactionManifest = {
        name,
        version,
        title,
        ...(typeof tx.description === 'string' ? { description: tx.description } : {}),
        riskLevel: riskLevel as ModuleTransactionManifest['riskLevel'],
        permissionTarget: permissionTargetValidation.value,
        requiredResources: validatedRequiredResources,
        idempotency: idempotency as ModuleTransactionIdempotency,
        ...(typeof tx.lockScope === 'string' ? { lockScope: tx.lockScope } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(maxRequestBytes !== undefined ? { maxRequestBytes } : {}),
        ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
    };

    return { ok: true, transaction };
}

interface PermissionTargetValidationOk {
    ok: true;
    value: ModuleTransactionPermissionTarget;
}
type PermissionTargetValidation = PermissionTargetValidationOk | TransactionValidationFail;

function validatePermissionTarget(
    transactionName: string,
    raw: unknown,
    moduleId: string,
): PermissionTargetValidation {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return transactionFail(
            'manifest_transaction_permission_target_invalid',
            `Transaction '${transactionName}' permissionTarget must be an object.`,
        );
    }

    const target = raw as Record<string, unknown>;
    const kind = target.kind;
    if (typeof kind !== 'string' || !SUPPORTED_PERMISSION_TARGET_KINDS.has(kind)) {
        return transactionFail(
            'manifest_transaction_permission_target_invalid',
            `Transaction '${transactionName}' permissionTarget.kind must be one of module|transaction|custom.`,
        );
    }

    if (kind === 'module') {
        return { ok: true, value: { kind: 'module' } };
    }
    if (kind === 'transaction') {
        return { ok: true, value: { kind: 'transaction' } };
    }

    const customTarget = target.target;
    if (typeof customTarget !== 'string' || customTarget.trim() === '') {
        return transactionFail(
            'manifest_transaction_permission_target_invalid',
            `Transaction '${transactionName}' permissionTarget.target must be a non-empty string for kind=custom.`,
        );
    }

    // Custom permission targets in companion manifests must be scoped to the
    // module's own permission namespace. Acceptable forms:
    //   - exactly the moduleId
    //   - moduleId followed by ':' and a non-empty suffix (moduleId:txName,
    //     moduleId:*, moduleId:prefix)
    // This prevents a companion module from declaring execute permission for
    // arbitrary other modules or unrelated permission keys.
    if (!isCustomTargetScopedToModule(customTarget, moduleId)) {
        return transactionFail(
            'manifest_transaction_permission_target_invalid',
            `Transaction '${transactionName}' permissionTarget.target '${customTarget}' must equal moduleId '${moduleId}' or start with '${moduleId}:'.`,
        );
    }
    return { ok: true, value: { kind: 'custom', target: customTarget } };
}

function isCustomTargetScopedToModule(customTarget: string, moduleId: string): boolean {
    if (customTarget === moduleId) {
        return true;
    }
    if (!customTarget.startsWith(`${moduleId}:`)) {
        return false;
    }
    const suffix = customTarget.slice(moduleId.length + 1);
    return suffix.length > 0 && !suffix.includes(':');
}

interface RequiredResourceValidationOk {
    ok: true;
    value: ModuleTransactionRequiredResource;
}
type RequiredResourceValidation = RequiredResourceValidationOk | TransactionValidationFail;

const SUPPORTED_RESOURCES = new Set<string>([
    'storage.kv',
    'storage.blob',
    'fs.private',
    'sql.private',
    'trivium.private',
    'http.fetch',
    'jobs.background',
    'events.stream',
    'module.execute',
]);

/**
 * Companion modules may only declare data/runtime permission resources in
 * `requiredResources`. `module.execute` is reserved for the host's own
 * permission target derivation and must not be re-declared by a companion
 * manifest, otherwise a malicious module could grant itself execute rights.
 */
const FORBIDDEN_COMPANION_RESOURCES = new Set<string>([
    'module.execute',
]);

function validateRequiredResource(transactionName: string, raw: unknown): RequiredResourceValidation {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return transactionFail(
            'manifest_transaction_required_resource_invalid',
            `Transaction '${transactionName}' requiredResources entries must be objects.`,
        );
    }

    const item = raw as Record<string, unknown>;
    const resource = item.resource;
    if (typeof resource !== 'string' || !SUPPORTED_RESOURCES.has(resource)) {
        return transactionFail(
            'manifest_transaction_required_resource_invalid',
            `Transaction '${transactionName}' requiredResources resource must be a supported companion PermissionResource.`,
        );
    }
    if (FORBIDDEN_COMPANION_RESOURCES.has(resource)) {
        return transactionFail(
            'manifest_transaction_required_resource_forbidden',
            `Transaction '${transactionName}' requiredResources resource '${resource}' is not allowed in companion manifests.`,
        );
    }

    const value: ModuleTransactionRequiredResource = { resource: resource as ModuleTransactionRequiredResource['resource'] };
    if (typeof item.target === 'string') {
        value.target = item.target;
    }
    if (typeof item.reason === 'string') {
        value.reason = item.reason;
    }
    return { ok: true, value };
}

interface EntryValidationOk {
    status: 'available';
}
interface EntryValidationFail {
    status: Exclude<ModuleStatus, 'available'>;
    diagnostic: AuthorityModuleDiagnostic;
}
type EntryValidation = EntryValidationOk | EntryValidationFail;

function validateEntry(entry: string | undefined, moduleDir: string): EntryValidation {
    if (entry === undefined) {
        // Phase 1 allows manifests that declare no entry; they surface as
        // available-but-unloadable. Phase 2 will require entry for activation.
        return { status: 'available' };
    }

    if (typeof entry !== 'string' || entry.trim() === '') {
        return entryFail('entry_invalid', `Invalid entry: ${formatValue(entry)}.`, 'invalid_manifest');
    }

    // Entry must be relative and end in .cjs for MVP.
    if (path.isAbsolute(entry)) {
        return entryFail('entry_path_absolute', 'Entry must be a relative path.', 'invalid_manifest');
    }
    if (!entry.toLowerCase().endsWith('.cjs')) {
        return entryFail('entry_extension_unsupported', 'Entry must be a .cjs file.', 'invalid_manifest');
    }

    // Resolve and require the entry to remain inside the module's .authority dir.
    const resolvedEntry = path.resolve(moduleDir, entry);
    if (!isPathInside(moduleDir, resolvedEntry)) {
        return entryFail(
            'entry_path_escape',
            `Entry '${entry}' resolves outside the module .authority directory.`,
            'invalid_manifest',
        );
    }

    // Reject symlinked entry files. lstat does not follow symlinks, so a
    // symlinked entry pointing outside .authority is caught here even when
    // its eventual target exists.
    if (isSymlink(resolvedEntry)) {
        return entryFail(
            'entry_symlink_rejected',
            `Entry '${entry}' is a symlink; symlinked entries are rejected.`,
            'invalid_manifest',
        );
    }

    if (!isRegularFileStrict(resolvedEntry)) {
        return entryFail(
            'entry_missing',
            `Entry '${entry}' does not exist at the resolved path.`,
            'entry_missing',
        );
    }

    // Realpath containment: resolve the real module dir and the real entry
    // path (following any parent symlinks), then require the real entry to
    // remain inside the real .authority dir. This catches cases where the
    // .authority dir itself (or an ancestor) is a symlink whose target the
    // entry escapes via `..`.
    const realModuleDir = realpathSync(moduleDir);
    const realEntry = realpathSync(resolvedEntry);
    if (realModuleDir === null || realEntry === null) {
        return entryFail(
            'entry_missing',
            `Entry '${entry}' could not be resolved to a real path.`,
            'entry_missing',
        );
    }
    if (!isPathInside(realModuleDir, realEntry)) {
        return entryFail(
            'entry_path_escape',
            `Entry '${entry}' real path escapes the module .authority directory.`,
            'invalid_manifest',
        );
    }

    return { status: 'available' };
}

/**
 * Revalidate a discovery {@link CompanionModuleLoadCandidate} just before the
 * Phase 2 loader calls `require()` on its entry. This guards against TOCTOU
 * edits between discovery and load: a manifest/entry that was valid at
 * discovery time may have been swapped, symlinked, deleted, or moved outside
 * `.authority` before activation.
 *
 * Returns `null` when the candidate is still safe to load, or a structured
 * diagnostic describing the failure otherwise. Callers should mark the
 * affected record as `load_error` with the returned diagnostic.
 */
export function revalidateLoadCandidate(candidate: CompanionModuleLoadCandidate): AuthorityModuleDiagnostic | null {
    // Manifest file must still be a regular non-symlink file.
    if (isSymlink(candidate.manifestPath) || !isRegularFileStrict(candidate.manifestPath)) {
        return {
            code: 'load_manifest_changed',
            message: 'Manifest file changed or is no longer a regular file since discovery.',
            severity: 'error',
        };
    }

    // Re-read and shape-check the manifest so a swap cannot bypass validation.
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(candidate.manifestPath, 'utf8'));
    } catch (error) {
        return {
            code: 'load_manifest_unreadable',
            message: `Manifest could not be re-read: ${errorMessage(error)}`,
            severity: 'error',
        };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            code: 'load_manifest_shape_invalid',
            message: 'Re-read manifest is not a JSON object.',
            severity: 'error',
        };
    }
    const raw = parsed as Record<string, unknown>;
    if (raw.id !== candidate.moduleId) {
        return {
            code: 'load_manifest_id_changed',
            message: `Manifest id changed since discovery: ${formatValue(raw.id)} vs ${candidate.moduleId}.`,
            severity: 'error',
        };
    }
    if (typeof raw.entry !== 'string' || raw.entry !== candidate.manifest.entry) {
        return {
            code: 'load_entry_changed',
            message: 'Manifest entry changed since discovery.',
            severity: 'error',
        };
    }

    // Re-run the full entry validation: relative, .cjs, inside .authority,
    // not a symlink, realpath contained.
    const entryValidation = validateEntry(candidate.manifest.entry, candidate.moduleDir);
    if (entryValidation.status !== 'available') {
        return entryValidation.diagnostic;
    }
    return null;
}

function isModuleIdOwnedByExtension(moduleId: string, ownerExtensionId: string): boolean {
    const normalizedOwner = normalizeOwnerExtensionId(ownerExtensionId);
    if (!normalizedOwner) {
        return false;
    }
    return moduleId === normalizedOwner || moduleId.startsWith(`${normalizedOwner}.`);
}

function normalizeOwnerExtensionId(ownerExtensionId: string): string {
    // Convert `third-party/some-extension` -> `third-party.some-extension`.
    // Validate each segment so owners cannot inject characters that would
    // bypass the module-id prefix check.
    const segments = ownerExtensionId.split('/');
    if (segments.length === 0) {
        return '';
    }
    const normalizedSegments = segments.map(segment => segment.toLowerCase());
    if (!normalizedSegments.every(segment => OWNER_EXTENSION_SEGMENT_PATTERN.test(segment))) {
        return '';
    }
    return normalizedSegments.join('.');
}

function deriveExtensionId(sillyTavernRoot: string, extensionDir: string): string {
    const extensionsRoot = path.join(sillyTavernRoot, 'public', 'scripts', 'extensions');
    const thirdPartyRoot = path.join(extensionsRoot, 'third-party');
    const relativeToThirdParty = path.relative(thirdPartyRoot, extensionDir);
    if (relativeToThirdParty && !relativeToThirdParty.startsWith('..') && !path.isAbsolute(relativeToThirdParty)) {
        return `third-party/${relativeToThirdParty.split(path.sep)[0] ?? ''}`;
    }
    const relativeToExtensions = path.relative(extensionsRoot, extensionDir);
    if (relativeToExtensions && !relativeToExtensions.startsWith('..') && !path.isAbsolute(relativeToExtensions)) {
        return relativeToExtensions.split(path.sep)[0] ?? '';
    }
    return path.basename(extensionDir);
}

function isByteLimit(value: unknown, max: number): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && Number.isInteger(value)
        && value > 0
        && value <= max;
}

function isPathInside(basePath: string, candidatePath: string): boolean {
    const base = path.resolve(basePath);
    const candidate = path.resolve(candidatePath);
    const relative = path.relative(base, candidate);
    return relative === '' || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isHiddenName(name: string): boolean {
    return name.length > 0 && name.startsWith('.') && name !== '.';
}

function isSymlink(targetPath: string): boolean {
    try {
        return fs.lstatSync(targetPath).isSymbolicLink();
    } catch {
        return false;
    }
}

/**
 * Returns true if `targetPath` exists in any form (regular file, symlink,
 * directory, etc.). Uses lstat so symlinked paths that point to missing
 * targets still report true (the symlink entry itself exists).
 */
function pathExistsAny(targetPath: string): boolean {
    try {
        fs.lstatSync(targetPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns true if `targetPath` is a regular file and not a symlink. Uses
 * lstat so symlinked manifests/entries are rejected before the host reads
 * or loads them.
 */
function isRegularFileStrict(targetPath: string): boolean {
    try {
        const stat = fs.lstatSync(targetPath);
        return stat.isFile() && !stat.isSymbolicLink();
    } catch {
        return false;
    }
}

/**
 * Resolves the real absolute path of `targetPath` (following symlinks), or
 * `null` if the path cannot be resolved. Used for realpath containment
 * checks on the entry file and module dir.
 */
function realpathSync(targetPath: string): string | null {
    try {
        return fs.realpathSync(targetPath);
    } catch {
        return null;
    }
}

function isSillyTavernRoot(candidate: string): boolean {
    return fs.existsSync(path.join(candidate, 'plugins'))
        && fs.existsSync(path.join(candidate, 'public', 'scripts', 'extensions'));
}

function listDirectoryEntries(dir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

function buildRecord(
    ownerExtensionId: string,
    manifest: AuthorityModuleManifest | null,
    status: ModuleStatus,
    source: AuthorityModuleRecordSource,
    diagnostic?: AuthorityModuleDiagnostic,
): AuthorityModuleRecord {
    const moduleId = manifest?.id ?? deriveModuleIdFromSource(source);
    const record: AuthorityModuleRecord = {
        moduleId,
        ownerExtensionId,
        status,
        manifest,
        source,
    };
    if (diagnostic) {
        record.diagnostics = [diagnostic];
    }
    return record;
}

function markDuplicate(record: AuthorityModuleRecord, existing: AuthorityModuleRecord): AuthorityModuleRecord {
    const duplicate: AuthorityModuleRecord = {
        ...record,
        status: 'duplicate_id',
        diagnostics: [
            {
                code: 'duplicate_module_id',
                message: `Module id '${record.moduleId}' already discovered from ${existing.source.extensionId}.`,
                severity: 'warning',
            },
        ],
    };
    return duplicate;
}

function deriveModuleIdFromSource(source: AuthorityModuleRecordSource): string {
    // Fallback when the manifest could not be parsed; use the extension id
    // normalized to a module-id-shaped string so callers can still inspect
    // the record by id.
    const normalized = normalizeOwnerExtensionId(source.extensionId);
    return normalized || source.extensionId.replace(/[^a-z0-9._-]/gi, '_');
}

function fail(code: string, message: string, incompatibleHost: boolean): ManifestValidationFail {
    return {
        ok: false,
        incompatibleHost,
        diagnostic: { code, message, severity: incompatibleHost ? 'warning' : 'error' },
    };
}

function transactionFail(code: string, message: string): TransactionValidationFail {
    return { ok: false, code, message };
}

function entryFail(code: string, message: string, status: Exclude<ModuleStatus, 'available'>): EntryValidationFail {
    return { status, diagnostic: { code, message, severity: 'error' } };
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
