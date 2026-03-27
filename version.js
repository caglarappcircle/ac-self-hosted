#!/usr/bin/env node
'use strict';

// Source: https://stackoverflow.com/a/49351294 by Maxxim

// Compare two version strings [v1, v2]
// Return values:
//   0: v1 == v2
//   1: v1 > v2
//   2: v1 < v2
// Based on: https://stackoverflow.com/a/4025065 by Dennis Williamson
function compareVersions(v1, v2) {
  // Trivial v1 == v2 test based on string comparison
  if (v1 === v2) return 0;

  const regex = /^(.*)-r([0-9]*)$/;
  let va1, vr1 = 0, va2, vr2 = 0;

  // Split version strings into arrays, extract trailing revisions
  const match1 = v1.match(regex);
  if (match1) {
    va1 = match1[1].split('.');
    if (match1[2]) vr1 = parseInt(match1[2], 10);
  } else {
    va1 = v1.split('.');
  }

  const match2 = v2.match(regex);
  if (match2) {
    va2 = match2[1].split('.');
    if (match2[2]) vr2 = parseInt(match2[2], 10);
  } else {
    va2 = v2.split('.');
  }

  // Bring va1 and va2 to same length by filling empty fields with zeros
  const len = Math.max(va1.length, va2.length);
  for (let i = 0; i < len; i++) {
    if (va1[i] === undefined || va1[i] === '') va1[i] = '0';
    if (va2[i] === undefined || va2[i] === '') va2[i] = '0';
  }

  // Append revisions
  va1.push(String(vr1));
  va2.push(String(vr2));

  // Compare version elements, check if v1 > v2 or v1 < v2
  for (let i = 0; i < va1.length; i++) {
    const n1 = parseInt(va1[i], 10);
    const n2 = parseInt(va2[i], 10);
    if (n1 > n2) return 1;
    if (n1 < n2) return 2;
  }

  // All elements are equal, thus v1 == v2
  return 0;
}

// Export for use as module
module.exports = { compareVersions };

// If run directly from command line
if (require.main === module) {
  const v1 = process.argv[2];
  const v2 = process.argv[3];
  if (!v1 || !v2) {
    console.error('Usage: node version.js <version1> <version2>');
    console.error('Return codes: 0 = equal, 1 = v1 > v2, 2 = v1 < v2');
    process.exit(255);
  }
  const result = compareVersions(v1, v2);
  process.exit(result);
}
