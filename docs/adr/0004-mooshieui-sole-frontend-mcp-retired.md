# MooshieUI is the sole front-end; MCP and other chat clients retired

The agentic image app is built only into MooshieUI. Claude Desktop, Hermes, and `comfyui-mcp-server` are dropped as front-ends and backbone. MooshieUI owns the Generation Spec / Result / check / registry concepts outright (no shared cross-repo contract), and its Rust `execute()` is the single backbone for both interactive and bulk (fan-out) generation.

We chose this over the orchestration design's multi-front-end vision (interchangeable chat clients over a shared MCP backbone) to collapse the architecture: one repo, one execution path, one owner of the Spec. The trade-off is losing headless/no-UI bulk execution — acceptable because MooshieUI's own fan-out orchestrator covers bulk and this is a single-Operator internal tool. Reversing means re-introducing a shared Spec contract and a second backbone.
