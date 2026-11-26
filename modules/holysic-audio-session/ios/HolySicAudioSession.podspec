Pod::Spec.new do |s|
  s.name           = 'HolySicAudioSession'
  s.version        = '1.0.0'
  s.summary        = 'HolySic: output route and sample-rate matching for bit-perfect playback'
  s.description    = 'Reports the AVAudioSession output route and asks the hardware to run at the song sample rate.'
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
