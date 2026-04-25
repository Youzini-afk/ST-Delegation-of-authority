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
    const events = new SseBroker();
    const audit = new AuditService();
    const core = new CoreService();
    const extensions = new ExtensionService();
    const install = new InstallService();
    const policies = new PolicyService();
    const permissions = new PermissionService(policies);
    const sessions = new SessionService();
    const storage = new StorageService();
    const http = new HttpService();
    const jobs = new JobService(events);

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
