import { NativeModule, requireNativeModule } from 'expo';

declare class WorkcubePcmBackgroundModule extends NativeModule<{}> {
  isAvailable(): boolean;
  start(): Promise<void>;
  stop(): void;
}

let nativeModule: WorkcubePcmBackgroundModule | null = null;
try {
  nativeModule = requireNativeModule<WorkcubePcmBackgroundModule>('WorkcubePcmBackground');
} catch {
  // A missing native module must never blank the meeting screen. The caller
  // exposes the unavailable state and refuses background capture.
}

export default nativeModule;
