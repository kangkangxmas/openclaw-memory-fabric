import { resolve } from "path";

/**
 * Validates that `inputPath`, when resolved, stays within `allowedRoot`.
 * Throws if the resolved path attempts to escape the root (path traversal).
 */
export function validatePath(inputPath: string, allowedRoot: string): string {
  const resolvedRoot = resolve(allowedRoot);
  const resolvedInput = resolve(allowedRoot, inputPath);

  if (!resolvedInput.startsWith(resolvedRoot + "/") && resolvedInput !== resolvedRoot) {
    throw new Error(
      `Path traversal detected: "${inputPath}" resolves outside allowed root "${resolvedRoot}"`
    );
  }

  return resolvedInput;
}

/**
 * Validates a user-supplied ID (agentId / projectId) that will be used as a
 * path segment. Must be non-empty, contain only safe characters, and must not
 * contain path separators or dot-sequences.
 */
export function validateId(id: string, label: string): void {
  if (!id || id.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (/[/\\]/.test(id) || id.includes("..")) {
    throw new Error(
      `${label} "${id}" contains illegal characters (path separators or ".." are not allowed)`
    );
  }
}
