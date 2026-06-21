---
name: test-py
description: Test skill. Calling skill_test-py runs a Python script automatically in the browser — no code writing needed. Use when the user says "test python" or "run test skill".
run: scripts/hello.py
---
# Test Python Skill

When you invoke this skill (output a JSONL function call for `skill_test-py`), the extension automatically runs `hello.py` in a sandboxed Python environment (Pyodide) and returns the result. You don't write any Python — just call the skill.

Example call:
```jsonl
{"type": "function_call_start", "name": "skill_test-py", "call_id": 1}
{"type": "description", "text": "Run the test Python skill"}
{"type": "parameter", "key": "name", "value": "World"}
{"type": "function_call_end", "call_id": 1}
```
