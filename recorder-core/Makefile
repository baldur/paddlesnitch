# Host build of the recorder core and its fixtures. `make test` is what CI
# runs; the same fixtures run in the firmware's native tests, both apps' unit
# tests and the WASM build.
CC      ?= cc
CFLAGS  ?= -std=c99 -O2 -Wall -Wextra -Wpedantic -Wconversion -Werror

BUILD = build
FIXTURES = $(sort $(dir $(wildcard fixtures/*/calls.csv)))
# The phone layer's (recorder_phone.h): phones only, so not in the WASM build.
PHONE_FIXTURES = $(sort $(dir $(wildcard fixtures/*/phone.csv)))
# The phone layer through test/phone_seen.c, so the runner sees every call
# it makes to the core.
CORE_SRC = src/recorder_core.c src/stroke.c src/recorder_replay.c
SRC = $(CORE_SRC) test/phone_seen.c
HDR = include/recorder_core.h include/recorder_phone.h src/recorder_phone.c src/stroke.h

.PHONY: test sanitize fixtures wasm clean
test: $(BUILD)/run_fixtures $(BUILD)/stroke_known
	$(BUILD)/run_fixtures $(FIXTURES) $(PHONE_FIXTURES)
	$(BUILD)/stroke_known

# The same, under the address and undefined-behaviour sanitizers.
sanitize: | $(BUILD)
	$(CC) $(CFLAGS) -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all \
	    -Iinclude $(SRC) test/run_fixtures.c -lm -o $(BUILD)/run_fixtures_san
	$(BUILD)/run_fixtures_san $(FIXTURES) $(PHONE_FIXTURES)
	$(CC) $(CFLAGS) -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all \
	    -Iinclude $(CORE_SRC) test/stroke_known.c -lm -o $(BUILD)/stroke_known_san
	$(BUILD)/stroke_known_san

# Rewrites the golden files from the core. Review every changed line before
# committing: a changed byte here changes every recording.
fixtures: $(BUILD)/run_fixtures
	$(BUILD)/run_fixtures --write $(FIXTURES) $(PHONE_FIXTURES)

# The server's build (WebAssembly), and the fixtures replayed through it
# under Node. Needs wasi-sdk 25: make wasm WASI_SDK=/path/to/wasi-sdk-25.0.
# wasm has no fused multiply-add, but -ffp-contract=off keeps it so if it
# ever gets one.
WASI_SDK ?= $(error set WASI_SDK to a wasi-sdk 25 folder)
wasm: $(BUILD)/recorder_core.wasm
	node wasm/run_fixtures.mjs $< $(FIXTURES)

$(BUILD)/recorder_core.wasm: src/recorder_core.c src/stroke.c src/recorder_replay.c src/stroke.h wasm/recorder_core_wasm.c include/recorder_core.h | $(BUILD)
	$(WASI_SDK)/bin/clang --target=wasm32-wasip1 --sysroot=$(WASI_SDK)/share/wasi-sysroot \
	    $(CFLAGS) -ffp-contract=off -mexec-model=reactor \
	    -Iinclude src/recorder_core.c src/stroke.c src/recorder_replay.c wasm/recorder_core_wasm.c -o $@

$(BUILD)/run_fixtures: $(SRC) test/run_fixtures.c $(HDR) | $(BUILD)
	$(CC) $(CFLAGS) -Iinclude $(SRC) test/run_fixtures.c -lm -o $@

$(BUILD)/stroke_known: $(CORE_SRC) test/stroke_known.c $(HDR) | $(BUILD)
	$(CC) $(CFLAGS) -Iinclude $(CORE_SRC) test/stroke_known.c -lm -o $@

$(BUILD):
	mkdir -p $@

clean:
	rm -rf $(BUILD)
