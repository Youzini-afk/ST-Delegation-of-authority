import type { AuthorityInitConfig, ControlSessionSnapshot, SessionInitResponse } from '@stdo/shared-types';
import { buildAuthorityFeatureFlags } from '../constants.js';
import { getUserAuthorityPaths } from '../store/authority-paths.js';
import type { SessionRecord, UserContext } from '../types.js';
import { AuthorityServiceError, nowIso, randomToken } from '../utils.js';
import { CoreService } from './core-service.js';

export class SessionService {
    private readonly sessions = new Map<string, SessionRecord>();

    constructor(private readonly core: CoreService) {}

    async createSession(user: UserContext, config: AuthorityInitConfig): Promise<SessionRecord> {
        const token = randomToken();
        const paths = getUserAuthorityPaths(user);
        const snapshot = await this.core.initializeControlSession(
            paths.controlDbFile,
            token,
            nowIso(),
            { handle: user.handle, isAdmin: user.isAdmin },
            config,
        );
        const session = this.sessionFromSnapshot(snapshot);
        this.sessions.set(token, session);
        return session;
    }

    async getSession(token: string | null, user: UserContext): Promise<SessionRecord | null> {
        if (!token) {
            return null;
        }

        const cached = this.sessions.get(token);
        if (cached) {
            return cached;
        }

        const paths = getUserAuthorityPaths(user);
        const snapshot = await this.core.getControlSession(paths.controlDbFile, user.handle, token);
        if (!snapshot) {
            return null;
        }

        const session = this.sessionFromSnapshot(snapshot);
        this.sessions.set(token, session);
        return session;
    }

    async assertSession(token: string | null, user: UserContext): Promise<SessionRecord> {
        const session = await this.getSession(token, user);
        if (!session) {
            throw new AuthorityServiceError('Invalid authority session', 401, 'invalid_session', 'session');
        }

        if (session.userHandle !== user.handle) {
            throw new AuthorityServiceError('Authority session does not belong to current user', 403, 'session_user_mismatch', 'session');
        }

        return session;
    }

    buildSessionResponse(session: SessionRecord, grants: SessionInitResponse['grants'], policies: SessionInitResponse['policies']): SessionInitResponse {
        return {
            sessionToken: session.token,
            user: {
                handle: session.userHandle,
                isAdmin: session.isAdmin,
            },
            extension: session.extension,
            grants,
            policies,
            features: buildAuthorityFeatureFlags(session.isAdmin),
        };
    }

    private sessionFromSnapshot(snapshot: ControlSessionSnapshot): SessionRecord {
        return {
            token: snapshot.sessionToken,
            createdAt: snapshot.createdAt,
            userHandle: snapshot.user.handle,
            isAdmin: snapshot.user.isAdmin,
            extension: snapshot.extension,
            declaredPermissions: snapshot.declaredPermissions,
            sessionGrants: new Map(),
        };
    }
}

