Pod::Spec.new do |s|
  s.name           = 'CallObserver'
  s.version        = '0.1.0'
  s.summary        = 'Eye Rest & Move: is the user on a phone/VoIP call right now (CXCallObserver)'
  s.description    = 'Local Expo module used by the break screen (SPEC G5, iOS partial).'
  s.license        = 'UNLICENSED'
  s.author         = 'Eye Rest & Move'
  s.homepage       = 'https://example.invalid/eye-app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CallKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
