cmake_minimum_required(VERSION 3.24)

set(archive_dir "${CMAKE_CURRENT_LIST_DIR}/archives")
if(DEFINED LAB_DEPS_INIT_FILE)
  if(NOT DEFINED LAB_DEPS_SOURCE_DIR)
    message(FATAL_ERROR "Set LAB_DEPS_SOURCE_DIR to unpack the build dependencies")
  endif()
  file(MAKE_DIRECTORY "${LAB_DEPS_SOURCE_DIR}")
  file(WRITE "${LAB_DEPS_INIT_FILE}" "# Verified dependency sources for the container build\n")
endif()

function(prepare name root extension sha256 url)
  set(archive "${archive_dir}/${root}.${extension}")
  if(NOT EXISTS "${archive}")
    file(MAKE_DIRECTORY "${archive_dir}")
    message(STATUS "Fetching ${root} from ${url}")
    file(DOWNLOAD "${url}" "${archive}.partial"
      TLS_VERIFY ON TIMEOUT 120 INACTIVITY_TIMEOUT 30 STATUS status)
    list(GET status 0 code)
    if(NOT code EQUAL 0)
      file(REMOVE "${archive}.partial")
      list(GET status 1 detail)
      message(FATAL_ERROR
        "Could not fetch ${root}: ${detail}. Populate containers/deps/archives on a host with access and retry.")
    endif()
    file(SHA256 "${archive}.partial" downloaded)
    if(NOT downloaded STREQUAL sha256)
      file(REMOVE "${archive}.partial")
      message(FATAL_ERROR "SHA-256 mismatch for ${url}: expected ${sha256}, got ${downloaded}")
    endif()
    file(RENAME "${archive}.partial" "${archive}")
  endif()

  file(SHA256 "${archive}" actual)
  if(NOT actual STREQUAL sha256)
    message(FATAL_ERROR "SHA-256 mismatch for ${archive}: expected ${sha256}, got ${actual}")
  endif()
  message(STATUS "Verified ${root}")

  if(DEFINED LAB_DEPS_INIT_FILE)
    file(ARCHIVE_EXTRACT INPUT "${archive}" DESTINATION "${LAB_DEPS_SOURCE_DIR}")
    set(source "${LAB_DEPS_SOURCE_DIR}/${root}")
    if(NOT IS_DIRECTORY "${source}")
      message(FATAL_ERROR "Expected source directory ${source} after extracting ${archive}")
    endif()
    file(APPEND "${LAB_DEPS_INIT_FILE}"
      "set(FETCHCONTENT_SOURCE_DIR_${name} [==[${source}]==] CACHE PATH \"Verified source for ${name}\")\n")
  endif()
endfunction()

prepare(IEC61850 libiec61850-1.6.2.1 tar.gz
  a0c970b00ccd8dd1145c2a7f5369a58ea0916cc2dbcbcbfe9ba0975e72afb514
  https://codeload.github.com/mz-automation/libiec61850/tar.gz/refs/tags/v1.6.2.1)
prepare(IEC104 lib60870-2.4.1 tar.gz
  d5708b9885c2c068ac9d9bae4696a624bd1d1d6645a1b1a9261c00274bc36c3a
  https://codeload.github.com/mz-automation/lib60870/tar.gz/refs/tags/v2.4.1)
prepare(DNP3 opendnp3-3.1.2 tar.gz
  183cc29222c3cb58099a9753c43defed5cb8677fda985c3f88e38b5c19a36ff2
  https://codeload.github.com/dnp3/opendnp3/tar.gz/refs/tags/3.1.2)
prepare(ASIO asio-asio-1-16-0 zip
  18883c350558eadf91218ae5ce9a8f8f85099c2f036c1c8579fb639092e928c5
  https://github.com/chriskohlhoff/asio/archive/asio-1-16-0.zip)
prepare(EXE4CPP exe4cpp-fb878a4de598ba9d6e4338afebf83f96e03af1b8 zip
  2a8a2c7d9982f54858b92c03cff91ef433907472039f8e61ff7c9f9b3d48db6c
  https://github.com/automatak/exe4cpp/archive/fb878a4de598ba9d6e4338afebf83f96e03af1b8.zip)
prepare(SER4CPP ser4cpp-3c449734dc530a8f465eb0982de29165cc4e23d5 zip
  5a78f83de2d70bdf4be2ab607bc4416c6866ce64a257a8f19948cf5746762f6e
  https://github.com/automatak/ser4cpp/archive/3c449734dc530a8f465eb0982de29165cc4e23d5.zip)
