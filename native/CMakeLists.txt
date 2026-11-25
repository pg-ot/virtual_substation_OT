cmake_minimum_required(VERSION 3.24)
project(substation_native LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include(FetchContent)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(CONFIG_IEC61850_L2_GOOSE ${UNIX} CACHE BOOL "Enable raw Ethernet GOOSE")
set(CONFIG_IEC61850_L2_SMV ${UNIX} CACHE BOOL "Enable raw Ethernet Sampled Values")
set(CONFIG_IEC61850_R_GOOSE OFF CACHE BOOL "" FORCE)
set(CONFIG_IEC61850_R_SMV OFF CACHE BOOL "" FORCE)
FetchContent_Declare(iec61850
  URL https://codeload.github.com/mz-automation/libiec61850/tar.gz/refs/tags/v1.6.2.1
  URL_HASH SHA256=a0c970b00ccd8dd1145c2a7f5369a58ea0916cc2dbcbcbfe9ba0975e72afb514
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_Declare(iec104
  URL https://codeload.github.com/mz-automation/lib60870/tar.gz/refs/tags/v2.4.1
  URL_HASH SHA256=d5708b9885c2c068ac9d9bae4696a624bd1d1d6645a1b1a9261c00274bc36c3a
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  SOURCE_SUBDIR lib60870-C)
FetchContent_Declare(dnp3
  URL https://codeload.github.com/dnp3/opendnp3/tar.gz/refs/tags/3.1.2
  URL_HASH SHA256=183cc29222c3cb58099a9753c43defed5cb8677fda985c3f88e38b5c19a36ff2
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
set(CONFIG_MAXIMUM_TCP_CLIENT_CONNECTIONS 16 CACHE STRING "Maximum concurrent IEC 61850 server clients")
FetchContent_MakeAvailable(iec61850)
set(BUILD_HAL OFF CACHE BOOL "" FORCE)
set(BUILD_COMMON OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(iec104)
set(DNP3_STATIC_LIBS ON CACHE BOOL "" FORCE)
option(LAB_DNP3 "Build DNP3 devices" ON)
if(LAB_DNP3)
  FetchContent_MakeAvailable(dnp3)
endif()

add_library(station-mms STATIC mms.cpp)
target_include_directories(station-mms PUBLIC
  ${iec61850_SOURCE_DIR}/src/iec61850/inc
  ${iec61850_SOURCE_DIR}/src/mms/inc
  ${iec61850_SOURCE_DIR}/src/common/inc
  ${iec61850_SOURCE_DIR}/src/sampled_values
  ${iec61850_SOURCE_DIR}/src/logging
  ${iec61850_SOURCE_DIR}/src/r_session
  ${iec61850_SOURCE_DIR}/hal/inc)
target_link_libraries(station-mms PUBLIC iec61850)

add_library(plant-mms STATIC plant.cpp)
target_link_libraries(plant-mms PUBLIC station-mms)
add_executable(plant-ied plant_ied.cpp)
target_link_libraries(plant-ied PRIVATE plant-mms)
add_executable(plant-read plant_read.cpp)
target_link_libraries(plant-read PRIVATE plant-mms)

find_package(Java REQUIRED COMPONENTS Runtime)
set(model_dir "${CMAKE_CURRENT_BINARY_DIR}/model")
set(scl "${CMAKE_CURRENT_SOURCE_DIR}/feeder.cid")
set(generator "${iec61850_SOURCE_DIR}/tools/model_generator/genmodel.jar")
file(MAKE_DIRECTORY "${model_dir}")
add_custom_command(
  OUTPUT "${model_dir}/feeder_model.c" "${model_dir}/feeder_model.h"
  COMMAND "${Java_JAVA_EXECUTABLE}" -jar "${generator}" "${scl}" -out feeder_model
  DEPENDS "${scl}" "${generator}"
  WORKING_DIRECTORY "${model_dir}"
  VERBATIM)
add_library(feeder-model STATIC "${model_dir}/feeder_model.c")
target_include_directories(feeder-model PUBLIC "${model_dir}")
target_link_libraries(feeder-model PUBLIC station-mms)

add_executable(feeder-ied feeder_ied.cpp)
target_link_libraries(feeder-ied PRIVATE feeder-model plant-mms)
add_executable(protection-settings-regression EXCLUDE_FROM_ALL protection_settings_regression.cpp)
if(CONFIG_IEC61850_L2_SMV)
  add_executable(merging-unit merging_unit.cpp)
  target_link_libraries(merging-unit PRIVATE plant-mms)
  add_executable(sv-receiver-regression EXCLUDE_FROM_ALL sv_receiver_regression.cpp sv_receiver.cpp)
  target_link_libraries(sv-receiver-regression PRIVATE station-mms)
  target_sources(feeder-ied PRIVATE sv_receiver.cpp)
  target_compile_definitions(feeder-ied PRIVATE LAB_SV)
endif()
add_executable(station-client station_client.cpp)
target_link_libraries(station-client PRIVATE station-mms)
add_executable(breaker-ied breaker_ied.cpp)
target_link_libraries(breaker-ied PRIVATE plant-mms)
add_executable(breaker-read breaker_read.cpp)
target_link_libraries(breaker-read PRIVATE plant-mms)
if(CONFIG_IEC61850_L2_GOOSE)
  target_compile_definitions(feeder-ied PRIVATE LAB_GOOSE)
  add_library(goose-receiver STATIC goose_peer.cpp)
  target_include_directories(goose-receiver PRIVATE ${iec61850_SOURCE_DIR}/src/goose)
  target_link_libraries(goose-receiver PUBLIC feeder-model)
  add_executable(goose-peer goose_main.cpp)
  target_link_libraries(goose-peer PRIVATE goose-receiver)
  target_compile_definitions(breaker-ied PRIVATE LAB_GOOSE)
  target_link_libraries(breaker-ied PRIVATE goose-receiver)
endif()

add_executable(telecontrol104 telecontrol104.cpp)
target_include_directories(telecontrol104 PRIVATE ${iec104_SOURCE_DIR}/lib60870-C/src/inc/api)
target_link_libraries(telecontrol104 PRIVATE lib60870 station-mms)

add_executable(iec104-command-probe EXCLUDE_FROM_ALL iec104_command_probe.cpp)
target_include_directories(iec104-command-probe PRIVATE ${iec104_SOURCE_DIR}/lib60870-C/src/inc/api)
target_link_libraries(iec104-command-probe PRIVATE lib60870 station-mms)

if(LAB_DNP3)
  add_executable(telecontrol-dnp3 telecontrol_dnp3.cpp)
  target_link_libraries(telecontrol-dnp3 PRIVATE station-mms opendnp3)
  add_executable(dnp3-selection-probe EXCLUDE_FROM_ALL dnp3-selection-probe.cpp)
  target_include_directories(dnp3-selection-probe PRIVATE ${dnp3_SOURCE_DIR}/cpp/lib/src)
  target_link_libraries(dnp3-selection-probe PRIVATE opendnp3 ser4cpp)
  if(UNIX)
    add_executable(dnp3-selection-network-probe EXCLUDE_FROM_ALL dnp3-selection-network-probe.cpp)
    target_include_directories(dnp3-selection-network-probe PRIVATE ${dnp3_SOURCE_DIR}/cpp/lib/src)
    target_link_libraries(dnp3-selection-network-probe PRIVATE opendnp3 ser4cpp)
  endif()
endif()
