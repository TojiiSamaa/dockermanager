/**
 * Connection Tests
 * Basic tests to verify SSH and Docker API connections work correctly
 */

import { dockerService, ServerConfig } from "../services/docker-service";

/**
 * Test SSH connection with a server config
 */
export async function testSSHConnection(config: ServerConfig): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    console.log("[TEST] Testing SSH connection to:", config.sshHost);

    // Configure the service
    await dockerService.configure(config);

    // Try to connect
    const connected = await dockerService.connect();

    if (!connected) {
      return {
        success: false,
        message: "Failed to establish SSH connection",
      };
    }

    // Try to list containers as a validation
    const containers = await dockerService.listContainers();

    // Disconnect
    await dockerService.disconnect();

    return {
      success: true,
      message: `Connected successfully! Found ${containers.length} container(s)`,
      details: {
        containerCount: containers.length,
        activeHost: config.sshHost,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Connection test failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: { error },
    };
  }
}

/**
 * Test Docker API connection
 */
export async function testDockerAPIConnection(config: ServerConfig): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    console.log("[TEST] Testing Docker API connection to:", config.dockerHost);

    // Configure the service
    await dockerService.configure(config);

    // Try to connect
    const connected = await dockerService.connect();

    if (!connected) {
      return {
        success: false,
        message: "Failed to establish Docker API connection",
      };
    }

    // Try to list containers as a validation
    const containers = await dockerService.listContainers();

    // Disconnect
    await dockerService.disconnect();

    return {
      success: true,
      message: `Connected successfully! Found ${containers.length} container(s)`,
      details: {
        containerCount: containers.length,
        apiHost: config.dockerHost,
        apiPort: config.dockerPort,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Connection test failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: { error },
    };
  }
}

/**
 * Test connection with backup addresses failover
 */
export async function testBackupAddressesFailover(config: ServerConfig): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    console.log("[TEST] Testing backup address failover");

    if (!config.backupAddresses || config.backupAddresses.length === 0) {
      return {
        success: false,
        message: "No backup addresses configured",
      };
    }

    // Configure with intentionally wrong primary host
    const testConfig: ServerConfig = {
      ...config,
      sshHost: "intentionally-wrong-host.local", // This should fail
    };

    await dockerService.configure(testConfig);

    // Try to connect - should failover to backup
    const connected = await dockerService.connect();

    if (!connected) {
      return {
        success: false,
        message: "Failover to backup address did not work",
      };
    }

    const activeHost = dockerService.getActiveHost();

    // Disconnect
    await dockerService.disconnect();

    return {
      success: true,
      message: `Failover successful! Connected to backup: ${activeHost}`,
      details: {
        primaryHost: testConfig.sshHost,
        activeHost,
        backupAddresses: config.backupAddresses,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failover test failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: { error },
    };
  }
}

/**
 * Run all connection tests
 */
export async function runAllConnectionTests(config: ServerConfig): Promise<{ passed: number; failed: number; results: any[] }> {
  const results = [];
  let passed = 0;
  let failed = 0;

  console.log("=".repeat(60));
  console.log("RUNNING CONNECTION TESTS");
  console.log("=".repeat(60));

  // Test 1: SSH Connection
  if (config.connectionType === "ssh") {
    console.log("\n[TEST 1/3] SSH Connection Test");
    const result = await testSSHConnection(config);
    results.push({ test: "SSH Connection", ...result });
    if (result.success) passed++;
    else failed++;
    console.log(result.success ? "✅ PASSED" : "❌ FAILED", "-", result.message);
  }

  // Test 2: Docker API Connection
  if (config.connectionType === "docker-api") {
    console.log("\n[TEST 1/3] Docker API Connection Test");
    const result = await testDockerAPIConnection(config);
    results.push({ test: "Docker API Connection", ...result });
    if (result.success) passed++;
    else failed++;
    console.log(result.success ? "✅ PASSED" : "❌ FAILED", "-", result.message);
  }

  // Test 3: Backup Address Failover (only for SSH with backup addresses)
  if (config.connectionType === "ssh" && config.backupAddresses && config.backupAddresses.length > 0) {
    console.log("\n[TEST 2/3] Backup Address Failover Test");
    const result = await testBackupAddressesFailover(config);
    results.push({ test: "Backup Address Failover", ...result });
    if (result.success) passed++;
    else failed++;
    console.log(result.success ? "✅ PASSED" : "❌ FAILED", "-", result.message);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  return { passed, failed, results };
}
