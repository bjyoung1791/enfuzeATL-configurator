// Returns build metadata for the client to display as a "build stamp".
// Vercel automatically populates the VERCEL_* env vars on every deploy.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    sha: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7),
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    env: process.env.VERCEL_ENV || "development",
    // Commit message first line, trimmed to fit in a tooltip
    message: (process.env.VERCEL_GIT_COMMIT_MESSAGE || "").split("\n")[0].slice(0, 120),
    // Best-effort build time: Vercel sets this on serverless functions
    builtAt: new Date().toISOString(),
  });
}
