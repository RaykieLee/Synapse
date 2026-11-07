'''Keep API, tenancy, and integration dependencies pointed inward.'''

import ast
from importlib.util import resolve_name
from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = API_ROOT / 'app'


def _module_name(path: Path) -> str:
    relative = path.relative_to(APP_ROOT).with_suffix('')
    parts = list(relative.parts)
    if parts[-1] == '__init__':
        parts.pop()
    return '.'.join(('app', *parts))


def _import_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    module = _module_name(path)
    package = module if path.name == '__init__.py' else module.rpartition('.')[0]
    imported = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                relative_name = '.' * node.level + (node.module or '')
                base = resolve_name(relative_name, package)
            else:
                base = node.module or ''
            if base:
                imported.add(base)
            imported.update(f'{base}.{alias.name}' for alias in node.names if base)

    return imported


def _python_files(directory: Path) -> list[Path]:
    return sorted(directory.rglob('*.py'))


def _violations(directory: Path, forbidden_prefixes: tuple[str, ...]) -> list[str]:
    violations = []
    for path in _python_files(directory):
        for imported in _import_modules(path):
            if any(
                imported == prefix or imported.startswith(f'{prefix}.')
                for prefix in forbidden_prefixes
            ):
                violations.append(f'{_module_name(path)} imports {imported}')
    return violations


def _imports_test_module(imported: str) -> bool:
    return 'tests' in imported.split('.')


def test_integrations_do_not_depend_on_api() -> None:
    assert _violations(APP_ROOT / 'integrations', ('app.api',)) == []


def test_tenancy_does_not_depend_on_api_or_integrations() -> None:
    assert _violations(APP_ROOT / 'tenancy', ('app.api', 'app.integrations')) == []


def test_tenancy_web_framework_adapter_is_confined_to_context_module() -> None:
    framework_imports = {'fastapi', 'starlette'}
    violations = []

    for path in _python_files(APP_ROOT / 'tenancy'):
        module = _module_name(path)
        for imported in _import_modules(path):
            if any(
                imported == framework or imported.startswith(f'{framework}.')
                for framework in framework_imports
            ) and module != 'app.tenancy.context':
                violations.append(f'{module} imports {imported}')

    assert violations == []


def test_production_packages_do_not_import_tests() -> None:
    violations = []
    for path in _python_files(APP_ROOT):
        module = _module_name(path)
        for imported in _import_modules(path):
            if _imports_test_module(imported):
                violations.append(f'{module} imports {imported}')

    assert violations == []


def test_test_import_detection_includes_package_local_tests() -> None:
    assert _imports_test_module('app.feature.tests.support')
    assert not _imports_test_module('app.feature.contests.support')
