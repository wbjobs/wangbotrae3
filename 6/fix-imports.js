#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

function fixFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, (match, importPath) => {
        if (importPath.endsWith('.js') || importPath.endsWith('.json')) {
            return match;
        }
        const fixedPath = importPath + '.js';
        return match.replace(importPath, fixedPath);
    });
    fs.writeFileSync(filePath, content);
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            walkDir(fullPath);
        } else if (file.endsWith('.js')) {
            fixFile(fullPath);
        }
    }
}

if (fs.existsSync(distDir)) {
    walkDir(distDir);
    console.log('Fixed import paths in dist directory');
} else {
    console.error('dist directory not found. Run tsc first.');
}
