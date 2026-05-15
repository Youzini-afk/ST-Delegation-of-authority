import net from 'node:net';
import type { ChildProcess } from 'node:child_process';
import type { AuthorityCoreHealthSnapshot } from '../types.js';

export async function fetchHealth(port: number, token: string): Promise<AuthorityCoreHealthSnapshot> {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: {
            'x-authority-core-token': token,
        },
    });

    if (!response.ok) {
        throw new Error(`authority-core health check failed with ${response.status}`);
    }

    return await response.json() as AuthorityCoreHealthSnapshot;
}

export async function getAvailablePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Unable to resolve an ephemeral authority-core port')));
                return;
            }
            const { port } = address;
            server.close(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });
}

export function onceChildExit(child: ChildProcess): Promise<void> {
    return new Promise(resolve => {
        child.once('exit', () => resolve());
    });
}

export async function readCorePayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        return await response.json();
    }

    const text = await response.text();
    return text || undefined;
}

export function delay(durationMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, durationMs));
}
