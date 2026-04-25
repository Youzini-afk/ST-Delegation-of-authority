import { nowIso } from '../utils.js';
import type { AuthorityResponse } from '../types.js';
import { CoreService } from '../services/core-service.js';

interface ClientRecord {
    dbPath: string;
    userHandle: string;
    channel: string;
    response: AuthorityResponse;
    cursor: number | null;
    polling: boolean;
    timer: NodeJS.Timeout | null;
}

export class SseBroker {
    constructor(private readonly core: CoreService) {}

    private readonly clients = new Set<ClientRecord>();

    register(dbPath: string, userHandle: string, channel: string, response: AuthorityResponse): () => void {
        const client: ClientRecord = {
            dbPath,
            userHandle,
            channel,
            response,
            cursor: null,
            polling: false,
            timer: null,
        };
        this.clients.add(client);
        this.emitToClient(client, 'authority.connected', {
            timestamp: nowIso(),
            ...(channel.startsWith('extension:') ? { extensionId: channel.slice('extension:'.length) } : { channel }),
        });
        void this.pollClient(client);
        client.timer = setInterval(() => {
            void this.pollClient(client);
        }, 500);

        return () => {
            if (client.timer) {
                clearInterval(client.timer);
            }
            this.clients.delete(client);
        };
    }

    private async pollClient(client: ClientRecord): Promise<void> {
        if (client.polling || !this.clients.has(client)) {
            return;
        }

        client.polling = true;
        try {
            const { events, cursor } = await this.core.pollControlEvents(client.dbPath, {
                userHandle: client.userHandle,
                channel: client.channel,
                ...(client.cursor !== null ? { afterId: client.cursor } : {}),
            });
            client.cursor = cursor;
            for (const event of events) {
                this.emitToClient(client, event.name, event.payload);
                client.cursor = event.id;
            }
        } catch {
            return;
        } finally {
            client.polling = false;
        }
    }

    private emitToClient(client: ClientRecord, eventName: string, payload: unknown): void {
        client.response.write(`event: ${eventName}\n`);
        client.response.write(`data: ${JSON.stringify(payload ?? null)}\n\n`);
    }
}

