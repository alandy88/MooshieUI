# Modular extension with upstream sync

We fork MooshieUI and maintain a long-lived branch that periodically merges upstream main. To keep merges clean, all custom code lives in separate files (new Rust template modules, new Svelte component directories, new profile storage modules) with minimal touchpoints to upstream code — limited to adding match arms in `templates/mod.rs`, extending `GenerationParams` in `comfyui/types.rs`, adding mode tab entries in the generation page, and occasional dependency additions. This modular structure means upstream changes almost never conflict with our additions.

We chose this over a hard fork (which would drift and miss upstream improvements) and over deeper integration (which would cause constant merge conflicts with an actively developed upstream). The trade-off is that some features may be harder to implement without modifying upstream code — when that happens, prefer wrapping or extending over patching.
