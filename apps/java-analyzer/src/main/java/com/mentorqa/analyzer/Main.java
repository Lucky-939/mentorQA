package com.mentorqa.analyzer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.MethodDeclaration;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class Main {
    public static void main(String[] args) {
        if (args.length < 1) {
            System.err.println("Usage: java -jar java-analyzer.jar <directory_path>");
            System.exit(1);
        }

        String targetDir = args[0];
        List<Finding> findings = new ArrayList<>();

        try (Stream<Path> paths = Files.walk(Path.of(targetDir))) {
            List<Path> javaFiles = paths
                    .filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".java"))
                    .collect(Collectors.toList());

            for (Path javaFile : javaFiles) {
                try {
                    CompilationUnit cu = StaticJavaParser.parse(javaFile);
                    String relativePath = Path.of(targetDir).relativize(javaFile).toString();

                    // Rule 1: Long Method smell (Code Smell)
                    cu.findAll(MethodDeclaration.class).forEach(method -> {
                        int lineCount = method.getEnd().map(p -> p.line).orElse(0) - method.getBegin().map(p -> p.line).orElse(0);
                        if (lineCount > 50) {
                            findings.add(new Finding(
                                    "code-smell",
                                    "medium",
                                    relativePath.replace("\\", "/"),
                                    method.getBegin().map(p -> p.line).orElse(1),
                                    method.getEnd().map(p -> p.line).orElse(1),
                                    "Method '" + method.getNameAsString() + "' is too long (" + lineCount + " lines). Consider refactoring.",
                                    "java-long-method"
                            ));
                        }
                    });

                    // Rule 2: Hardcoded secrets heuristics
                    cu.findAll(com.github.javaparser.ast.expr.StringLiteralExpr.class).forEach(strExpr -> {
                        String value = strExpr.getValue();
                        String lower = value.toLowerCase();
                        if ((lower.contains("password") || lower.contains("secret") || lower.contains("api_key") || lower.contains("token")) && value.length() > 5) {
                            // simplistic heuristic for demonstration
                            if (value.matches(".*[a-zA-Z0-9_-]{16,}.*")) {
                                findings.add(new Finding(
                                        "security",
                                        "high",
                                        relativePath.replace("\\", "/"),
                                        strExpr.getBegin().map(p -> p.line).orElse(1),
                                        strExpr.getEnd().map(p -> p.line).orElse(1),
                                        "Potential hardcoded secret detected in string literal.",
                                        "java-hardcoded-secret"
                                ));
                            }
                        }
                    });

                } catch (Exception e) {
                    // Skip parsing errors for individual files
                    System.err.println("Warning: Failed to parse " + javaFile.toString());
                }
            }

            ObjectMapper mapper = new ObjectMapper();
            System.out.println(mapper.writeValueAsString(findings));

        } catch (Exception e) {
            System.err.println("Error analyzing directory: " + e.getMessage());
            System.exit(1);
        }
    }
}
