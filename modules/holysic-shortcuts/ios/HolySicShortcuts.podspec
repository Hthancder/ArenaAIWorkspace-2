Pod::Spec.new do |s|
  s.name           = 'HolySicShortcuts'
  s.version        = '1.0.0'
  s.summary        = 'HolySic: Home Screen quick actions and Spotlight search'
  s.description    = 'Publishes dynamic UIApplicationShortcutItems and forwards the chosen one to JS.'
  s.author         = 'HolySic'
  s.homepage       = 'https://github.com/Hthancder/ArenaAIWorkspace-2'
  s.license        = 'GPL-3.0-only'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreSpotlight', 'UniformTypeIdentifiers'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
