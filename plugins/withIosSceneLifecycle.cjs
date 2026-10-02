const { IOSConfig, withAppDelegate, withInfoPlist } = require('expo/config-plugins');
const { createHash } = require('node:crypto');

const reviewedAppDelegateHash = '510895dbd9aec82fe5c8143baf7cc4740449433f4a59a7299dd3dc1c6a408aeb';

const factoryAnchor = '  var reactNativeFactory: RCTReactNativeFactory?\n';
const legacyStart = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;
const sceneStart = `#if os(iOS)
    if #available(iOS 13.0, *) {
      // SceneDelegate creates the window after this method returns.
    } else {
      startReactNative(in: UIWindow(frame: UIScreen.main.bounds))
    }
#elseif os(tvOS)
    startReactNative(in: UIWindow(frame: UIScreen.main.bounds))
#endif`;
const returnAnchor = `    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API`;
const startMethod = `    self.launchOptions = launchOptions
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func startReactNative(in window: UIWindow, launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) {
    guard let factory = reactNativeFactory else {
      fatalError("React Native factory was not initialized before scene connection")
    }
    self.window = window
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions ?? self.launchOptions)
  }

  // Linking API`;

function patchAppDelegate(source) {
  source = source.replace(/\r\n/g, '\n');
  if (source.includes('Workcube UIScene lifecycle v1')) return source;
  if (createHash('sha256').update(source).digest('hex') !== reviewedAppDelegateHash) {
    throw new Error('Unrecognized Expo AppDelegate; review the iOS scene lifecycle before building.');
  }
  if (source.split(factoryAnchor).length !== 2 || source.split(legacyStart).length !== 2 ||
      source.split(returnAnchor).length !== 2) {
    throw new Error('Unrecognized Expo AppDelegate; review the iOS scene lifecycle before building.');
  }
  return source
    .replace(factoryAnchor, `${factoryAnchor}  // Workcube UIScene lifecycle v1\n  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?\n`)
    .replace(legacyStart, sceneStart)
    .replace(returnAnchor, startMethod);
}

const sceneDelegate = `import UIKit
import React

@available(iOS 13.0, *)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      return
    }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.startReactNative(
      in: window,
      launchOptions: launchOptions(from: connectionOptions, fallback: appDelegate.launchOptions))
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      RCTLinkingManager.application(
        UIApplication.shared,
        open: context.url,
        options: [
          .sourceApplication: context.options.sourceApplication as Any,
          .annotation: context.options.annotation as Any,
          .openInPlace: context.options.openInPlace,
        ])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }

  private func launchOptions(
    from connectionOptions: UIScene.ConnectionOptions,
    fallback: [UIApplication.LaunchOptionsKey: Any]?
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    var options = fallback ?? [:]
    if let url = connectionOptions.urlContexts.first?.url {
      options[.url] = url
    }
    if let response = connectionOptions.notificationResponse {
      options[.remoteNotification] = response.notification.request.content.userInfo
    }
    if let shortcutItem = connectionOptions.shortcutItem {
      options[.shortcutItem] = shortcutItem
    }
    return options.isEmpty ? nil : options
  }
}
`;

function addSceneManifest(infoPlist) {
  const existing = infoPlist.UIApplicationSceneManifest;
  if (existing && JSON.stringify(existing) !== JSON.stringify(sceneManifest)) {
    throw new Error('Existing UIApplicationSceneManifest requires explicit review.');
  }
  return { ...infoPlist, UIApplicationSceneManifest: structuredClone(sceneManifest) };
}

const sceneManifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [{
      UISceneConfigurationName: 'Default Configuration',
      UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
    }],
  },
};

module.exports = config => {
  config = withAppDelegate(config, mod => {
    if (mod.modResults.language !== 'swift') throw new Error('UIScene lifecycle requires the reviewed Swift AppDelegate.');
    mod.modResults.contents = patchAppDelegate(mod.modResults.contents);
    return mod;
  });
  config = withInfoPlist(config, mod => {
    mod.modResults = addSceneManifest(mod.modResults);
    return mod;
  });
  return IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
    filePath: 'SceneDelegate.swift',
    contents: sceneDelegate,
    overwrite: true,
  });
};

Object.assign(module.exports, { addSceneManifest, patchAppDelegate, reviewedAppDelegateHash, sceneDelegate, sceneManifest });
