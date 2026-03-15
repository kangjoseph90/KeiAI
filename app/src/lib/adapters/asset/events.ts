import { WriteEventEmitter } from '$lib/utils/events';
import type { AssetWriteEvent } from './types';

export class AssetWriteEventEmitter extends WriteEventEmitter<AssetWriteEvent> {}
