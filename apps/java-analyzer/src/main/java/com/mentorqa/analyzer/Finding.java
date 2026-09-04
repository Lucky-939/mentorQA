package com.mentorqa.analyzer;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class Finding {
    public String id;
    public String category;
    public String severity;
    public String file;
    public int lineStart;
    public int lineEnd;
    public String message;
    public String ruleId;
    public Map<String, Object> metadata;

    public Finding() {}

    public Finding(String category, String severity, String file, int lineStart, int lineEnd, String message, String ruleId) {
        this.id = UUID.randomUUID().toString();
        this.category = category;
        this.severity = severity;
        this.file = file;
        this.lineStart = lineStart;
        this.lineEnd = lineEnd;
        this.message = message;
        this.ruleId = ruleId;
    }
}
