# The iPhone app. Every command CI runs is a target here, so local and CI
# never differ. See docs/features/ios-app.md.
#
#   make generate    regenerate Swift from mobile/contract/
#   make test        package tests + app tests on the newest simulator
#   make test-app IOS=17   app tests on an iOS 17 simulator
#   make test-app SHARD=1  one half of the app tests (CI runs both at once)
#   make lint
#   make open        generate the project and open it in Xcode
#   make run         build, install and launch the app in the simulator
#                    (SAMPLE=1 for the offline sample server)

PACKAGE := Packages/PaddleKit
IOS ?= latest
DERIVED := .build/DerivedData

.PHONY: generate project test test-packages test-app check-shards lint format open run clean

generate:
	swift run --package-path $(PACKAGE) -q contract-gen ../contract .

project:
	xcodegen generate --quiet

test: test-packages test-app

test-packages:
	swift test --package-path $(PACKAGE)

# CI runs the app tests in two jobs at once per iOS version. Shard 1 is
# these classes, about half the time on CI (LargeTextTests alone is ~14 of
# ~47 minutes); shard 2 is every other class, so a new one is never left
# out. No SHARD: all of them. Rebalance from the per-test times in a CI log
# when one job runs much longer than the other.
SHARD_1 := LargeTextTests AccountTests PendingSummaryTests
ifeq ($(SHARD),1)
  SHARD_TESTS := $(foreach c,$(SHARD_1),-only-testing:PaddlesnitchUITests/$(c))
else ifeq ($(SHARD),2)
  SHARD_TESTS := $(foreach c,$(SHARD_1),-skip-testing:PaddlesnitchUITests/$(c))
endif

# A test that hangs fails after 6 minutes (with a spindump in the results)
# instead of running into CI's job timeout. The slowest passes in about 3.5 minutes on CI.
test-app: project
	@case "$(SHARD)" in ""|1|2) ;; *) echo "SHARD is 1, 2 or unset"; exit 1;; esac
	set -o pipefail && xcodebuild test \
	  -project Paddlesnitch.xcodeproj -scheme Paddlesnitch \
	  -destination "platform=iOS Simulator,id=$$(scripts/simulator.sh $(IOS))" \
	  -derivedDataPath $(DERIVED) \
	  -test-timeouts-enabled YES -default-test-execution-time-allowance 360 \
	  $(SHARD_TESTS) \
	  | xcbeautify

# Every shard-1 name is a test class (every one subclasses AppTestCase,
# which has no tests itself): -only-testing with a misspelt one, or with
# AppTestCase, runs nothing and passes.
check-shards:
	@for c in $(SHARD_1); do \
	  grep -Eq "^(final )?class $$c *: *AppTestCase([^A-Za-z0-9_]|$$)" Tests/UI/*.swift \
	    || { echo "SHARD_1: no test class $$c in Tests/UI"; exit 1; }; \
	done

lint: check-shards
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
