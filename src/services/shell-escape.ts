/**
 * Shell command escaping utilities
 * Prevents command injection vulnerabilities
 */

/**
 * Escape a string for use in a shell command (POSIX sh/bash)
 * Similar to Python's shlex.quote()
 *
 * @param arg - The argument to escape
 * @returns Safely escaped argument
 */
export function escapeShellArg(arg: string): string {
  if (!arg) {
    return "''";
  }

  // If the string contains only safe characters, no escaping needed
  if (/^[a-zA-Z0-9_\-\.\/]+$/.test(arg)) {
    return arg;
  }

  // Use single quotes and escape any single quotes in the string
  // Single quotes prevent all expansions ($, `, etc.)
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Escape a string for use in a Windows cmd.exe command
 *
 * @param arg - The argument to escape
 * @returns Safely escaped argument for Windows
 */
export function escapeWindowsArg(arg: string): string {
  if (!arg) {
    return '""';
  }

  // If the string contains only safe characters, no escaping needed
  if (/^[a-zA-Z0-9_\-\.\/\\:]+$/.test(arg)) {
    return arg;
  }

  // Escape special characters for cmd.exe
  let escaped = arg.replace(/"/g, '""'); // Escape quotes
  escaped = escaped.replace(/([&|<>^])/g, "^$1"); // Escape cmd special chars

  return '"' + escaped + '"';
}

/**
 * Platform-aware shell argument escaping
 * Automatically uses the correct escaping method based on the platform
 *
 * @param arg - The argument to escape
 * @returns Safely escaped argument
 */
export function escapeArg(arg: string): string {
  if (process.platform === "win32") {
    return escapeWindowsArg(arg);
  }
  return escapeShellArg(arg);
}

/**
 * Build a safe shell command from a command and arguments
 *
 * @param command - The command to run (not escaped)
 * @param args - Arguments to pass (will be escaped)
 * @returns Safe command string
 *
 * @example
 * buildCommand("docker", ["start", containerName])
 * // Returns: "docker start 'my-container'"
 */
export function buildCommand(command: string, args: string[]): string {
  const escapedArgs = args.map(escapeArg);
  return [command, ...escapedArgs].join(" ");
}

/**
 * Escape a file path for use in shell commands
 * Handles spaces and special characters
 *
 * @param path - The file path to escape
 * @returns Safely escaped path
 */
export function escapePath(path: string): string {
  return escapeArg(path);
}

/**
 * Validate that a string only contains safe characters for use as a container/image name
 * Docker allows: [a-zA-Z0-9][a-zA-Z0-9_.-]
 *
 * @param name - The container/image name to validate
 * @returns true if valid, false otherwise
 */
export function isValidDockerName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
}

/**
 * Sanitize a container/image name
 * If invalid, throws an error
 *
 * @param name - The name to sanitize
 * @returns The name if valid
 * @throws Error if name is invalid
 */
export function sanitizeDockerName(name: string): string {
  if (!isValidDockerName(name)) {
    throw new Error(`Invalid Docker name: ${name}`);
  }
  return name;
}

/**
 * Build a docker command with safe argument escaping
 *
 * @param subcommand - Docker subcommand (e.g., "start", "stop")
 * @param containerName - Container name (will be validated and escaped)
 * @param additionalArgs - Additional arguments (will be escaped)
 * @returns Safe docker command
 *
 * @example
 * buildDockerCommand("start", "my-container")
 * // Returns: "docker start 'my-container'"
 */
export function buildDockerCommand(
  subcommand: string,
  containerName: string,
  ...additionalArgs: string[]
): string {
  // Validate container name (critical security check)
  const safeName = sanitizeDockerName(containerName);

  return buildCommand("docker", [subcommand, safeName, ...additionalArgs]);
}

/**
 * Escape a URL for use in shell commands (for opening URLs)
 *
 * @param url - The URL to escape
 * @returns Safely escaped URL
 */
export function escapeURL(url: string): string {
  // Basic URL validation
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Escape for shell
  return escapeArg(url);
}

/**
 * Sanitize text for clipboard operations
 * Prevents command injection via clipboard
 *
 * @param text - Text to sanitize
 * @returns Sanitized text
 */
export function sanitizeClipboardText(text: string): string {
  // For clipboard, we need to be extra careful
  // Remove any backticks, $(), ${}, and other shell metacharacters
  return text.replace(/[`$(){}[\]|&;<>]/g, "");
}
