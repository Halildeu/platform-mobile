// Re-export the native module. On web, it will be resolved to WorkcubePcmBackgroundModule.web.ts
// and on native platforms to WorkcubePcmBackgroundModule.ts
export { default } from './src/WorkcubePcmBackgroundModule';
export * from './src/WorkcubePcmBackground.types';
