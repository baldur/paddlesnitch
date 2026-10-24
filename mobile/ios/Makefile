# The iPhone app. Every command CI runs is a target here, so local and CI
# never differ. See docs/features/ios-app.md.
#
#   make generate    regenerate Swift from mobile/contract/
#   make test        package tests + app tests on the newest simulator
#   make test-app IOS=17   app tests on an iOS 17 simulator
#   make lint
#   make open        generate the project and open it in Xcode

PACKAGE := Packages/PaddleKit
IOS ?= latest
DERIVED := .build/DerivedData

.PHONY: generate project test test-packages test-app lint format open clean

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
	  CODE_SIGNING_ALLOWED=NO \
	  | xcbeautify

lint:
	swift format lint --strict --recursive App Tests $(PACKAGE)/Sources $(PACKAGE)/Tests $(PACKAGE)/Package.swift
	swiftlint lint --strict --quiet

format:
	swift format --in-place --recursive App Tests $(PACKAGE)/Sources $(PACKAGE)/Tests $(PACKAGE)/Package.swift

open: project
	open Paddlesnitch.xcodeproj

clean:
	rm -rf .build $(PACKAGE)/.build Paddlesnitch.xcodeproj
