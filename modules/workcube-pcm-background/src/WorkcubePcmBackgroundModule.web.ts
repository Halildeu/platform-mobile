import { registerWebModule, NativeModule } from 'expo';

// WorkcubePcmBackgroundModule is not available on the web platform.
class WorkcubePcmBackgroundModule extends NativeModule {}

export default registerWebModule(WorkcubePcmBackgroundModule, 'WorkcubePcmBackground');
