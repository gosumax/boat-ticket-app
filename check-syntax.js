#!/usr/bin/env node
/**
 * Syntax checker script to validate all JavaScript/ESM files in the server directory
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const serverDir = './server';
const filesToCheck = [];

// Recursively find all .js and .mjs files in the server directory
function findFiles(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      findFiles(fullPath);
    } else if (item.endsWith('.js') || item.endsWith('.mjs')) {
      filesToCheck.push(fullPath);
    }
  }
}

console.log('🔍 Checking syntax for server files...\n');

findFiles(serverDir);

let errors = 0;
let totalChecked = 0;

for (const file of filesToCheck) {
  try {
    // Use Node.js built-in syntax check
    execSync(`node --check ${file}`, { stdio: 'pipe' });
    console.log(`✅ ${file}`);
    totalChecked++;
  } catch (error) {
    console.log(`❌ ${file}`);
    console.log(`   Error: ${error.stderr.toString().trim()}`);
    errors++;
    console.log('');
  }
}

console.log(`\n📊 Summary: ${totalChecked} files checked`);
if (errors > 0) {
  console.log(`❌ ${errors} file(s) have syntax errors`);
  process.exit(1);
} else {
  console.log(`✅ All files passed syntax validation`);
  process.exit(0);
}