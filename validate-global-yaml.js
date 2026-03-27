#!/usr/bin/env node

'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function yq(expr, filePath) {
  return execFileSync('yq', [expr, filePath], { encoding: 'utf8' }).trim();
}

function main(args) {
  const version = 'v1.0.0';

  if (args[0] === '-h' || args[0] === '--help') {
    console.log('Validates if the global yaml is correctly configured.');
    console.log(`Example usage: ${path.basename(process.argv[1])} spacetech`);
    process.exit(0);
  }

  if (args[0] === '-v' || args[0] === '--version') {
    console.log(version);
    process.exit(0);
  }

  const projectName = args[0];
  const containerEngine = args[1];
  let variablesPath = args[2] || './variables';

  if (args.length < 2) {
    console.log('Project name and container engine must be provided.');
    console.log(`Example usage: ${path.basename(process.argv[1])} spacetech docker`);
    process.exit(1);
  }

  const schemaPath = path.join(variablesPath, 'schema.yaml');
  const errorYamlPath = path.join(variablesPath, 'error.yaml');
  const globalYamlPath = `./projects/${projectName}/export/.global.yaml`;

  if (!fs.existsSync(globalYamlPath)) {
    console.log("Project global yaml couldn't be found.");
    console.log('Please be sure that the project you provided exists.');
    process.exit(1);
  }

  execFileSync(containerEngine, ['cp', schemaPath, 'toolbox:/schema.yaml'], { stdio: 'inherit' });
  execFileSync(containerEngine, ['cp', globalYamlPath, 'toolbox:/global.yaml'], { stdio: 'inherit' });

  const result = spawnSync(
    containerEngine,
    ['exec', 'toolbox', 'yamale', '-s', '/schema.yaml', '--no-strict', '/global.yaml'],
    { encoding: 'utf8' }
  );

  const output = (result.stdout || '') + (result.stderr || '');
  const lines = output.split('\n').slice(3).filter(line => line.trim() !== '');

  let isGlobalYamlValid = true;
  let firstMessageSent = false;

  for (const line of lines) {
    if (!firstMessageSent) {
      console.log('Your global yaml is not valid. Please fix the values below:');
      firstMessageSent = true;
      isGlobalYamlValid = false;
    }
    const field = line.split(':')[0].trim();
    const errorMessage = yq(`.${field}`, errorYamlPath);
    process.stdout.write(`\tKey: .${field}, ${errorMessage}\n`);
  }

  if (!isGlobalYamlValid) {
    process.exit(1);
  }
}

main(process.argv.slice(2));
