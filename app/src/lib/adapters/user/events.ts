import { WriteEventEmitter } from '$lib/utils/events';
import type { UserWriteEvent } from './types';

export class UserWriteEventEmitter extends WriteEventEmitter<UserWriteEvent> {}
