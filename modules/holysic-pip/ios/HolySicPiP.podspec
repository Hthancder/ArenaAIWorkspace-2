Pod::Spec.new do |s|
  s.name           = 'HolySicPiP'
  s.version        = '1.0.0'
  s.summary        = 'HolySic: Picture in Picture with the current lyric line'
  s.description    = 'Draws a now-playing / lyrics card into an AVSampleBufferDisplayLayer and floats it with AVPictureInPictureController; times itself from the playing AVPlayer.'
  s.author         = 'HolySic'
  s.homepage       = 'https://github.com/Hthancder/ArenaAIWorkspace-2'
  s.license        = 'GPL-3.0-only'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVKit', 'AVFoundation', 'CoreMedia', 'CoreVideo', 'CoreImage'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
