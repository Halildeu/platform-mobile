import { NativeModule, requireNativeModule } from 'expo';

declare class WorkcubePcmBackgroundModule extends NativeModule<{}> {
  isAvailable(): boolean;
  start(): Promise<void>;
  stop(): void;
}

export default requireNativeModule<WorkcubePcmBackgroundModule>('WorkcubePcmBackground');
