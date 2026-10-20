import subprocess
import unittest
from unittest.mock import patch

from analyzer.static_analyzer import analyze_java_with_jar


class TestJavaAnalyzerFallback(unittest.TestCase):
    def test_missing_jar_produces_unavailable_finding(self):
        # Point to a non-existent path
        with patch("os.path.exists") as mock_exists:
            # mock_exists returns False for the JAR path
            def side_effect(path):
                if "java-analyzer" in path and path.endswith(".jar"):
                    return False
                return True
            mock_exists.side_effect = side_effect

            findings, key_funcs, endpoints, nodes, edges = analyze_java_with_jar("dummy_repo")
            self.assertEqual(len(findings), 1)
            f = findings[0]
            self.assertEqual(f.ruleId, "analyzer-unavailable")
            self.assertEqual(f.category, "code-smell")
            self.assertEqual(f.severity, "info")
            self.assertIn("Java static analyzer unavailable", f.message)
            self.assertIn("JAR not found", f.message)
            self.assertEqual(len(nodes), 0)
            self.assertEqual(len(edges), 0)

    def test_subprocess_failure_produces_unavailable_finding(self):
        with patch("os.path.exists", return_value=True), \
             patch("subprocess.run") as mock_run:
            mock_run.side_effect = subprocess.CalledProcessError(
                returncode=1,
                cmd=["java", "-jar"],
                stderr="Fatal error inside Java parser"
            )

            findings, key_funcs, endpoints, nodes, edges = analyze_java_with_jar("dummy_repo")
            self.assertEqual(len(findings), 1)
            f = findings[0]
            self.assertEqual(f.ruleId, "analyzer-unavailable")
            self.assertEqual(f.category, "code-smell")
            self.assertEqual(f.severity, "info")
            self.assertIn("Java static analyzer unavailable", f.message)
            self.assertIn("Fatal error inside Java parser", f.message)

if __name__ == "__main__":
    unittest.main()
