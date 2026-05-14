import { WriteEventEmitter } from '$lib/utils/events';
import type { MultiWriteEvent } from './types';

export class MultiWriteEventEmitter extends WriteEventEmitter<MultiWriteEvent> {}
