Pod::Spec.new do |s|
  s.name           = 'HolySicTouch'
  s.version        = '1.0.0'
  s.summary        = 'HolySic: touch guard for sliders inside scroll views and sheets'
  s.description    = 'Keeps a drag on a slider from also scrolling the page or pulling the sheet.'
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
