import { WriteEventEmitter } from '$lib/shared/events';
import type { UserWriteEvent } from './types';

export class UserWriteEventEmitter extends WriteEventEmitter<UserWriteEvent> {}
