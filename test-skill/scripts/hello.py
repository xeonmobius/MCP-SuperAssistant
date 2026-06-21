# Test Python script — runs via Pyodide in a sandboxed Worker.
# `args` is injected as a global. Assign `_result` (JSON-serializable) to return.

greeting = "Hello from Python in the browser!"
echo = f"You said: {args}"

_result = {
    "message": greeting,
    "echo": echo,
    "pyodide": True,
}
