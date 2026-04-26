import { SseBroker } from './events/sse-broker.js';
import { AuditService } from './services/audit-service.js';
import { CoreService } from './services/core-service.js';
import { DataTransferService } from './services/data-transfer-service.js';
import { ExtensionService } from './services/extension-service.js';
import { HttpService } from './services/http-service.js';
import { InstallService } from './services/install-service.js';
import { JobService } from './services/job-service.js';
import { PermissionService } from './services/permission-service.js';
import { PolicyService } from './services/policy-service.js';
import { PrivateFsService } from './services/private-fs-service.js';
import { SessionService } from './services/session-service.js';
import { StorageService } from './services/storage-service.js';
import { TriviumService } from './services/trivium-service.js';

export interface AuthorityRuntime {
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
    files: PrivateFsService;
    http: HttpService;
    jobs: JobService;
    trivium: TriviumService;
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
    const files = new PrivateFsService(core);
    const http = new HttpService(core);
    const jobs = new JobService(core);
    const trivium = new TriviumService(core);

    return {
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
        files,
        http,
        jobs,
        trivium,
    };
}
