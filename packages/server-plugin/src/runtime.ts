import { SseBroker } from './events/sse-broker.js';
import { AdminPackageService } from './services/admin-package-service.js';
import { AgentHostToolService } from './services/agent-host-tools.js';
import { AgentSessionRuntimeService } from './services/agent-session-runtime-service.js';
import { AgentSessionStoreService } from './services/agent-session-store-service.js';
import { AgentService } from './services/agent-service.js';
import { AgentStoreService } from './services/agent-store-service.js';
import { AuditService } from './services/audit-service.js';
import { CompanionModuleLoaderService } from './services/companion-module-loader-service.js';
import { CoreService } from './services/core-service.js';
import { DataTransferService } from './services/data-transfer-service.js';
import { ExtensionService } from './services/extension-service.js';
import { HttpService } from './services/http-service.js';
import { IdempotencyService } from './services/idempotency-service.js';
import { InstallService } from './services/install-service.js';
import { JobService } from './services/job-service.js';
import { LockService } from './services/lock-service.js';
import { ModuleDiscoveryService } from './services/module-discovery-service.js';
import { ModuleHostService } from './services/module-host-service.js';
import { NativeMigrationService } from './services/native-migration-service.js';
import { PermissionService } from './services/permission-service.js';
import { PolicyService } from './services/policy-service.js';
import { PrivateFsService } from './services/private-fs-service.js';
import { SessionService } from './services/session-service.js';
import { StorageService } from './services/storage-service.js';
import { StManagerBridgeService } from './services/st-manager-bridge-service.js';
import { StManagerControlService } from './services/st-manager-control-service.js';
import { TriviumService } from './services/trivium-service.js';
import { WorkspaceHistoryService } from './services/workspace-history-service.js';
import { getGlobalAuthorityPaths } from './store/authority-paths.js';

export interface AuthorityRuntime {
    adminPackages: AdminPackageService;
    events: SseBroker;
    audit: AuditService;
    core: CoreService;
    transfers: DataTransferService;
    extensions: ExtensionService;
    install: InstallService;
    policies: PolicyService;
    permissions: PermissionService;
    sessions: SessionService;
    storage: StorageService;
    stManagerBridge: StManagerBridgeService;
    stManagerControl: StManagerControlService;
    files: PrivateFsService;
    http: HttpService;
    jobs: JobService;
    trivium: TriviumService;
    nativeMigrations: NativeMigrationService;
    modules: ModuleHostService;
    moduleDiscovery: ModuleDiscoveryService;
    /**
     * Phase B in-process lock service. Per-process only; NOT crash-durable;
     * NOT cross-process. Companion modules reach it through the
     * `ctx.locks` wrapper which auto-prefixes scope with the owner
     * extension id; this field exposes the raw service for host-internal
     * callers (none at present) and for tests.
     */
    locks: LockService;
    /**
     * Phase C durable-ish idempotency service. Backed by
     * {@link storage} KV (per-extension sqlite). Companion modules reach
     * it through the `ctx.idempotency` wrapper which auto-prefixes the
     * caller-supplied key with the owner extension id and clamps TTL to
     * a 7 d hard cap; this field exposes the raw service for host-internal
     * callers (none at present) and for tests.
     */
    idempotency: IdempotencyService;
    /**
     * Phase 2 loader for companion authority modules. Loads
     * `.authority/server.cjs` for valid discovered records at startup and
     * re-registers their handlers with {@link modules} using the companion
     * registration path so handlers receive a minimal safe ctx.
     */
    companionLoader: CompanionModuleLoaderService;
    workspaceHistory: WorkspaceHistoryService;
    agent: AgentService;
    agentSessions: AgentSessionRuntimeService;
}

export function createAuthorityRuntime(): AuthorityRuntime {
    const core = new CoreService();
    const events = new SseBroker(core);
    const audit = new AuditService(core);
    const transfers = new DataTransferService();
    const extensions = new ExtensionService(core);
    const install = new InstallService();
    const policies = new PolicyService(core);
    const permissions = new PermissionService(policies, core);
    const sessions = new SessionService(core);
    const storage = new StorageService(core);
    const stManagerBridge = new StManagerBridgeService();
    const stManagerControl = new StManagerControlService();
    const files = new PrivateFsService(core);
    const http = new HttpService(core);
    const jobs = new JobService(core);
    const trivium = new TriviumService(core);
    const nativeMigrations = new NativeMigrationService();
    const adminPackages = new AdminPackageService(core, extensions, permissions, policies, storage, files, trivium);
    const modules = new ModuleHostService(permissions, audit, trivium, storage, files, jobs, events);
    const moduleDiscovery = new ModuleDiscoveryService(install);
    const locks = new LockService();
    const idempotency = new IdempotencyService(storage);
    const companionLoader = new CompanionModuleLoaderService(modules, permissions, audit, trivium, core, locks, idempotency);
    const globalPaths = getGlobalAuthorityPaths();
    const workspaceHistory = new WorkspaceHistoryService(globalPaths.agentWorkspacesDir);
    const agentStore = new AgentStoreService(globalPaths.agentStateDir);
    const agentHostTools = new AgentHostToolService(workspaceHistory);
    const agent = new AgentService(
        agentStore,
        workspaceHistory,
        agentHostTools,
        { moduleHost: modules },
    );
    const agentSessions = new AgentSessionRuntimeService(
        new AgentSessionStoreService(globalPaths.agentStateDir),
        agentStore,
        workspaceHistory,
        agentHostTools,
        { moduleHost: modules },
    );

    return {
        adminPackages,
        events,
        audit,
        core,
        transfers,
        extensions,
        install,
        policies,
        permissions,
        sessions,
        storage,
        stManagerBridge,
        stManagerControl,
        files,
        http,
        jobs,
        trivium,
        nativeMigrations,
        modules,
        moduleDiscovery,
        locks,
        idempotency,
        companionLoader,
        workspaceHistory,
        agent,
        agentSessions,
    };
}
