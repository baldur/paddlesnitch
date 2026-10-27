# Host build of the recorder core and its fixtures. `make test` is what CI
# runs; the same fixtures run in the firmware's native tests, both apps' unit
# tests and the WASM build.
CC      ?= cc
CFLAGS  ?= -std=c99 -O2 -Wall -Wextra -Wpedantic -Wconversion -Werror

BUILD = build
FIXTURES = $(sort $(dir $(wildcard fixtures/*/calls.csv)))

.PHONY: test sanitize fixtures wasm clean
test: $(BUILD)/run_fixtures
	$(BUILD)/run_fixtures $(FIXTURES)

# The same, under the address and undefined-behaviour sanitizers.
sanitize: | $(BUILD)
	$(CC) $(CFLAGS) -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all \
	    -Iinclude src/recorder_core.c test/run_fixtures.c -lm -o $(BUILD)/run_fixtures_san
	$(BUILD)/run_fixtures_san $(FIXTURES)

# Rewrites the golden files from the core. Review every changed line before
# committing: a changed byte here changes every recording.
fixtures: $(BUILD)/run_fixtures
	$(BUILD)/run_fixtures --write $(FIXTURES)

# The server's build (WebAssembly), and the fixtures replayed through it
# under Node. Needs wasi-sdk 25: make wasm WASI_SDK=/path/to/wasi-sdk-25.0.
# wasm has no fused multiply-add, but -ffp-contract=off keeps it so if it
# ever gets one.
WASI_SDK ?= $(error set WASI_SDK to a wasi-sdk 25 folder)
wasm: $(BUILD)/recorder_core.wasm
	node wasm/run_fixtures.mjs $< $(FIXTURES)

$(BUILD)/recorder_core.wasm: src/recorder_core.c wasm/recorder_core_wasm.c include/recorder_core.h | $(BUILD)
	$(WASI_SDK)/bin/clang --target=wasm32-wasip1 --sysroot=$(WASI_SDK)/share/wasi-sysroot \
	    $(CFLAGS) -ffp-contract=off -mexec-model=reactor \
	    -Iinclude src/recorder_core.c wasm/recorder_core_wasm.c -o $@

$(BUILD)/run_fixtures: src/recorder_core.c test/run_fixtures.c include/recorder_core.h | $(BUILD)
	$(CC) $(CFLAGS) -Iinclude src/recorder_core.c test/run_fixtures.c -lm -o $@

$(BUILD):
	mkdir -p $@

clean:
	rm -rf $(BUILD)
