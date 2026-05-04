#!/usr/bin/env python3

import ast
import hashlib
import json
import os
import sys
import tokenize


def read_text(file_path):
    with tokenize.open(file_path) as handle:
        return handle.read()


def module_name_for(root_path, file_path):
    rel_path = os.path.relpath(file_path, root_path)
    without_ext = os.path.splitext(rel_path)[0]
    parts = [part for part in without_ext.replace(os.sep, "/").split("/") if part]
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts) if parts else "__init__"


def node_location(node):
    return {
        "startLine": getattr(node, "lineno", 1) or 1,
        "startCol": (getattr(node, "col_offset", 0) or 0) + 1,
        "endLine": getattr(node, "end_lineno", getattr(node, "lineno", 1)) or 1,
        "endCol": (getattr(node, "end_col_offset", getattr(node, "col_offset", 0)) or 0) + 1,
    }


def expr_name(expr):
    if isinstance(expr, ast.Name):
        return expr.id
    if isinstance(expr, ast.Attribute):
        left = expr_name(expr.value)
        return f"{left}.{expr.attr}" if left else expr.attr
    if isinstance(expr, ast.Call):
        return expr_name(expr.func)
    if isinstance(expr, ast.Subscript):
        return expr_name(expr.value)
    if isinstance(expr, ast.Constant):
        return repr(expr.value)
    if isinstance(expr, ast.Tuple):
        return ".".join(filter(None, (expr_name(item) for item in expr.elts)))
    if isinstance(expr, ast.BinOp):
        left = expr_name(expr.left)
        right = expr_name(expr.right)
        return ".".join(filter(None, [left, right]))
    return ""


def annotation_names(expr):
    names = []

    def visit(node):
        if isinstance(node, (ast.Name, ast.Attribute)):
            name = expr_name(node)
            if name:
                names.append(name)
            return
        for child in ast.iter_child_nodes(node):
            visit(child)

    if expr is not None:
        visit(expr)
    return names


def resolve_relative_import(module_name, level, imported_module):
    if level <= 0:
        return imported_module or ""

    parts = module_name.split(".") if module_name else []
    if len(parts) >= level:
        base = parts[:-level]
    else:
        base = []

    if imported_module:
        base.extend(part for part in imported_module.split(".") if part)
    return ".".join(base)


