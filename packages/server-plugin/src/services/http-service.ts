import type { ControlHttpFetchOpenRequest, ControlHttpFetchOpenResponse, HttpFetchRequest, HttpFetchResponse } from '@stdo/shared-types';
import type { UserContext } from '../types.js';
import { CoreService } from './core-service.js';

export type HttpFetchInput = HttpFetchRequest;

export class HttpService {
    constructor(private readonly core: CoreService) {}

    async fetch(_user: UserContext, input: HttpFetchInput): Promise<HttpFetchResponse> {
        return await this.core.fetchHttp(input);
    }

    async openFetch(_user: UserContext, input: ControlHttpFetchOpenRequest): Promise<ControlHttpFetchOpenResponse> {
        return await this.core.openHttpFetch(input);
    }
}
