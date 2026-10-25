# Host build of the recorder core and its fixtures. `make test` is what CI
# runs; the same fixtures run in the firmware's native tests, both apps' unit
# tests and the WASM build.
CC      ?= cc
CFLAGS  ?= -std=c99 -O2 -Wall -Wextra -Wpedantic -Wconversion -Werror

BUILD = build
FIXTURES = $(sort $(dir $(wildcard fixtures/*/calls.csv)))

.PHONY: test sanitize fixtures clean
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

$(BUILD)/run_fixtures: src/recorder_core.c test/run_fixtures.c include/recorder_core.h | $(BUILD)
	$(CC) $(CFLAGS) -Iinclude src/recorder_core.c test/run_fixtures.c -lm -o $@

$(BUILD):
	mkdir -p $@

clean:
	rm -rf $(BUILD)
