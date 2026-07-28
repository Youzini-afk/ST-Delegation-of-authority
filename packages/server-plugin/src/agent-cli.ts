import path from 'node:path';
import { WorkspaceHistoryService, resolveWorkspaceHistoryStore } from './services/workspace-history-service.js';

interface ParsedArgs {
    command: string;
    positionals: string[];
    dataRoot?: string;
    store?: string;
    workspaceId?: string;
    operationId?: string;
    limit: number;
    force: boolean;
}

export async function runAgentCli(argv: string[]): Promise<unknown> {
    const args = parseArgs(argv);
    const storeDir = args.store
        ? path.resolve(args.store)
        : resolveWorkspaceHistoryStore(args.dataRoot ?? defaultDataRoot());
    const history = new WorkspaceHistoryService(storeDir);

    if (args.command === 'workspaces') {
        return { storeDir, workspaces: history.listWorkspaces() };
    }
    if (args.command === 'status' && !args.workspaceId) {
        const workspaces = history.listWorkspaces();
        return {
            storeDir,
            workspaces: await Promise.all(workspaces.map(workspace => history.status(workspace.id))),
        };
    }

    const workspaceId = resolveWorkspaceId(history, args.workspaceId);
    switch (args.command) {
        case 'status':
            return await history.status(workspaceId);
        case 'log':
            return {
                workspace: history.getWorkspace(workspaceId),
                commits: history.listCommits(workspaceId, args.limit),
            };
        case 'diff': {
            const workspace = history.getWorkspace(workspaceId);
            const from = resolveCommit(args.positionals[0], workspace.headCommitId);
            const to = resolveCommit(args.positionals[1] ?? 'head', workspace.headCommitId);
            return history.diff(workspaceId, from, to);
        }
        case 'checkpoint':
            return await history.checkpoint(workspaceId, {
                message: 'Manual rescue checkpoint',
                ...(args.positionals.length > 0 ? { paths: args.positionals } : {}),
            }, { kind: 'rescue' });
        case 'rollback': {
            const targetCommitId = args.positionals[0];
            if (!targetCommitId) {
                throw new Error('rollback requires a target commit id');
            }
            return await history.rollback(workspaceId, {
                targetCommitId,
                ...(args.operationId ? { operationId: args.operationId } : {}),
                ...(args.force ? { force: true } : {}),
            }, { kind: 'rescue' });
        }
        case 'resume':
            return await history.resumeRollback(workspaceId);
        default:
            throw new Error(usage());
    }
}

function parseArgs(argv: string[]): ParsedArgs {
    const values = argv[0] === 'rescue' ? argv.slice(1) : argv;
    const command = values.shift() ?? '';
    const positionals: string[] = [];
    let dataRoot: string | undefined;
    let store: string | undefined;
    let workspaceId: string | undefined;
    let operationId: string | undefined;
    let limit = 100;
    let force = false;

    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value === '--force') {
            force = true;
            continue;
        }
        if (value === '--data-root' || value === '--store' || value === '--workspace' || value === '--operation-id' || value === '--limit') {
            const optionValue = values[index + 1];
            if (!optionValue) {
                throw new Error(`${value} requires a value`);
            }
            index += 1;
            if (value === '--data-root') dataRoot = optionValue;
            if (value === '--store') store = optionValue;
            if (value === '--workspace') workspaceId = optionValue;
            if (value === '--operation-id') operationId = optionValue;
            if (value === '--limit') limit = Number(optionValue);
            continue;
        }
        if (value?.startsWith('--')) {
            throw new Error(`Unknown option: ${value}`);
        }
        if (value) {
            positionals.push(value);
        }
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new Error('--limit must be an integer between 1 and 500');
    }
    return {
        command,
        positionals,
        limit,
        force,
        ...(dataRoot ? { dataRoot } : {}),
        ...(store ? { store } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(operationId ? { operationId } : {}),
    };
}

function resolveWorkspaceId(history: WorkspaceHistoryService, requested: string | undefined): string {
    if (requested) {
        return requested;
    }
    const workspaces = history.listWorkspaces();
    if (workspaces.length === 1) {
        return workspaces[0]!.id;
    }
    throw new Error(`--workspace is required when ${workspaces.length} workspaces are registered`);
}

function resolveCommit(value: string | undefined, head: string | null): string | null {
    if (!value || value === 'empty') {
        return null;
    }
    return value === 'head' ? head : value;
}

function defaultDataRoot(): string {
    const configured = process.env.SILLYTAVERN_DATA_ROOT?.trim() || process.env.DATA_ROOT?.trim();
    return path.resolve(configured || path.join(process.cwd(), 'data'));
}

function usage(): string {
    return [
        'Usage: node runtime/agent.cjs rescue <command> [options]',
        'Commands: workspaces, status, log, diff <from|empty> <to|head>, checkpoint [paths...], rollback <commit>, resume',
        'Options: --data-root <path>, --store <path>, --workspace <id>, --operation-id <id>, --limit <1-500>, --force',
    ].join('\n');
}

void runAgentCli(process.argv.slice(2))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
