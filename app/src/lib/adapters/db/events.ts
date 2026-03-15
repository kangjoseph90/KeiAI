import { WriteEventEmitter } from '$lib/utils/events';
import type { DatabaseWriteEvent } from './types';

export class DatabaseWriteEventEmitter extends WriteEventEmitter<DatabaseWriteEvent> {}
