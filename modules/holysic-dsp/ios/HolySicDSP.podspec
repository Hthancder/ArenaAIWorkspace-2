Pod::Spec.new do |s|
  s.name           = 'HolySicDSP'
  s.version        = '1.0.0'
  s.summary        = 'HolySic: native real-time DSP (10-band EQ, bass, reverb, width, 8D), spectrum and the MIDI renderer'
  s.description    = 'Installs an MTAudioProcessingTap on the AVPlayer used by expo-audio and processes the PCM in C, with a vDSP FFT for the visualizer.'
  s.author         = 'HolySic'
  s.homepage       = 'https://github.com/Hthancder/ArenaAIWorkspace-2'
  s.license        = 'GPL-3.0-only'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'
  s.frameworks     = 'AVFoundation', 'MediaToolbox', 'Accelerate'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'GCC_OPTIMIZATION_LEVEL' => '3'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
