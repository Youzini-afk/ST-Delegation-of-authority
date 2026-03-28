import { AUTHORITY_PLUGIN_ID } from './constants.js';
import { registerRoutes } from './routes.js';

export const info = {
    id: AUTHORITY_PLUGIN_ID,
    name: 'ST Authority',
    description: 'Authority security center and delegation platform for SillyTavern extensions.',
};

export async function init(router: any): Promise<void> {
    const runtime = registerRoutes(router);
    void runtime.install.bootstrap();
}
