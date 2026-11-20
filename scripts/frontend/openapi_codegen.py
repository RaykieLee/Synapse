"""Export the FastAPI OpenAPI contract and generate reusable TypeScript schemas."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
API_ROOT = REPOSITORY_ROOT / "apps" / "api"
GENERATED_ROOT = REPOSITORY_ROOT / "apps" / "web" / "src" / "api" / "generated"
OPENAPI_JSON = GENERATED_ROOT / "openapi.json"
OPENAPI_TYPESCRIPT = GENERATED_ROOT / "openapi.ts"


def _set_export_environment() -> None:
    """Build the schema without reading local dotenv secrets or starting services."""
    os.environ.update(
        {
            "SYNAPSE_ENV": "development",
            "SYNAPSE_DEBUG": "false",
            "SYNAPSE_API_PREFIX": "/api/v1",
            "SYNAPSE_DATABASE_URL": "sqlite:///:memory:",
            "SYNAPSE_JWT_SECRET": "",
            "SYNAPSE_AGENTSCOPE_ENABLED": "false",
            "SYNAPSE_SCHEDULED_TASKS_ENABLED": "false",
            "SYNAPSE_AGENTSCOPE_CREDENTIAL_ENCRYPTION_KEY": "",
        }
    )


def _resolve_local_reference(document: dict[str, Any], reference: str) -> Any:
    if not reference.startswith("#/"):
        raise ValueError(f"Only local OpenAPI references are supported: {reference}")

    current: Any = document
    for token in reference[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if not isinstance(current, dict) or token not in current:
            raise ValueError(f"Unresolved OpenAPI reference: {reference}")
        current = current[token]
    return current


def _validate_openapi_document(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise ValueError("OpenAPI document must be a JSON object")

    version = document.get("openapi")
    if not isinstance(version, str) or not version.startswith("3."):
        raise ValueError(f"Unsupported or missing OpenAPI version: {version!r}")
    if not isinstance(document.get("paths"), dict):
        raise ValueError("OpenAPI document is missing its paths object")

    components = document.get("components")
    schemas = components.get("schemas") if isinstance(components, dict) else None
    if not isinstance(schemas, dict) or not schemas:
        raise ValueError("OpenAPI document is missing components.schemas")

    def validate_references(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key == "$ref" and isinstance(item, str):
                    _resolve_local_reference(document, item)
                else:
                    validate_references(item)
        elif isinstance(value, list):
            for item in value:
                validate_references(item)

    validate_references(document)
    return document


def export_openapi_document() -> dict[str, Any]:
    _set_export_environment()
    sys.path.insert(0, str(API_ROOT))

    # Settings supports a dotenv file for runtime use. A temporary cwd prevents
    # schema generation from loading a developer's local .env file.
    previous_cwd = Path.cwd()
    with tempfile.TemporaryDirectory(prefix="synapse-openapi-") as temporary_cwd:
        try:
            os.chdir(temporary_cwd)
            from app import create_app  # noqa: PLC0415

            document = create_app().openapi()
        finally:
            os.chdir(previous_cwd)

    return _validate_openapi_document(document)


def _schema_reference(name: str) -> str:
    return f"components['schemas'][{json.dumps(name, ensure_ascii=False)}]"


def _render_literal(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return json.dumps(value, ensure_ascii=False)


def _render_schema(schema: Any, level: int = 0) -> str:
    if not isinstance(schema, dict):
        return "unknown"

    if "$ref" in schema:
        prefix = "#/components/schemas/"
        reference = schema["$ref"]
        if isinstance(reference, str) and reference.startswith(prefix):
            name = reference[len(prefix) :].replace("~1", "/").replace("~0", "~")
            return _schema_reference(name)
        return "unknown"

    if "const" in schema:
        return _render_literal(schema["const"])

    if "enum" in schema:
        values = schema["enum"]
        if isinstance(values, list):
            return " | ".join(_render_literal(value) for value in values) or "never"

    alternatives = schema.get("oneOf", schema.get("anyOf"))
    if isinstance(alternatives, list):
        union = " | ".join(_render_schema(item, level) for item in alternatives)
        return f"({union})" if union else "never"

    all_of = schema.get("allOf")
    intersection_parts: list[str] = []
    if isinstance(all_of, list):
        intersection_parts.extend(_render_schema(item, level) for item in all_of)

    kind = schema.get("type")
    if isinstance(kind, list):
        union = " | ".join(_render_type_name(item) for item in kind)
        if schema.get("properties") or "additionalProperties" in schema:
            intersection_parts.append(_render_object(schema, level))
        if intersection_parts:
            intersection_parts.append(f"({union})")
        else:
            return union
    elif kind == "array":
        item_type = _render_schema(schema.get("items", {}), level)
        intersection_parts.append(f"Array<{item_type}>")
    elif kind == "object" or "properties" in schema or "additionalProperties" in schema:
        intersection_parts.append(_render_object(schema, level))
    elif kind is not None:
        intersection_parts.append(_render_type_name(kind))
    elif not intersection_parts:
        return "unknown"

    if not intersection_parts:
        return "unknown"
    if len(intersection_parts) == 1:
        return intersection_parts[0]
    return " & ".join(f"({part})" for part in intersection_parts)


def _render_type_name(kind: Any) -> str:
    return {
        "string": "string",
        "integer": "number",
        "number": "number",
        "boolean": "boolean",
        "null": "null",
        "object": "Record<string, unknown>",
        "array": "unknown[]",
    }.get(kind, "unknown")


def _render_object(schema: dict[str, Any], level: int) -> str:
    properties = schema.get("properties")
    additional_properties = schema.get("additionalProperties")
    if not isinstance(properties, dict) or not properties:
        if isinstance(additional_properties, dict):
            return f"Record<string, {_render_schema(additional_properties, level)}>"
        if additional_properties is True:
            return "Record<string, unknown>"
        return "Record<string, never>" if schema.get("type") == "object" else "unknown"

    required = schema.get("required")
    required_names = set(required) if isinstance(required, list) else set()
    lines = ["{"]
    for name, property_schema in properties.items():
        key = name if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name) else json.dumps(name)
        optional = "" if name in required_names else "?"
        value = _render_schema(property_schema, level + 1)
        lines.append(f"{'  ' * (level + 1)}{key}{optional}: {value}")

    if isinstance(additional_properties, dict):
        value = _render_schema(additional_properties, level + 1)
        lines.append(f"{'  ' * (level + 1)}[key: string]: {value}")
    elif additional_properties is True:
        lines.append(f"{'  ' * (level + 1)}[key: string]: unknown")

    lines.append(f"{'  ' * level}}}")
    return "\n".join(lines)


def generate_typescript(document: dict[str, Any]) -> str:
    schemas = document["components"]["schemas"]
    lines = [
        "/**",
        " * Generated by scripts/frontend/openapi_codegen.py. Do not edit by hand.",
        " * Source: FastAPI OpenAPI schema from apps/api/app/main.py.",
        " * Regenerate from apps/web with `pnpm openapi:generate`.",
        " */",
        "export type components = {",
        "  schemas: {",
    ]

    for name in sorted(schemas):
        key = name if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name) else json.dumps(name)
        value = _render_schema(schemas[name], 2)
        lines.append(f"    {key}: {value}")

    lines.extend(
        [
            "  }",
            "}",
            "",
            "export type OpenAPISchemaName = keyof components['schemas']",
            "",
        ]
    )
    return "\n".join(lines)


def _expected_outputs() -> tuple[str, str, int, int]:
    document = export_openapi_document()
    serialized = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    # Parse the exact serialized artifact as well as the in-memory FastAPI value.
    parsed = _validate_openapi_document(json.loads(serialized))
    return (
        serialized,
        generate_typescript(parsed),
        len(parsed["paths"]),
        len(parsed["components"]["schemas"]),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the generated JSON and TypeScript files are current without writing",
    )
    args = parser.parse_args()

    try:
        openapi_json, openapi_typescript, path_count, schema_count = _expected_outputs()
    except Exception as error:  # report the import/schema failure with a useful message
        print(f"OpenAPI export failed: {error}", file=sys.stderr)
        return 1

    expected = {
        OPENAPI_JSON: openapi_json,
        OPENAPI_TYPESCRIPT: openapi_typescript,
    }
    if args.check:
        missing = [path for path in expected if not path.is_file()]
        stale = [
            path
            for path, content in expected.items()
            if path.is_file() and path.read_text(encoding="utf-8") != content
        ]
        if missing or stale:
            for path in missing:
                print(f"Generated output is missing: {path.relative_to(REPOSITORY_ROOT)}")
            for path in stale:
                print(f"Generated output is stale: {path.relative_to(REPOSITORY_ROOT)}")
            return 1
    else:
        GENERATED_ROOT.mkdir(parents=True, exist_ok=True)
        for path, content in expected.items():
            path.write_text(content, encoding="utf-8", newline="\n")

    action = "current" if args.check else "written"
    print(
        f"OpenAPI schema parsed; {path_count} paths, {schema_count} component schemas; "
        f"generated outputs {action}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
