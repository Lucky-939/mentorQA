# ruff: noqa: E501
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


class Endpoint(BaseModel):
    id: str
    method: str
    path: str
    file: str
    language: str
    port: Optional[int] = None

class GraphNode(BaseModel):
    id: str
    name: str
    type: str
    file: str
    layer: Optional[str] = None

class GraphEdge(BaseModel):
    source: str
    target: str
    relationship: str

def classify_layer(filepath: str, name: str) -> str:
    lp = filepath.lower()
    ln = name.lower()
    if 'controller' in lp or 'controller' in ln or 'routes' in lp:
        return 'controller'
    if 'repository' in lp or 'repository' in ln or 'dao' in ln or 'db' in lp or 'model' in lp:
        return 'repository'
    if 'service' in lp or 'service' in ln:
        return 'service'
    return 'unknown'


def get_parser(language_module) -> Parser:
    lang = Language(language_module.language())
    parser = Parser()
    parser.language = lang
    return parser


def analyze_python_file(filepath: str, repo_path: str) -> tuple[List[Finding], List[KeyFunction], List[Endpoint], List[GraphNode], List[GraphEdge]]:
    findings = []
    key_functions = []
    endpoints = []
    nodes = []
    edges = []
    file_id = os.path.relpath(filepath, repo_path).replace("\\", "/")
    
    nodes.append(GraphNode(
        id=file_id,
        name=os.path.basename(filepath),
        type="file",
        file=file_id,
        layer=classify_layer(file_id, os.path.basename(filepath))
    ))
    parser = get_parser(tspython)
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            code = f.read()
    except Exception:
        return [], [], []

    tree = parser.parse(bytes(code, "utf8"))

    def traverse(node):
        if node.type in ["import_statement", "import_from_statement"]:
            for child in node.children:
                if child.type == "dotted_name" or child.type == "identifier":
                    target = child.text.decode("utf-8")
                    edges.append(GraphEdge(source=file_id, target=target, relationship="imports"))
                    # best effort: create a node for the imported module if it doesn't exist yet
                    # we just let Neo4j MERGE it later
        
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

        elif node.type == "decorated_definition":
            # Extract FastAPI / Flask routes like @app.get('/path')
            for child in node.children:
                if child.type == "decorator":
                    call_node = child.child_by_field_name("expression")
                    if call_node and call_node.type == "call":
                        func_node = call_node.child_by_field_name("function")
                        if func_node and func_node.type == "attribute":
                            attr_name = func_node.child_by_field_name("attribute")
                            if attr_name:
                                method_str = attr_name.text.decode("utf-8").upper()
                                if method_str in ["GET", "POST", "PUT", "DELETE", "PATCH"]:
                                    args_node = call_node.child_by_field_name("arguments")
                                    if args_node and len(args_node.children) > 1:
                                        first_arg = args_node.children[1]
                                        if first_arg.type == "string":
                                            # Python strings might have quotes, strip them
                                            path_str = first_arg.text.decode("utf-8").strip("'\"")
                                            endpoints.append(
                                                Endpoint(
                                                    id=str(uuid.uuid4()),
                                                    method=method_str,
                                                    path=path_str,
                                                    file=os.path.relpath(filepath, repo_path).replace("\\", "/"),
                                                    language="python",
                                                    port=None
                                                )
                                            )

        for child in node.children:
            traverse(child)

    traverse(tree.root_node)
    return findings, key_functions, endpoints, nodes, edges


