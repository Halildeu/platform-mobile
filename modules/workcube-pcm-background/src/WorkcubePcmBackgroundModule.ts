import { NativeModule, requireNativeModule } from 'expo';
import type { PcmLifecycleStream } from '../../../src/audio/pcmLifecycle';

declare class WorkcubePcmBackgroundModule extends NativeModule<{
  onCaptureStopped: (event: { id: string; streamId: string; reason: string }) => void;
}> {
  isAvailable(): boolean;
  lifecycleVersion(): number;
  prepare(stream: PcmLifecycleStream): string;
  start(id: string): Promise<void>;
  startCapture(id: string): Promise<void>;
  release(id: string): void;
  captureState(stream: PcmLifecycleStream): { id: string; reason: string } | null;
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
