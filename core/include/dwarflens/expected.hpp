// SPDX-License-Identifier: MIT
// DwarfLens — expected.hpp
// Portable C++23 std::expected compatibility wrapper across GCC, Clang (libc++ & libstdc++), MSVC.
#pragma once

#if defined(__clang__) && !defined(_LIBCPP_VERSION)
#  ifndef __cpp_concepts
#    define __cpp_concepts 202002L
#  elif __cpp_concepts < 202002L
#    pragma clang diagnostic push
#    pragma clang diagnostic ignored "-Wbuiltin-macro-redefined"
#    undef __cpp_concepts
#    define __cpp_concepts 202002L
#    pragma clang diagnostic pop
#  endif
#endif

#include <expected>
