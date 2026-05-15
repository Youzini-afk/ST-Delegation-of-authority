export function contentToBytes(content, encoding) {
    if (encoding === 'base64') {
        return base64ToBytes(content);
    }
    return new TextEncoder().encode(content);
}
export function base64ToBytes(content) {
    const binary = globalThis.atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}
export function bytesToBase64(bytes) {
    const segments = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        const chunk = bytes.subarray(offset, offset + 0x8000);
        let binary = '';
        for (let index = 0; index < chunk.length; index += 1) {
            binary += String.fromCharCode(chunk[index] ?? 0);
        }
        segments.push(binary);
    }
    return globalThis.btoa(segments.join(''));
}
export function bytesToContent(bytes, encoding) {
    if (encoding === 'base64') {
        return bytesToBase64(bytes);
    }
    return bytesToUtf8(bytes);
}
export function bytesToHttpContent(bytes, encoding) {
    if (encoding === 'base64') {
        return bytesToBase64(bytes);
    }
    return new TextDecoder('utf-8').decode(bytes);
}
export function bytesToUtf8(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`invalid_utf8_private_file: ${message}`);
    }
}
//# sourceMappingURL=encoding.js.map