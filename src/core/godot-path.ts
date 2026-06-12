/**
 * Godot 可执行文件路径检测逻辑
 * 包含平台检测、默认路径、PATH 搜索、版本验证
 */

import { normalize } from 'path';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);

// 调试模式
const DEBUG_MODE: boolean = process.env.DEBUG === 'true';

function logDebug(message: string): void {
  if (DEBUG_MODE) {
    console.error(`[DEBUG] ${message}`);
  }
}

/**
 * 同步检查路径是否可能是有效的 Godot 路径（只检查文件存在性）
 */
export function isValidGodotPathSync(path: string): boolean {
  try {
    logDebug(`Quick-validating Godot path: ${path}`);
    return path === 'godot' || existsSync(path);
  } catch (error) {
    logDebug(`Invalid Godot path: ${path}, error: ${error}`);
    return false;
  }
}

/**
 * 异步验证 Godot 路径是否有效且可执行
 */
export async function isValidGodotPath(
  path: string,
  cache: Map<string, boolean>
): Promise<boolean> {
  // 优先使用缓存
  if (cache.has(path)) {
    return cache.get(path)!;
  }

  try {
    logDebug(`Validating Godot path: ${path}`);

    if (path !== 'godot' && !existsSync(path)) {
      logDebug(`Path does not exist: ${path}`);
      cache.set(path, false);
      return false;
    }

    // 尝试执行 --version 验证
    await execFileAsync(path, ['--version']);

    logDebug(`Valid Godot path: ${path}`);
    cache.set(path, true);
    return true;
  } catch (error) {
    logDebug(`Invalid Godot path: ${path}, error: ${error}`);
    cache.set(path, false);
    return false;
  }
}

/**
 * 自动检测 Godot 可执行文件路径
 * @returns 找到的 Godot 路径，或 null
 */
export async function detectGodotPath(
  currentPath: string | null,
  cache: Map<string, boolean>,
  strictPathValidation: boolean
): Promise<string | null> {
  // 如果已有路径且有效，直接返回
  if (currentPath && await isValidGodotPath(currentPath, cache)) {
    logDebug(`Using existing Godot path: ${currentPath}`);
    return currentPath;
  }

  // 检查环境变量
  if (process.env.GODOT_PATH) {
    const normalizedPath = normalize(process.env.GODOT_PATH);
    logDebug(`Checking GODOT_PATH environment variable: ${normalizedPath}`);
    if (await isValidGodotPath(normalizedPath, cache)) {
      logDebug(`Using Godot path from environment: ${normalizedPath}`);
      return normalizedPath;
    } else {
      logDebug(`GODOT_PATH environment variable is invalid`);
    }
  }

  // 按平台自动检测
  const osPlatform = process.platform;
  logDebug(`Auto-detecting Godot path for platform: ${osPlatform}`);

  const possiblePaths: string[] = ['godot'];

  if (osPlatform === 'darwin') {
    possiblePaths.push(
      '/Applications/Godot.app/Contents/MacOS/Godot',
      '/Applications/Godot_4.app/Contents/MacOS/Godot',
      `${process.env.HOME}/Applications/Godot.app/Contents/MacOS/Godot`,
      `${process.env.HOME}/Applications/Godot_4.app/Contents/MacOS/Godot`,
      `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot`
    );
  } else if (osPlatform === 'win32') {
    possiblePaths.push(
      'C:\\Program Files\\Godot\\Godot.exe',
      'C:\\Program Files (x86)\\Godot\\Godot.exe',
      'C:\\Program Files\\Godot_4\\Godot.exe',
      'C:\\Program Files (x86)\\Godot_4\\Godot.exe',
      `${process.env.USERPROFILE}\\Godot\\Godot.exe`,
      `${process.env.USERPROFILE}\\Desktop\\Godot_v4.6.3.exe`,
      'D:\\Users\\chany\\Desktop\\Godot_v4.6.3.exe'
    );
  } else if (osPlatform === 'linux') {
    possiblePaths.push(
      '/usr/bin/godot',
      '/usr/local/bin/godot',
      '/snap/bin/godot',
      `${process.env.HOME}/.local/bin/godot`
    );
  }

  // 逐一尝试
  for (const path of possiblePaths) {
    const normalizedPath = normalize(path);
    if (await isValidGodotPath(normalizedPath, cache)) {
      logDebug(`Found Godot at: ${normalizedPath}`);
      return normalizedPath;
    }
  }

  // 找不到 Godot
  logDebug(`Warning: Could not find Godot in common locations for ${osPlatform}`);
  console.error(`[SERVER] Could not find Godot in common locations for ${osPlatform}`);
  console.error(`[SERVER] Set GODOT_PATH=/path/to/godot environment variable or pass { godotPath: '/path/to/godot' } in the config to specify the correct path.`);

  if (strictPathValidation) {
    throw new Error(`Could not find a valid Godot executable. Set GODOT_PATH or provide a valid path in config.`);
  }

  // 非严格模式下使用默认路径
  let fallback: string;
  if (osPlatform === 'win32') {
    fallback = normalize('C:\\Program Files\\Godot\\Godot.exe');
  } else if (osPlatform === 'darwin') {
    fallback = normalize('/Applications/Godot.app/Contents/MacOS/Godot');
  } else {
    fallback = normalize('/usr/bin/godot');
  }

  logDebug(`Using default path: ${fallback}, but this may not work.`);
  console.error(`[SERVER] Using default path: ${fallback}, but this may not work.`);
  console.error(`[SERVER] This fallback behavior will be removed in a future version. Set strictPathValidation: true to opt-in to the new behavior.`);

  return fallback;
}

/**
 * 检查 Godot 版本是否 >= 4.4
 */
export function isGodot44OrLater(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)/);
  if (match) {
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    return major > 4 || (major === 4 && minor >= 4);
  }
  return false;
}
