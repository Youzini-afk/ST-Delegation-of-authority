import type { TriviumInsertRequest } from '@stdo/shared-types';

export interface CoreTriviumOpenRequestPayload {
    dbPath: string;
    dim?: number;
    dtype?: TriviumInsertRequest['dtype'];
    syncMode?: TriviumInsertRequest['syncMode'];
    storageMode?: TriviumInsertRequest['storageMode'];
}

export function buildTriviumOpenPayload(dbPath: string, request: {
    dim?: number;
    dtype?: TriviumInsertRequest['dtype'];
    syncMode?: TriviumInsertRequest['syncMode'];
    storageMode?: TriviumInsertRequest['storageMode'];
}): CoreTriviumOpenRequestPayload {
    return {
        dbPath,
        ...(request.dim === undefined ? {} : { dim: request.dim }),
        ...(request.dtype === undefined ? {} : { dtype: request.dtype }),
        ...(request.syncMode === undefined ? {} : { syncMode: request.syncMode }),
        ...(request.storageMode === undefined ? {} : { storageMode: request.storageMode }),
    };
}
