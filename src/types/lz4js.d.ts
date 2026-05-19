declare module 'lz4js' {
	export function decompress(input: Uint8Array): Uint8Array;
	export function decompressFrame(input: Uint8Array): Uint8Array;
}
