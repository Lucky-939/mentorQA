import os
import tempfile

from analyzer.static_analyzer import analyze_js_ts_file, analyze_python_file


def test_js_long_function_fires_on_60_line_function():
    with tempfile.TemporaryDirectory() as tmpdir:
        lines = ["function bigFunction() {"]
        for i in range(58):
            lines.append(f"    const x{i} = {i};")
        lines.append("    return 42;")
        lines.append("}")
        content = "\n".join(lines)
        assert len(lines) >= 60

        file_path = os.path.join(tmpdir, "big.js")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)

        findings, _, _, _, _ = analyze_js_ts_file(file_path, tmpdir, is_ts=False)
        rule_ids = [f.ruleId for f in findings]
        assert "js-long-function" in rule_ids
        target_finding = next(f for f in findings if f.ruleId == "js-long-function")
        assert target_finding.category == "code-smell"
        assert target_finding.severity == "medium"
        assert "Function is too long" in target_finding.message


def test_py_long_function_fires_on_60_line_function():
    with tempfile.TemporaryDirectory() as tmpdir:
        lines = ["def big_python_function():"]
        for i in range(58):
            lines.append(f"    val_{i} = {i}")
        lines.append("    return 42")
        content = "\n".join(lines)
        assert len(lines) >= 60

        file_path = os.path.join(tmpdir, "big.py")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)

        findings, _, _, _, _ = analyze_python_file(file_path, tmpdir)
        rule_ids = [f.ruleId for f in findings]
        assert "py-long-function" in rule_ids
        target_finding = next(f for f in findings if f.ruleId == "py-long-function")
        assert target_finding.category == "code-smell"
        assert target_finding.severity == "medium"
        assert "Function is too long" in target_finding.message


def test_js_eval_usage_fires_on_eval():
    with tempfile.TemporaryDirectory() as tmpdir:
        content = """function processData(userInput) {
    const result = eval(userInput);
    return result;
}
"""
        file_path = os.path.join(tmpdir, "insecure.js")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)

        findings, _, _, _, _ = analyze_js_ts_file(file_path, tmpdir, is_ts=False)
        rule_ids = [f.ruleId for f in findings]
        assert "js-eval-usage" in rule_ids
        target_finding = next(f for f in findings if f.ruleId == "js-eval-usage")
        assert target_finding.category == "security"
        assert target_finding.severity == "high"
        assert "eval() detected" in target_finding.message
