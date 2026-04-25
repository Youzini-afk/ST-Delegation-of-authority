import { SseBroker } from './events/sse-broker.js';
import { AuditService } from './services/audit-service.js';
import { CoreService } from './services/core-service.js';
import { ExtensionService } from './services/extension-service.js';
import { HttpService } from './services/http-service.js';
import { InstallService } from './services/install-service.js';
import { JobService } from './services/job-service.js';
import { PermissionService } from './services/permission-service.js';
import { PolicyService } from './services/policy-service.js';
import { SessionService } from './services/session-service.js';
import { StorageService } from './services/storage-service.js';

export interface AuthorityRuntime {
    events: SseBroker;
    audit: AuditService;
    core: CoreService;
    extensions: ExtensionService;
    install: InstallService;
    policies: PolicyService;
    permissions: PermissionService;
    sessions: SessionService;
    storage: StorageService;
    http: HttpService;
    jobs: JobService;
}

export function createAuthorityRuntime(): AuthorityRuntime {
    const core = new CoreService();
    const events = new SseBroker(core);
    const audit = new AuditService(core);
    const extensions = new ExtensionService(core);
    const install = new InstallService();
    const policies = new PolicyService(core);
    const permissions = new PermissionService(policies, core);
    const sessions = new SessionService(core);
    const storage = new StorageService(core);
    const http = new HttpService(core);
    const jobs = new JobService(core);

    return {
        events,
        audit,
        core,
        extensions,
        install,
        policies,
        permissions,
        sessions,
        storage,
        http,
        jobs,
    };
}
