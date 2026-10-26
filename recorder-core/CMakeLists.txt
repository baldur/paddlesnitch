# The recorder core for CMake builds: the Android app pulls it in with
#   add_subdirectory(<path>/recorder-core recorder-core)
#   target_link_libraries(<its JNI library> PRIVATE recorder_core)
# Built on its own (cmake -S recorder-core -B build && ctest --test-dir build)
# it also runs the fixtures.
cmake_minimum_required(VERSION 3.18)
project(recorder_core C)

add_library(recorder_core STATIC src/recorder_core.c)
target_include_directories(recorder_core PUBLIC include)
set_target_properties(recorder_core PROPERTIES C_STANDARD 99 C_STANDARD_REQUIRED ON C_EXTENSIONS OFF
                                               POSITION_INDEPENDENT_CODE ON)
# No fused multiply-add (fixtures/fp_contract). The source already says so to
# clang; this covers gcc too.
target_compile_options(recorder_core PRIVATE -ffp-contract=off)
if(NOT WIN32)
    target_link_libraries(recorder_core PUBLIC m)
endif()

if(CMAKE_SOURCE_DIR STREQUAL PROJECT_SOURCE_DIR)
    enable_testing()
    add_executable(run_fixtures test/run_fixtures.c)
    target_link_libraries(run_fixtures PRIVATE recorder_core)
    file(GLOB fixture_dirs LIST_DIRECTORIES true ${PROJECT_SOURCE_DIR}/fixtures/*)
    list(FILTER fixture_dirs EXCLUDE REGEX "README")
    add_test(NAME fixtures COMMAND run_fixtures ${fixture_dirs})
endif()
