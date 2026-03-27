import { nowIso } from '../utils.js';
import type { AuthorityResponse } from '../types.js';

interface ClientRecord {
    userHandle: string;
    extensionId: string;
    response: AuthorityResponse;
}

export class SseBroker {
    private readonly clients = new Set<ClientRecord>();

    register(userHandle: string, extensionId: string, response: AuthorityResponse): () => void {
        const client: ClientRecord = { userHandle, extensionId, response };
        this.clients.add(client);
        this.emitToClient(client, 'authority.connected', {
            timestamp: nowIso(),
            extensionId,
        });

        return () => {
            this.clients.delete(client);
        };
    }

    emit(userHandle: string, extensionId: string, eventName: string, payload: unknown): void {
        for (const client of this.clients) {
            if (client.userHandle !== userHandle || client.extensionId !== extensionId) {
                continue;
            }

            this.emitToClient(client, eventName, payload);
        }
    }

    private emitToClient(client: ClientRecord, eventName: string, payload: unknown): void {
        client.response.write(`event: ${eventName}\n`);
        client.response.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
}

