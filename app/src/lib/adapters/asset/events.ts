import { WriteEventEmitter } from '$lib/shared/events';
import type { AssetWriteEvent } from './types';

export class AssetWriteEventEmitter extends WriteEventEmitter<AssetWriteEvent> {}
