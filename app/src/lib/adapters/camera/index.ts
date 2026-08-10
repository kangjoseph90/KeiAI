import { WebCameraAdapter } from './web';

export type {
    CameraAdapter,
    CameraCapture,
    CameraMode,
    CameraVideoRecording,
    StartCameraOptions
} from './types';

export const appCamera = new WebCameraAdapter();
