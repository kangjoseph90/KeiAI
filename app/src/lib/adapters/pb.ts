import PocketBase, { BaseAuthStore } from 'pocketbase';
import { PB_URL } from '$lib/config';

// AuthService owns user × server persistence; PocketBase only holds the active session in memory.
export const pb = new PocketBase(PB_URL, new BaseAuthStore());
