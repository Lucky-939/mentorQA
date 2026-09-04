from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any

from analyzer.static_analyzer import run_static_analysis, Finding

app = FastAPI(
    title="MentorQA Analysis Service",
    description="Code analysis microservice — tree-sitter, JavaParser (Phase 1+)",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeStaticRequest(BaseModel):
    repoPath: str
    detectedStack: Dict[str, Any]

class AnalyzeStaticResponse(BaseModel):
    findings: List[Finding]

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "mentorqa-analysis",
        "version": "0.1.0",
    }

@app.post("/analyze/static", response_model=AnalyzeStaticResponse)
async def analyze_static(req: AnalyzeStaticRequest):
    try:
        findings = run_static_analysis(req.repoPath, req.detectedStack)
        return AnalyzeStaticResponse(findings=findings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
