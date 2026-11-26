Pod::Spec.new do |s|
  s.name           = 'HolySicWidget'
  s.version        = '1.0.0'
  s.summary        = 'HolySic: share now playing with the WidgetKit extension'
  s.description    = 'Writes the now-playing snapshot into the HolySic App Group and reloads widget timelines.'
  s.author         = 'HolySic'
  s.homepage       = 'https://github.com/Hthancder/ArenaAIWorkspace-2'
  s.license        = 'GPL-3.0-only'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
