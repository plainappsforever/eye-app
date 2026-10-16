import CallKit
import ExpoModulesCore

/// SPEC G5 (iOS partial): while the app is open, tell whether a phone or VoIP call (any app that
/// reports calls to CallKit, e.g. WhatsApp) is going on. iOS gives apps no way to observe calls in
/// the background, so scheduled reminders are not held (V2_LOG P3 L11 row).
public class CallObserverModule: Module {
  private let observer = CXCallObserver()

  public func definition() -> ModuleDefinition {
    Name("CallObserver")

    AsyncFunction("isInCall") { () -> Bool in
      return self.observer.calls.contains { !$0.hasEnded }
    }.runOnQueue(.main)
  }
}
