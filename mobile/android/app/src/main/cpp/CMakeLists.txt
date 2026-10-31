# The app's JNI library over the shared recorder core (recorder-core/,
# docs/features/on-device-metrics.md). The NDK build goes in the APK; the
# unit tests build the same files for the host (app/build.gradle.kts,
# hostRecorder) and replay recorder-core/fixtures through them.
cmake_minimum_required(VERSION 3.18)
project(paddlesnitch_recorder C)

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../recorder-core recorder-core)

add_library(recorder SHARED recorder_jni.c)
target_link_libraries(recorder PRIVATE recorder_core)
set_target_properties(recorder PROPERTIES C_STANDARD 99)
if(NOT ANDROID)
    # The host build for the unit tests: jni.h copied from the NDK (hostRecorder).
    target_include_directories(recorder PRIVATE ${HOST_JNI_INCLUDE})
endif()
