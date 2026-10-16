require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'PushizoCapacitor'
  s.version          = package['version']
  s.summary          = 'Pushizo Capacitor eklentisi (iOS köprüsü)'
  s.description      = package['description']
  s.license          = package['license']
  s.homepage         = package['homepage']
  s.author           = package['author']
  s.source           = { :git => package['repository']['url'], :tag => s.version.to_s }
  s.source_files     = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.swift_version    = '5.9'
  s.dependency 'Capacitor'
  # Monorepo içinde uygulama Podfile'ında: pod 'Pushizo', :path => '<repo>/sdk/ios'
  s.dependency 'Pushizo', '~> 0.1'
end
