import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 为构建产物设置可执行权限
fs.chmodSync(path.join(__dirname, '..', 'build', 'index.js'), '755');
fs.chmodSync(path.join(__dirname, '..', 'build', 'cli.js'), '755');

// Copy the scripts directory to the build directory
try {
  // Ensure the build/scripts directory exists
  fs.ensureDirSync(path.join(__dirname, '..', 'build', 'scripts'));
  
  // Copy the godot_operations.gd file
  fs.copyFileSync(
    path.join(__dirname, '..', 'src', 'scripts', 'godot_operations.gd'),
    path.join(__dirname, '..', 'build', 'scripts', 'godot_operations.gd')
  );
  
  console.log('Successfully copied godot_operations.gd to build/scripts');
} catch (error) {
  console.error('Error copying scripts:', error);
  process.exit(1);
}

// 为 cli.js 添加 shebang 行
const cliPath = path.join(__dirname, '..', 'build', 'cli.js');
try {
  const cliContent = fs.readFileSync(cliPath, 'utf-8');
  if (!cliContent.startsWith('#!')) {
    fs.writeFileSync(cliPath, '#!/usr/bin/env node\n' + cliContent);
    console.log('Added shebang to build/cli.js');
  }
} catch (error) {
  console.error('Error adding shebang to cli.js:', error);
  process.exit(1);
}

console.log('Build scripts completed successfully!');
