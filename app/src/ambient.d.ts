declare module 'fractional-indexing' {
	export function generateKeyBetween(a: string | null, b: string | null): string;
	export function generateNKeysBetween(a: string | null, b: string | null, n: number): string[];
}
