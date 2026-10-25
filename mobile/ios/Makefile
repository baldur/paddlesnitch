# The iPhone app. Every command CI runs is a target here, so local and CI
# never differ. See docs/features/ios-app.md.
#
#   make generate    regenerate Swift from mobile/contract/
#   make test        package tests + app tests on the newest simulator
#   make test-app IOS=17   app tests on an iOS 17 simulator
#   make lint
#   make open        generate the project and open it in Xcode
#   make run         build, install and launch the app in the simulator
#                    (SAMPLE=1 for the offline sample server)

PACKAGE := Packages/PaddleKit
IOS ?= latest
DERIVED := .build/DerivedData

.PHONY: generate project test test-packages test-app lint format open run clean

generate:
	swift run --package-path $(PACKAGE) -q contract-gen ../contract .

project:
	xcodegen generate --quiet

test: test-packages test-app

test-packages:
	swift test --package-path $(PACKAGE)

test-app: project
	set -o pipefail && xcodebuild test \
	  -project Paddlesnitch.xcodeproj -scheme Paddlesnitch \
	  -destination "platform=iOS Simulator,id=$$(scripts/simulator.sh $(IOS))" \
	  -derivedDataPath $(DERIVED) \
	  | xcbeautify

lint:
	swift format lint --strict --recursive App Tests $(PACKAGE)/Sources $(PACKAGE)/Tests $(PACKAGE)/Package.swift
	swiftlint lint --strict --quiet

format:
	swift format --in-place --recursive App Tests $(PACKAGE)/Sources $(PACKAGE)/Tests $(PACKAGE)/Package.swift

open: project
	open Paddlesnitch.xcodeproj

# Against paddlesnitch.com, so you can sign in with your own account.
run: project
	set -o pipefail && udid=$$(scripts/simulator.sh $(IOS)) \
	  && xcodebuild build -project Paddlesnitch.xcodeproj -scheme Paddlesnitch \
	    -destination "platform=iOS Simulator,id=$$udid" -derivedDataPath $(DERIVED) | xcbeautify --quiet \
	  && { xcrun simctl boot $$udid 2>/dev/null || true; } \
	  && { open -b com.apple.iphonesimulator 2>/dev/null || open "$$(xcode-select -p)/../Applications/DeviceHub.app"; } \
	  && xcrun simctl bootstatus $$udid >/dev/null \
	  && xcrun simctl install $$udid $(DERIVED)/Build/Products/Debug-iphonesimulator/Paddlesnitch.app \
	  && xcrun simctl launch $$udid com.paddlesnitch.app $(if $(SAMPLE),-SampleServer)

clean:
	rm -rf .build $(PACKAGE)/.build Paddlesnitch.xcodeproj
