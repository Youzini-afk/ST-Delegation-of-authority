import type {
    AuthorityModuleManifest,
    ModuleGetResponse,
    ModuleListResponse,
    ModuleTransactionDiagnostics,
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
}

interface RegisteredModule {
    manifest: AuthorityModuleManifest;
    handlers: Map<ModuleTransactionName, ModuleTransactionHandler>;
    resolvers: Partial<Record<ModuleTransactionName, ModuleTransactionRequiredResourceResolver>>;
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
): ModuleTransactionManifest {
    const transaction = module.manifest.transactions[transactionName];
    if (!transaction) {
        throw new AuthorityServiceError(
            `Transaction not found: ${module.manifest.id}/${transactionName}`,
            404,
            'validation_error',
            'validation',
        );
    }
    return transaction;
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

        this.modules.set(manifest.id, {
            manifest,
            handlers: handlerMap,
            resolvers: options.requiredResourceResolvers ?? {},
        });
    }

    listManifests(): ModuleListResponse {
        const modules = [...this.modules.values()].map(entry => entry.manifest);
        return {
            modules,
            count: modules.length,
        };
    }

    getManifest(moduleId: string): ModuleGetResponse {
        validateModuleId(moduleId);
        const module = this.modules.get(moduleId);
        if (!module) {
            throw new AuthorityServiceError(
                `Module not found: ${moduleId}`,
                404,
                'validation_error',
                'validation',
            );
        }
        return { module: module.manifest };
    }

    count(): number {
        return this.modules.size;
    }

    async execute(
        user: UserContext,
        session: SessionRecord,
        moduleId: string,
        transactionName: string,
        request: ModuleTransactionRequest,
    ): Promise<ModuleTransactionResponse> {
        validateModuleId(moduleId);
        validateTransactionName(transactionName);

        if (request.options?.dryRun === true) {
            throw new AuthorityServiceError(
                `Dry-run execution is not supported: ${moduleId}/${transactionName}`,
                400,
                'validation_error',
                'validation',
            );
        }

        const module = this.modules.get(moduleId);
        if (!module) {
            throw new AuthorityServiceError(
                `Module not found: ${moduleId}`,
                404,
                'validation_error',
                'validation',
            );
        }
        const transaction = assertTransactionManifest(module, transactionName);

        if (transaction.idempotency === 'required') {
            const key = typeof request.idempotencyKey === 'string' ? request.idempotencyKey.trim() : '';
            if (!key) {
                throw new AuthorityServiceError(
                    `Idempotency key required for transaction: ${moduleId}/${transactionName}`,
                    400,
                    'validation_error',
                    'validation',
                );
            }
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
        };

        const handler = module.handlers.get(transactionName);
        if (!handler) {
            throw new AuthorityServiceError(
                `Handler missing for transaction: ${moduleId}/${transactionName}`,
                500,
                'core_request_failed',
                'core',
            );
        }

        const input = request.input ?? undefined;
        const handlerResult = await handler(ctx, input, request);

        const idempotencyKey = typeof request.idempotencyKey === 'string' && request.idempotencyKey.trim()
            ? request.idempotencyKey.trim()
            : undefined;

        const response: ModuleTransactionResponse = {
            ok: true,
            moduleId,
            transaction: transactionName,
            transactionVersion: transaction.version,
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
            ...(handlerResult.result === undefined ? {} : { result: handlerResult.result }),
            ...(handlerResult.diagnostics === undefined ? {} : { diagnostics: handlerResult.diagnostics }),
        };

        await this.audit.logUsage(user, session.extension.id, `Module transaction executed: ${moduleId}/${transactionName}`, {
            moduleId,
            transaction: transactionName,
            transactionVersion: transaction.version,
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        }).catch(() => undefined);

        return response;
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
}
