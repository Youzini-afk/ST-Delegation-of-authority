const DEFAULT_TRIVIUM_CHUNK_ITEMS = 128;
const DEFAULT_TRIVIUM_CHUNK_BYTES = 256 * 1024;
const UTF8_ENCODER = new TextEncoder();
export function splitAuthorityItemsIntoChunks(items, options = {}) {
    const maxItemsPerChunk = normalizePositiveInteger(options.maxItemsPerChunk, DEFAULT_TRIVIUM_CHUNK_ITEMS, 'maxItemsPerChunk');
    const maxBytesPerChunk = normalizePositiveInteger(options.maxBytesPerChunk, DEFAULT_TRIVIUM_CHUNK_BYTES, 'maxBytesPerChunk');
    if (items.length === 0) {
        return [];
    }
    const chunks = [];
    let current = [];
    let currentBytes = 2;
    let itemOffset = 0;
    for (const item of items) {
        const itemBytes = estimateJsonBytes(item);
        if (itemBytes + 2 > maxBytesPerChunk) {
            throw new Error(`Chunk item exceeds maxBytesPerChunk (${itemBytes} > ${maxBytesPerChunk})`);
        }
        const nextBytes = current.length === 0 ? currentBytes + itemBytes : currentBytes + itemBytes + 1;
        if (current.length > 0 && (current.length >= maxItemsPerChunk || nextBytes > maxBytesPerChunk)) {
            chunks.push({
                chunkIndex: chunks.length,
                itemOffset,
                itemCount: current.length,
                estimatedBytes: currentBytes,
                items: current,
            });
            itemOffset += current.length;
            current = [];
            currentBytes = 2;
        }
        current.push(item);
        currentBytes = current.length === 1 ? 2 + itemBytes : currentBytes + itemBytes + 1;
    }
    if (current.length > 0) {
        chunks.push({
            chunkIndex: chunks.length,
            itemOffset,
            itemCount: current.length,
            estimatedBytes: currentBytes,
            items: current,
        });
    }
    return chunks;
}
function normalizePositiveInteger(value, fallback, label) {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
    return value;
}
function estimateJsonBytes(value) {
    return UTF8_ENCODER.encode(JSON.stringify(value)).length;
}
//# sourceMappingURL=chunking.js.map