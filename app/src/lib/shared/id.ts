
// Generate PocketBase compatible random IDs (15 chars, lowercase letters and digits)
export function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const randomValues = new Uint32Array(15);
	crypto.getRandomValues(randomValues);

	let id = '';
	for (let i = 0; i < 15; i++) {
		id += chars[randomValues[i] % chars.length];
	}
	return id;
}