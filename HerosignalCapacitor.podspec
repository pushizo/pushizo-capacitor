require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'HerosignalCapacitor'
  s.version          = package['version']
  s.summary          = package['description']
  s.license          = package['license']
  s.homepage         = package['homepage']
  s.author           = package['author']
  s.source           = { :git => package['repository']['url'], :tag => s.version.to_s }
  s.source_files     = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  # Monorepo/yerel geliştirmede uygulama Podfile'ına: pod 'HeroSignal', :path => '<repo>/sdk/ios'
  s.dependency 'HeroSignal', '~> 0.1'
  s.swift_version    = '5.9'
end
