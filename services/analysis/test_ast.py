import sys
import traceback
from analyzer.static_analyzer import analyze_repo

try:
    # We will test the endpoint that failed
    print("Testing analyze_repo...")
    results = analyze_repo("C:\\Users\\Lucky Bhoir\\AppData\\Local\\Temp") # A temp dir where repo might be
    print("Done", type(results))
except Exception as e:
    traceback.print_exc()
