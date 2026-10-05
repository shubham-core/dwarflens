# DwarfLens Analysis JSON Schema Reference (v1)

Schema definition file: `schema/analysis.v1.schema.json`

DwarfLens CLI generates JSON conforming to this specification when invoked with `--format=json`. The DwarfLens ingest API verifies all incoming payloads against this contract.

---

## Top-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | integer | **Yes** | Contract version (must be `1`) |
| `filename` | string | **Yes** | Name of the analyzed binary file (e.g. `firmware.elf`) |
| `file_size` | integer | **Yes** | Total file size in bytes |
| `format` | string | **Yes** | Binary format (e.g. `ELF`, `Wasm`, `Mach-O`, `PE`) |
| `architecture` | string | No | Target CPU architecture (e.g. `x86_64`, `ARM`, `AArch64`, `RISC-V`) |
| `flash_size` | integer | No | Calculated flash footprint (code + rodata) in bytes |
| `ram_size` | integer | No | Calculated RAM footprint (data + bss) in bytes |
| `metadata` | object | No | CI and build environment metadata |
| `sections` | array | **Yes** | List of binary section objects |
| `symbols` | array | **Yes** | List of extracted symbol objects |
| `structs` | array | **Yes** | List of extracted struct layout objects |

---

## Metadata Object (`metadata`)

| Field | Type | Description |
|---|---|---|
| `repo` | string | GitHub repository name (e.g. `owner/repo`) |
| `commit_sha` | string | Git commit hash |
| `branch` | string | Git branch name (e.g. `main`) |
| `build_name` | string | Build target identifier (e.g. `release`, `debug`) |
| `timestamp` | integer | Unix timestamp (seconds) of when analysis was generated |
| `tool_version`| string | DwarfLens version string |
| `compiler` | string | Compiler identification (e.g. `clang 18.1.0`) |
| `flags` | string | Build compiler/linker flags |
| `base_commit_sha` | string | Target baseline commit SHA for diff evaluation |

---

## Section Object (`sections[]`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | **Yes** | Section name (e.g. `.text`, `.rodata`, `.data`, `.bss`) |
| `category` | string | **Yes** | Category: `code`, `rodata`, `data`, `bss`, `debug`, or `other` |
| `size` | integer | **Yes** | Size of section in bytes |
| `address` | integer | No | Virtual memory address (VMA) |
| `offset` | integer | No | File offset in bytes |
| `flags` | string | No | Section flags (e.g. `AX`, `WA`) |

---

## Symbol Object (`symbols[]`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | **Yes** | Mangled symbol name |
| `size` | integer | **Yes** | Symbol size in bytes |
| `type` | string | **Yes** | Symbol type (`FUNC`, `OBJECT`, `NOTYPE`, etc.) |
| `section` | string | No | Section containing this symbol |
| `demangled_name` | string | No | C++ demangled name |

---

## Struct Object (`structs[]`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | **Yes** | Struct / class / union name |
| `byte_size` | integer | **Yes** | Total struct byte size |
| `alignment` | integer | **Yes** | Struct alignment requirement (in bytes) |
| `total_padding_bytes` | integer | **Yes** | Sum of all wasted alignment padding bytes |
| `cache_lines_spanned` | integer | **Yes** | Number of 64-byte CPU cache lines spanned |
| `has_padding` | boolean | **Yes** | `true` if struct contains internal padding |
| `has_cache_line_crossing` | boolean | **Yes** | `true` if any field crosses a 64-byte boundary |
| `members` | array | **Yes** | Struct fields array (`name`, `type`, `size`, `offset`) |
| `padding_holes` | array | **Yes** | Internal padding holes (`offset`, `size`) |
| `cache_line_crossings` | array | **Yes** | Crossed cache line boundaries (`field_name`, `offset`, `line_boundary`) |
| `optimal` | object | No | Optimal reordering recommendation (`byte_size`, `padding_bytes`, `savings_bytes`) |

---

## Example Payload

```json
{
  "schema_version": 1,
  "filename": "firmware.elf",
  "file_size": 72400,
  "format": "ELF",
  "architecture": "ARM",
  "flash_size": 64000,
  "ram_size": 8400,
  "metadata": {
    "commit_sha": "a1b2c3d4e5f67890",
    "branch": "main",
    "build_name": "release"
  },
  "sections": [
    { "name": ".text", "category": "code", "size": 48120 },
    { "name": ".rodata", "category": "rodata", "size": 15880 }
  ],
  "symbols": [
    { "name": "main", "size": 128, "type": "FUNC" }
  ],
  "structs": [
    {
      "name": "TelemetryPacket",
      "byte_size": 32,
      "alignment": 8,
      "total_padding_bytes": 6,
      "cache_lines_spanned": 1,
      "has_padding": true,
      "has_cache_line_crossing": false,
      "members": [
        { "name": "seq", "type": "uint64_t", "size": 8, "offset": 0 },
        { "name": "port", "type": "uint16_t", "size": 2, "offset": 8 }
      ],
      "padding_holes": [
        { "offset": 10, "size": 6 }
      ],
      "cache_line_crossings": [],
      "optimal": {
        "byte_size": 24,
        "padding_bytes": 0,
        "savings_bytes": 8
      }
    }
  ]
}
```
