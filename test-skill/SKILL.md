---
name: test-py
description: A test skill that runs Python via Pyodide. Say "test python" or "run test skill" to trigger it.
run: scripts/hello.py
---
# Test Python Skill

This skill tests Python execution in the browser via Pyodide. When invoked, it runs `hello.py` which processes the arguments and returns a result.

Usage: ask the AI to "use the test python skill" or "run test-py with {name: 'World'}".
