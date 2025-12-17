// Quick test script to debug the parser
import { DXFParser } from './src/dxf-parser.js';
import * as fs from 'fs';

const content = fs.readFileSync('sample.dxf', 'utf8');
console.log('File length:', content.length);
console.log('First 100 chars:', content.substring(0, 100));

// Normalize line endings
const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const lines = normalized.split('\n').map(line => line.trim());

console.log('\nTotal lines:', lines.length);
console.log('First 20 lines:');
for (let i = 0; i < Math.min(20, lines.length); i++) {
    console.log(`${i}: "${lines[i]}" (code: ${parseInt(lines[i])})`);
}

// Test parser
const parser = new DXFParser();
const data = parser.parse(content);

console.log('\nParsed data:');
console.log('Entities:', data.entities.length);
console.log('Layers:', data.layers.length);
console.log('Linetypes:', data.linetypes.length);
console.log('Header keys:', Object.keys(data.header));

if (data.entities.length > 0) {
    console.log('\nFirst entity:', data.entities[0]);
}

if (data.layers.length > 0) {
    console.log('\nFirst layer:', data.layers[0]);
}
