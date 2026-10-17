file(REMOVE_RECURSE
  "CMakeFiles/test_fixtures"
  "tests/fixtures/sample_target"
  "tests/fixtures/sample_target_bloat"
)

# Per-language clean rules from dependency scanning.
foreach(lang )
  include(CMakeFiles/test_fixtures.dir/cmake_clean_${lang}.cmake OPTIONAL)
endforeach()