def analyze_js_ts_file(
    filepath: str, repo_path: str, is_ts: bool
) -> tuple[List[Finding], List[KeyFunction], List[Endpoint], List[GraphNode], List[GraphEdge]]:
    findings = []
    key_functions = []
    endpoints = []
    nodes = []
    edges = []
    file_id = os.path.relpath(filepath, repo_path).replace("\\", "/")
    
    nodes.append(GraphNode(
        id=file_id,
        name=os.path.basename(filepath),
        type="file",
        file=file_id,
        layer=classify_layer(file_id, os.path.basename(filepath))
    ))

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
        return [], [], []

    tree = parser.parse(bytes(code, "utf8"))

    def traverse(node):
        if node.type == "import_statement":
            source_node = node.child_by_field_name("source")
            if source_node:
                target = source_node.text.decode("utf-8").strip("'\"`")
                # resolve relative paths slightly to make it match other files
                if target.startswith("./") or target.startswith("../"):
                    target_path = os.path.normpath(os.path.join(os.path.dirname(file_id), target)).replace("\\", "/")
                    target = target_path
                edges.append(GraphEdge(source=file_id, target=target, relationship="imports"))
                nodes.append(GraphNode(id=target, name=os.path.basename(target), type="file", file=target, layer=classify_layer(target, os.path.basename(target))))

        if node.type == "variable_declarator":
            value_node = node.child_by_field_name("value")
            if value_node and value_node.type == "call_expression":
                func_node = value_node.child_by_field_name("function")
                if func_node and func_node.text.decode("utf-8") == "require":
                    args_node = value_node.child_by_field_name("arguments")
                    if args_node and len(args_node.children) > 1:
                        first_arg = args_node.children[1]
                        if first_arg.type == "string":
                            target = first_arg.text.decode("utf-8").strip("'\"`")
                            if target.startswith("./") or target.startswith("../"):
                                target_path = os.path.normpath(os.path.join(os.path.dirname(file_id), target)).replace("\\", "/")
                                target = target_path
                            edges.append(GraphEdge(source=file_id, target=target, relationship="imports"))
                            nodes.append(GraphNode(id=target, name=os.path.basename(target), type="file", file=target, layer=classify_layer(target, os.path.basename(target))))

        if node.type == "class_declaration":
            name_node = node.child_by_field_name("name")
            if name_node:
                class_name = name_node.text.decode("utf-8")
                class_id = f"{file_id}:{class_name}"
                nodes.append(GraphNode(id=class_id, name=class_name, type="class", file=file_id, layer=classify_layer(file_id, class_name)))
                
                # Check extends
                for child in node.children:
                    if child.type == "class_heritage":
                        for c in child.children:
                            if c.type == "identifier":
                                edges.append(GraphEdge(source=class_id, target=c.text.decode("utf-8"), relationship="extends"))

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
            # Detect endpoints (app.get('/route'), router.post('/route'))
            if function_name_node and function_name_node.type == "member_expression":
                property_node = function_name_node.child_by_field_name("property")
                if property_node:
                    method_str = property_node.text.decode("utf-8").upper()
                    if method_str in ["GET", "POST", "PUT", "DELETE", "PATCH"]:
                        args_node = node.child_by_field_name("arguments")
                        if args_node and len(args_node.children) > 1:
                            first_arg = args_node.children[1]
                            if first_arg.type == "string":
                                path_str = first_arg.text.decode("utf-8").strip("'\"`")
                                endpoints.append(
                                    Endpoint(
                                        id=str(uuid.uuid4()),
                                        method=method_str,
                                        path=path_str,
                                        file=os.path.relpath(filepath, repo_path).replace("\\", "/"),
                                        language="typescript" if is_ts else "javascript"
                                    )
                                )
                    elif method_str == "LISTEN":
                        args_node = node.child_by_field_name("arguments")
                        if args_node and len(args_node.children) > 1:
                            first_arg = args_node.children[1]
                            if first_arg.type == "number":
                                port_val = int(first_arg.text.decode("utf-8"))
                                endpoints.append(
                                    Endpoint(
                                        id=str(uuid.uuid4()),
                                        method="LISTEN",
                                        path="",
                                        file=os.path.relpath(filepath, repo_path).replace("\\", "/"),
                                        language="typescript" if is_ts else "javascript",
                                        port=port_val
                                    )
                                )

        for child in node.children:
            traverse(child)

    traverse(tree.root_node)
    return findings, key_functions, endpoints, nodes, edges


def analyze_java_with_jar(repo_path: str) -> tuple[List[Finding], List[KeyFunction], List[Endpoint], List[GraphNode], List[GraphEdge]]:
    findings = []
    endpoints = []
    
    # TODO (Phase 4+): Java Test Generation Technical Debt
    # The Phase 2 Java AST analyzer (java-analyzer-1.0-SNAPSHOT) does not currently extract 
    # or return KeyFunction objects. Thus, Java files never reach the Gemini test generator 
    # in Phase 3. The Java analyzer must be extended to parse and return KeyFunction definitions 
    # before Java test generation can be fully activated.
    key_functions = []
    jar_path = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "../../../apps/java-analyzer/target/java-analyzer-1.0-SNAPSHOT-jar-with-dependencies.jar",
        )
    )

    if not os.path.exists(jar_path):
        print(f"Java analyzer JAR not found at {jar_path}")
        return findings, key_functions, endpoints

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

    return findings, key_functions, [], [], []


def run_static_analysis(
    repo_path: str, detected_stack: dict
) -> tuple[List[Finding], List[KeyFunction], List[Endpoint], List[GraphNode], List[GraphEdge]]:
    findings = []
    key_functions = []
    endpoints = []
    nodes = []
    edges = []

    if "Java" in detected_stack.get("languages", []):
        f, k, e, n, ed = analyze_java_with_jar(repo_path)
        findings.extend(f)
        key_functions.extend(k)
        endpoints.extend(e)
        nodes.extend(n)
        edges.extend(ed)

    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in [".git", "node_modules", "venv", ".venv", "dist", "build"]]
        for file in files:
            filepath = os.path.join(root, file)
            if file.endswith(".py"):
                f, k, e, n, ed = analyze_python_file(filepath, repo_path)
                findings.extend(f)
                key_functions.extend(k)
                endpoints.extend(e)
                nodes.extend(n)
                edges.extend(ed)
            elif file.endswith(".js") or file.endswith(".jsx"):
                f, k, e, n, ed = analyze_js_ts_file(filepath, repo_path, False)
                findings.extend(f)
                key_functions.extend(k)
                endpoints.extend(e)
                nodes.extend(n)
                edges.extend(ed)
            elif file.endswith(".ts") or file.endswith(".tsx"):
                f, k, e, n, ed = analyze_js_ts_file(filepath, repo_path, True)
                findings.extend(f)
                key_functions.extend(k)
                endpoints.extend(e)
                nodes.extend(n)
                edges.extend(ed)

    return findings, key_functions, endpoints, nodes, edges
