/**
 * Functionality Tests
 * Tests for Docker operations (start, stop, logs, etc.)
 */

import { dockerService, ServerConfig } from "../services/docker-service";

/**
 * Test listing containers
 */
export async function testListContainers(config: ServerConfig): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    await dockerService.configure(config);
    await dockerService.connect();

    const containers = await dockerService.listContainers();

    await dockerService.disconnect();

    return {
      success: true,
      message: `Listed ${containers.length} container(s) successfully`,
      details: {
        containerCount: containers.length,
        containers: containers.map(c => ({ name: c.name, state: c.state })),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to list containers: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: { error },
    };
  }
}

/**
 * Test getting container state
 */
export async function testGetContainerState(config: ServerConfig, containerName: string): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    await dockerService.configure(config);
    await dockerService.connect();

    const state = await dockerService.getContainerState(containerName);

    await dockerService.disconnect();

    return {
      success: true,
      message: `Container "${containerName}" is ${state}`,
      details: { containerName, state },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get container state: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: { error },
    };
  }
}

/**
 * Test getting container health
 */
export async function testGetContainerHealth(config: ServerConfig, containerName: string): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    await dockerService.configure(config);
    await dockerService.connect();

    const health = await dockerService.getContainerHealth(containerName);

    await dockerService.disconnect();

    return {
      success: true,
      message: `Container health: ${health.state} (uptime: ${health.uptime}s, restarts: ${health.restartCount})`,
      details: { containerName, health },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get container health: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: { error },
    };
  }
}

/**
 * Test start/stop cycle for a container
 */
export async function testStartStopCycle(config: ServerConfig, containerName: string): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    await dockerService.configure(config);
    await dockerService.connect();

    // Get initial state
    const initialState = await dockerService.getContainerState(containerName);
    console.log(`[TEST] Initial state: ${initialState}`);

    let targetState: "running" | "stopped";
    let action: "start" | "stop";

    // If running, stop it. If stopped, start it.
    if (initialState === "running") {
      action = "stop";
      targetState = "stopped";
    } else {
      action = "start";
      targetState = "running";
    }

    // Perform action
    console.log(`[TEST] Performing ${action} on ${containerName}`);
    const result = action === "start"
      ? await dockerService.startContainer(containerName)
      : await dockerService.stopContainer(containerName);

    if (!result) {
      throw new Error(`Failed to ${action} container`);
    }

    // Wait for state change (give it 2 seconds)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check new state
    const newState = await dockerService.getContainerState(containerName);
    console.log(`[TEST] New state: ${newState}`);

    // Restore original state
    console.log(`[TEST] Restoring to initial state: ${initialState}`);
    const restoreResult = initialState === "running"
      ? await dockerService.startContainer(containerName)
      : await dockerService.stopContainer(containerName);

    await dockerService.disconnect();

    const cycleSuccess = (action === "start" && newState === "running") ||
                         (action === "stop" && (newState === "stopped" || newState === "exited"));

    return {
      success: cycleSuccess && restoreResult,
      message: cycleSuccess
        ? `Start/Stop cycle completed successfully (${initialState} → ${action} → ${newState} → restored)`
        : `State change did not work as expected`,
      details: {
        containerName,
        initialState,
        action,
        newState,
        restored: restoreResult,
      },
    };
  } catch (error) {
    // Try to disconnect
    try {
      await dockerService.disconnect();
    } catch {}

    return {
      success: false,
      message: `Start/Stop cycle failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: { error },
    };
  }
}

/**
 * Test getting container logs
 */
export async function testGetContainerLogs(config: ServerConfig, containerName: string): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    await dockerService.configure(config);
    await dockerService.connect();

    const logs = await dockerService.getContainerLogs(containerName, 10);

    await dockerService.disconnect();

    const lineCount = logs.split("\n").filter(line => line.trim()).length;

    return {
      success: true,
      message: `Retrieved ${lineCount} lines of logs from "${containerName}"`,
      details: {
        containerName,
        lineCount,
        logsSample: logs.substring(0, 200) + (logs.length > 200 ? "..." : ""),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get container logs: ${error instanceof Error ? error.message : "Unknown error"}`,
      details: { error },
    };
  }
}

/**
 * Run all functionality tests
 */
export async function runAllFunctionalityTests(config: ServerConfig, testContainerName?: string): Promise<{ passed: number; failed: number; results: any[] }> {
  const results = [];
  let passed = 0;
  let failed = 0;

  console.log("=".repeat(60));
  console.log("RUNNING FUNCTIONALITY TESTS");
  console.log("=".repeat(60));

  // Test 1: List Containers
  console.log("\n[TEST 1/5] List Containers");
  const listResult = await testListContainers(config);
  results.push({ test: "List Containers", ...listResult });
  if (listResult.success) passed++;
  else failed++;
  console.log(listResult.success ? "✅ PASSED" : "❌ FAILED", "-", listResult.message);

  // If we have a test container, run more tests
  if (testContainerName && listResult.success) {
    // Test 2: Get Container State
    console.log(`\n[TEST 2/5] Get Container State (${testContainerName})`);
    const stateResult = await testGetContainerState(config, testContainerName);
    results.push({ test: "Get Container State", ...stateResult });
    if (stateResult.success) passed++;
    else failed++;
    console.log(stateResult.success ? "✅ PASSED" : "❌ FAILED", "-", stateResult.message);

    // Test 3: Get Container Health
    console.log(`\n[TEST 3/5] Get Container Health (${testContainerName})`);
    const healthResult = await testGetContainerHealth(config, testContainerName);
    results.push({ test: "Get Container Health", ...healthResult });
    if (healthResult.success) passed++;
    else failed++;
    console.log(healthResult.success ? "✅ PASSED" : "❌ FAILED", "-", healthResult.message);

    // Test 4: Start/Stop Cycle
    console.log(`\n[TEST 4/5] Start/Stop Cycle (${testContainerName})`);
    const cycleResult = await testStartStopCycle(config, testContainerName);
    results.push({ test: "Start/Stop Cycle", ...cycleResult });
    if (cycleResult.success) passed++;
    else failed++;
    console.log(cycleResult.success ? "✅ PASSED" : "❌ FAILED", "-", cycleResult.message);

    // Test 5: Get Container Logs
    console.log(`\n[TEST 5/5] Get Container Logs (${testContainerName})`);
    const logsResult = await testGetContainerLogs(config, testContainerName);
    results.push({ test: "Get Container Logs", ...logsResult });
    if (logsResult.success) passed++;
    else failed++;
    console.log(logsResult.success ? "✅ PASSED" : "❌ FAILED", "-", logsResult.message);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  return { passed, failed, results };
}