class PythonVisitor(ast.NodeVisitor):
    def __init__(self, file_path, module_name):
        self.file_path = file_path
        self.module_name = module_name
        self.symbols = []
        self.edges = []
        self.scope_stack = [module_name]
        self.class_stack = []
        self.kind_by_qualified_name = {module_name: "module"}
        self.variable_names = set()

        self.symbols.append(
            {
                "kind": "module",
                "name": module_name.split(".")[-1] if module_name else "__init__",
                "qualifiedName": module_name,
                "parentQualifiedName": None,
                "filePath": file_path,
                "startLine": 1,
                "startCol": 1,
                "endLine": 1,
                "endCol": 1,
            }
        )

    def current_scope(self):
        return self.scope_stack[-1]

    def current_class(self):
        return self.class_stack[-1] if self.class_stack else None

    def qualify_child(self, name):
        parent = self.current_scope()
        return f"{parent}.{name}" if parent else name

    def add_symbol(self, kind, name, qualified_name, parent_qualified_name, node):
        if qualified_name in self.kind_by_qualified_name:
            return
        symbol = {
            "kind": kind,
            "name": name,
            "qualifiedName": qualified_name,
            "parentQualifiedName": parent_qualified_name,
            "filePath": self.file_path,
            **node_location(node),
        }
        self.symbols.append(symbol)
        self.kind_by_qualified_name[qualified_name] = kind

    def add_variable_symbol(self, name, node, kind="variable", parent_qualified_name=None):
        if not name or name.startswith("__") and name.endswith("__"):
            return
        parent = parent_qualified_name or self.current_scope()
        qualified_name = f"{parent}.{name}" if parent else name
        key = (kind, qualified_name)
        if key in self.variable_names:
            return
        self.variable_names.add(key)
        self.add_symbol(kind, name, qualified_name, parent, node)

    def add_edge(self, edge_type, source_qualified_name, target_name, node, target_qualified_name=None):
        self.edges.append(
            {
                "type": edge_type,
                "sourceQualifiedName": source_qualified_name,
                "targetName": target_name,
                "targetQualifiedName": target_qualified_name,
                "filePath": self.file_path,
                "line": getattr(node, "lineno", 1) or 1,
                "col": (getattr(node, "col_offset", 0) or 0) + 1,
                "label": target_name,
            }
        )

    def add_annotation_edges(self, source_qualified_name, annotation):
        for name in annotation_names(annotation):
            self.add_edge("uses_class", source_qualified_name, name, annotation)

    def visit_ClassDef(self, node):
        parent = self.current_scope()
        qualified_name = self.qualify_child(node.name)
        self.add_symbol("class", node.name, qualified_name, parent, node)

        for base in node.bases:
            base_name = expr_name(base)
            if base_name:
                self.add_edge("inherits", qualified_name, base_name, base)

        for decorator in node.decorator_list:
            decorator_name = expr_name(decorator)
            if decorator_name:
                self.add_edge("decorates", qualified_name, decorator_name, decorator)

        self.scope_stack.append(qualified_name)
        self.class_stack.append(qualified_name)
        self.generic_visit(node)
        self.class_stack.pop()
        self.scope_stack.pop()

    def visit_FunctionDef(self, node):
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node):
        self._visit_function(node)

    def _visit_function(self, node):
        parent = self.current_scope()
        qualified_name = self.qualify_child(node.name)
        parent_kind = self.kind_by_qualified_name.get(parent)
        kind = "method" if parent_kind == "class" else "function"
        self.add_symbol(kind, node.name, qualified_name, parent, node)

        for decorator in node.decorator_list:
            decorator_name = expr_name(decorator)
            if decorator_name:
                self.add_edge("decorates", qualified_name, decorator_name, decorator)

        all_args = [
            *getattr(node.args, "posonlyargs", []),
            *node.args.args,
            *node.args.kwonlyargs,
        ]
        if node.args.vararg:
            all_args.append(node.args.vararg)
        if node.args.kwarg:
            all_args.append(node.args.kwarg)

        for arg in all_args:
            self.add_variable_symbol(arg.arg, arg, "parameter", qualified_name)
            self.add_annotation_edges(qualified_name, arg.annotation)
        self.add_annotation_edges(qualified_name, node.returns)

        self.scope_stack.append(qualified_name)
        self.generic_visit(node)
        self.scope_stack.pop()

    def visit_Import(self, node):
        for alias in node.names:
            self.add_edge("import", self.current_scope(), alias.name, node)

    def visit_ImportFrom(self, node):
        module = resolve_relative_import(self.module_name, node.level, node.module)
        for alias in node.names:
            if alias.name == "*":
                target = module or "*"
            elif module:
                target = f"{module}.{alias.name}"
            else:
                target = alias.name
            self.add_edge("import", self.current_scope(), target, node)

    def visit_Call(self, node):
        target = expr_name(node.func)
        target_qualified_name = None

        class_name = self.current_class()
        if class_name and target.startswith("self."):
            target_qualified_name = f"{class_name}.{target[5:]}"
        elif class_name and target.startswith("cls."):
            target_qualified_name = f"{class_name}.{target[4:]}"
        elif target and "." not in target:
            target_qualified_name = f"{self.module_name}.{target}"

        if target:
            self.add_edge("calls", self.current_scope(), target, node, target_qualified_name)

        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        self.add_annotation_edges(self.current_scope(), node.annotation)
        for name in self.assignment_target_names(node.target):
            self.add_variable_symbol(name, node)
        self.generic_visit(node)

    def visit_Assign(self, node):
        for target in node.targets:
            for name in self.assignment_target_names(target):
                self.add_variable_symbol(name, target)
        if isinstance(node.value, ast.Call):
            target = expr_name(node.value.func)
            last = target.split(".")[-1] if target else ""
            if last[:1].isupper():
                self.add_edge("uses_class", self.current_scope(), target, node.value)
        self.generic_visit(node)

    def visit_For(self, node):
        for name in self.assignment_target_names(node.target):
            self.add_variable_symbol(name, node.target)
        self.generic_visit(node)

    def visit_With(self, node):
        for item in node.items:
            if item.optional_vars:
                for name in self.assignment_target_names(item.optional_vars):
                    self.add_variable_symbol(name, item.optional_vars)
        self.generic_visit(node)

    def assignment_target_names(self, target):
        if isinstance(target, ast.Name):
            return [target.id]
        if isinstance(target, ast.Attribute):
            target_name = expr_name(target)
            if target_name.startswith("self.") and self.current_class():
                return [target_name[5:]]
            if target_name.startswith("cls.") and self.current_class():
                return [target_name[4:]]
            return [target.attr]
        if isinstance(target, (ast.Tuple, ast.List)):
            names = []
            for item in target.elts:
                names.extend(self.assignment_target_names(item))
            return names
        return []


def analyze_file(root_path, file_path):
    text = read_text(file_path)
    module_name = module_name_for(root_path, file_path)
    rel_path = os.path.relpath(file_path, root_path)
    file_info = {
        "path": file_path,
        "relativePath": rel_path,
        "moduleName": module_name,
        "lineCount": len(text.splitlines()),
        "hash": hashlib.sha1(text.encode("utf-8", errors="replace")).hexdigest(),
    }

    try:
        tree = ast.parse(text, filename=file_path, type_comments=True)
    except SyntaxError as error:
        return {
            "file": file_info,
            "symbols": [
                {
                    "kind": "module",
                    "name": module_name.split(".")[-1] if module_name else "__init__",
                    "qualifiedName": module_name,
                    "parentQualifiedName": None,
                    "filePath": file_path,
                    "startLine": 1,
                    "startCol": 1,
                    "endLine": 1,
                    "endCol": 1,
                }
            ],
            "edges": [],
            "errors": [
                {
                    "filePath": file_path,
                    "message": error.msg,
                    "line": error.lineno or 1,
                    "col": error.offset or 1,
                }
            ],
        }

    visitor = PythonVisitor(file_path, module_name)
    visitor.visit(tree)
    return {
        "file": file_info,
        "symbols": visitor.symbols,
        "edges": visitor.edges,
        "errors": [],
    }


def main():
    request = json.load(sys.stdin)
    root_path = os.path.realpath(request["rootPath"])
    files = [os.path.realpath(file_path) for file_path in request.get("files", [])]

    output = {
        "files": [],
        "symbols": [],
        "edges": [],
        "errors": [],
    }

    for file_path in files:
        try:
            result = analyze_file(root_path, file_path)
            output["files"].append(result["file"])
            output["symbols"].extend(result["symbols"])
            output["edges"].extend(result["edges"])
            output["errors"].extend(result["errors"])
        except Exception as error:
            output["errors"].append(
                {
                    "filePath": file_path,
                    "message": str(error),
                    "line": 1,
                    "col": 1,
                }
            )

    json.dump(output, sys.stdout)


if __name__ == "__main__":
    main()
