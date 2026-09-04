import json
import os
import subprocess
import uuid
from typing import Any, Dict, List, Optional

import tree_sitter_javascript as tsjavascript
import tree_sitter_python as tspython
import tree_sitter_typescript as tstypescript
from pydantic import BaseModel
from tree_sitter import Language, Parser


class Finding(BaseModel):
    id: str
    category: str
    severity: str
    file: str
    lineStart: int
    lineEnd: int
    message: str
    ruleId: str
    metadata: Optional[Dict[str, Any]] = None


class KeyFunction(BaseModel):
    id: str
    name: str
    file: str
    language: str
    source: str
    signature: str


def get_parser(language_module) -> Parser:
    lang = Language(language_module.language())
    parser = Parser()
    parser.language = lang
    return parser


def analyze_python_file(filepath: str, repo_path: str) -> tuple[List[Finding], List[KeyFunction]]:
    findings = []
    key_functions = []
    parser = get_parser(tspython)
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            code = f.read()
    except Exception:
        return [], []

    tree = parser.parse(bytes(code, "utf8"))

    def traverse(node):
        if node.type in ["if_statement", "for_statement", "while_statement"]:
            findings.append(
                Finding(
                    id=str(uuid.uuid4()),
                    category="complexity",
                    severity="info",
                    file=os.path.relpath(filepath, repo_path).replace("\\", "/"),
                    lineStart=node.start_point[0] + 1,
                    lineEnd=node.end_point[0] + 1,
                    message=f"Control flow statement found ({node.type}) - "
                            f"consider simplifying if deeply nested.",
                    ruleId="py-complexity-heuristic",
                )
            )
        elif node.type == "function_definition":
            lines = node.end_point[0] - node.start_point[0]
            if lines > 50:
                findings.append(
                    Finding(
                        id=str(uuid.uuid4()),
                        category="code-smell",
                        severity="medium",
                        file=os.path.relpath(filepath, repo_path).replace("\\", "/"),
                        lineStart=node.start_point[0] + 1,
                        lineEnd=node.end_point[0] + 1,
                        message=f"Function is too long ({lines} lines).",
                        ruleId="py-long-function",
                    )
                )
            
            name_node = node.child_by_field_name("name")
            if name_node:
                func_name = name_node.text.decode("utf-8")
                func_source = code.encode("utf-8")[node.start_byte:node.end_byte].decode("utf-8")
                # grab the first line for signature
                func_sig = func_source.split('\n')[0].strip()
                key_functions.append(
                    KeyFunction(
                        id=str(uuid.uuid4()),
                        name=func_name,
                        file=os.path.relpath(filepath, repo_path).replace("\\", "/"),
                        language="python",
                        source=func_source,
                        signature=func_sig
                    )
                )

        for child in node.children:
            traverse(child)

    traverse(tree.root_node)
    return findings, key_functions


def analyze_js_ts_file(
    filepath: str, repo_path: str, is_ts: bool
) -> tuple[List[Finding], List[KeyFunction]]:
    findings = []
    key_functions = []

    if is_ts:
        lang = Language(tstypescript.language_typescript())
    else:
        lang = Language(tsjavascript.language())

    parser = Parser()
    parser.language = lang
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            code = f.read()
    except Exception:
        return [], []

    tree = parser.parse(bytes(code, "utf8"))

    def traverse(node):
        if node.type in ["function_declaration", "arrow_function", "method_definition"]:
            lines = node.end_point[0] - node.start_point[0]
            if lines > 50:
                findings.append(
                    Finding(
                        id=str(uuid.uuid4()),
                        category="code-smell",
                        severity="medium",
                        file=os.path.relpath(filepath, repo_path).replace("\\", "/"),
                        lineStart=node.start_point[0] + 1,
                        lineEnd=node.end_point[0] + 1,
                        message=f"Function is too long ({lines} lines).",
                        ruleId="js-long-function",
                    )
                )
            
            name_node = node.child_by_field_name("name")
            func_name = name_node.text.decode("utf-8") if name_node else "anonymous"
            if func_name != "anonymous" or node.type == "arrow_function":
                func_source = code.encode("utf-8")[node.start_byte:node.end_byte].decode("utf-8")
                func_sig = func_source.split('\n')[0].strip()
                key_functions.append(
                    KeyFunction(
                        id=str(uuid.uuid4()),
                        name=func_name,
                        file=os.path.relpath(filepath, repo_path).replace("\\", "/"),
                        language="typescript" if is_ts else "javascript",
                        source=func_source,
                        signature=func_sig
                    )
                )

        # Simple security check for eval()
        if node.type == "call_expression":
            function_name_node = node.child_by_field_name("function")
            if function_name_node and function_name_node.text.decode("utf-8") == "eval":
                findings.append(
                    Finding(
                        id=str(uuid.uuid4()),
                        category="security",
                        severity="high",
                        file=os.path.relpath(filepath, repo_path).replace("\\", "/"),
                        lineStart=node.start_point[0] + 1,
                        lineEnd=node.end_point[0] + 1,
                        message="Use of eval() detected. This is a severe security risk.",
                        ruleId="js-eval-usage",
                    )
                )

        for child in node.children:
            traverse(child)

    traverse(tree.root_node)
    return findings, key_functions


def analyze_java_with_jar(repo_path: str) -> tuple[List[Finding], List[KeyFunction]]:
    findings = []
    key_functions = []
    jar_path = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "../../../apps/java-analyzer/target/java-analyzer-1.0-SNAPSHOT-jar-with-dependencies.jar",
        )
    )

    if not os.path.exists(jar_path):
        print(f"Java analyzer JAR not found at {jar_path}")
        return findings, key_functions

    try:
        result = subprocess.run(
            ["java", "-jar", jar_path, repo_path], capture_output=True, text=True, check=True
        )
        output = result.stdout.strip()
        if output:
            try:
                parsed = json.loads(output)
                for item in parsed:
                    if "id" not in item:
                        item["id"] = str(uuid.uuid4())
                    findings.append(Finding(**item))
            except json.JSONDecodeError:
                print("Failed to parse java-analyzer JSON output")
    except subprocess.CalledProcessError as e:
        print(f"Java analyzer failed: {e.stderr}")

    return findings, key_functions


def run_static_analysis(
    repo_path: str, detected_stack: dict
) -> tuple[List[Finding], List[KeyFunction]]:
    findings = []
    key_functions = []

    if "Java" in detected_stack.get("languages", []):
        f, k = analyze_java_with_jar(repo_path)
        findings.extend(f)
        key_functions.extend(k)

    for root, _, files in os.walk(repo_path):
        for file in files:
            filepath = os.path.join(root, file)
            if file.endswith(".py"):
                f, k = analyze_python_file(filepath, repo_path)
                findings.extend(f)
                key_functions.extend(k)
            elif file.endswith(".js") or file.endswith(".jsx"):
                f, k = analyze_js_ts_file(filepath, repo_path, False)
                findings.extend(f)
                key_functions.extend(k)
            elif file.endswith(".ts") or file.endswith(".tsx"):
                f, k = analyze_js_ts_file(filepath, repo_path, True)
                findings.extend(f)
                key_functions.extend(k)

    return findings, key_functions
