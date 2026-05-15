import type { AuthorityRuntime } from '../runtime.js';
import type { StManagerResourceType } from '../services/st-manager-resource-locator.js';
import type { AuthorityRequest, AuthorityResponse } from '../types.js';
import { AuthorityServiceError, getUserContext } from '../utils.js';

type RouterLike = {
    get(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
    post(path: string, handler: (req: AuthorityRequest, res: AuthorityResponse) => void | Promise<void>): void;
};

type RouteFailureHandler = (runtime: AuthorityRuntime, req: AuthorityRequest, res: AuthorityResponse, extensionId: string, error: unknown) => void;

function ok(res: AuthorityResponse, data: unknown): void {
    res.json(data);
}

function getOptionalUserContext(req: AuthorityRequest): ReturnType<typeof getUserContext> | undefined {
    return req.user ? getUserContext(req) : undefined;
}

function getStManagerBridgeUser(runtime: AuthorityRuntime, req: AuthorityRequest): ReturnType<typeof getUserContext> {
    return runtime.stManagerBridge.resolveAuthorizedUser(getOptionalUserContext(req), req.headers);
}

function getAdminUser(req: AuthorityRequest): ReturnType<typeof getUserContext> {
    const user = getUserContext(req);
    if (!user.isAdmin) {
        throw new AuthorityServiceError('Forbidden', 403, 'unauthorized', 'auth');
    }
    return user;
}

export function registerStManagerRoutes(router: RouterLike, runtime: AuthorityRuntime, fail: RouteFailureHandler): void {
    router.get('/st-manager/bridge/probe', async (req, res) => {
        try {
            const user = getStManagerBridgeUser(runtime, req);
            ok(res, runtime.stManagerBridge.probe(user, req.headers));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-bridge', error);
        }
    });

    router.get('/st-manager/bridge/admin/config', async (req, res) => {
        try {
            const user = getUserContext(req);
            if (!user.isAdmin) {
                throw new AuthorityServiceError('Forbidden', 403, 'unauthorized', 'auth');
            }
            ok(res, runtime.stManagerBridge.getAdminConfig(user));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-bridge', error);
        }
    });

    router.post('/st-manager/bridge/admin/config', async (req, res) => {
        try {
            const user = getUserContext(req);
            ok(res, runtime.stManagerBridge.updateAdminConfig(user, req.body ?? {}));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-bridge', error);
        }
    });

    router.get('/st-manager/resources/:type/manifest', async (req, res) => {
        try {
            const user = getStManagerBridgeUser(runtime, req);
            ok(res, runtime.stManagerBridge.buildManifest(user, String(req.params?.type ?? '') as StManagerResourceType, req.headers));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-bridge', error);
        }
    });

    router.post('/st-manager/resources/:type/file/read', async (req, res) => {
        try {
            const user = getStManagerBridgeUser(runtime, req);
            ok(res, runtime.stManagerBridge.readFile(user, String(req.params?.type ?? '') as StManagerResourceType, req.body ?? {}, req.headers));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-bridge', error);
        }
    });

    router.post('/st-manager/resources/:type/file/write-init', async (req, res) => {
        try {
            const user = getStManagerBridgeUser(runtime, req);
            ok(res, runtime.stManagerBridge.writeInit(user, String(req.params?.type ?? '') as StManagerResourceType, req.body ?? {}, req.headers));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-bridge', error);
        }
    });

    router.post('/st-manager/resources/:type/file/write-chunk', async (req, res) => {
        try {
            const user = getStManagerBridgeUser(runtime, req);
            ok(res, runtime.stManagerBridge.writeChunk(user, String(req.params?.type ?? '') as StManagerResourceType, req.body ?? {}, req.headers));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-bridge', error);
        }
    });

    router.post('/st-manager/resources/:type/file/write-commit', async (req, res) => {
        try {
            const user = getStManagerBridgeUser(runtime, req);
            ok(res, runtime.stManagerBridge.writeCommit(user, String(req.params?.type ?? '') as StManagerResourceType, req.body ?? {}, req.headers));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-bridge', error);
        }
    });

    router.get('/st-manager/control/config', async (req, res) => {
        try {
            getAdminUser(req);
            ok(res, runtime.stManagerControl.getAdminConfig());
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-control', error);
        }
    });

    router.post('/st-manager/control/config', async (req, res) => {
        try {
            getAdminUser(req);
            ok(res, runtime.stManagerControl.updateConfig(req.body ?? {}));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-control', error);
        }
    });

    router.post('/st-manager/control/probe', async (req, res) => {
        try {
            getAdminUser(req);
            ok(res, await runtime.stManagerControl.probe());
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-control', error);
        }
    });

    router.post('/st-manager/control/backup/start', async (req, res) => {
        try {
            const user = getAdminUser(req);
            ok(res, await runtime.stManagerControl.startBackup(user, req.body ?? {}));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-control', error);
        }
    });

    router.post('/st-manager/control/pair', async (req, res) => {
        try {
            getAdminUser(req);
            ok(res, await runtime.stManagerControl.pair(req.body ?? {}));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-control', error);
        }
    });

    router.get('/st-manager/control/backups', async (req, res) => {
        try {
            getAdminUser(req);
            ok(res, await runtime.stManagerControl.listBackups());
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-control', error);
        }
    });

    router.get('/st-manager/control/backups/:backup_id', async (req, res) => {
        try {
            getAdminUser(req);
            ok(res, await runtime.stManagerControl.getBackupDetail(String(req.params?.backup_id ?? '')));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-control', error);
        }
    });

    router.post('/st-manager/control/restore-preview', async (req, res) => {
        try {
            const user = getAdminUser(req);
            ok(res, await runtime.stManagerControl.restorePreview(user, req.body ?? {}));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-control', error);
        }
    });

    router.post('/st-manager/control/restore', async (req, res) => {
        try {
            const user = getAdminUser(req);
            ok(res, await runtime.stManagerControl.restoreBackup(user, req.body ?? {}));
        } catch (error) {
            fail(runtime, req, res, 'third-party/st-manager-control', error);
        }
    });
}
