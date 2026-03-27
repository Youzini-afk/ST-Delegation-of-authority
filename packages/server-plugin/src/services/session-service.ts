import type { AuthorityInitConfig, SessionInitResponse } from '@stdo/shared-types';
import type { SessionRecord, UserContext } from '../types.js';
import { nowIso, randomToken } from '../utils.js';

export class SessionService {
    private readonly sessions = new Map<string, SessionRecord>();

    createSession(user: UserContext, config: AuthorityInitConfig, firstSeenAt: string): SessionRecord {
        const token = randomToken();
        const session: SessionRecord = {
            token,
            createdAt: nowIso(),
            userHandle: user.handle,
            isAdmin: user.isAdmin,
            extension: {
                id: config.extensionId,
                installType: config.installType,
                displayName: config.displayName,
                version: config.version,
                firstSeenAt,
            },
            declaredPermissions: config.declaredPermissions,
            sessionGrants: new Map(),
        };

        this.sessions.set(token, session);
        return session;
    }

    getSession(token: string | null): SessionRecord | null {
        if (!token) {
            return null;
        }

        return this.sessions.get(token) ?? null;
    }

    assertSession(token: string | null, user: UserContext): SessionRecord {
        const session = this.getSession(token);
        if (!session) {
            throw new Error('Invalid authority session');
        }

        if (session.userHandle !== user.handle) {
            throw new Error('Authority session does not belong to current user');
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
            features: {
                securityCenter: true,
                admin: session.isAdmin,
            },
        };
    }
}

