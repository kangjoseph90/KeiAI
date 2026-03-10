import { WriteEventEmitter } from '$lib/shared/events';
import type { DatabaseWriteEvent } from './types';

export class DatabaseWriteEventEmitter extends WriteEventEmitter<DatabaseWriteEvent> {}
