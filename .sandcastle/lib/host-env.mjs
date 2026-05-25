// On Windows, process.env.HOME is often unset; @ai-hero/sandcastle then falls
// back to a literal "~" home path. Mirror USERPROFILE into HOME when needed.
export function applyHostEnv(env = process.env, platform = process.platform) {
  if (platform !== "win32") {
    return;
  }

  if (!env.HOME && env.USERPROFILE) {
    env.HOME = env.USERPROFILE;
  }
}
