#!/usr/bin/env node
'use strict';

const { execSync, execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { compareVersions } = require('./version');

// CWD should be the script's directory, wherever it's called.
const parentPath = __dirname;
process.chdir(parentPath);

// ─── Umask Fix ───────────────────────────────────────────────────────────────
// Systems with umask 027 create files as 640, blocking container users (e.g. uid 10001).
// Set 022 globally for this process so all created files are at least 644.
const originalUmask = process.umask(0o022);
if (originalUmask === 0o027) {
  const bashrc = path.join(os.homedir(), '.bashrc');
  const umaskLine = 'umask 022';
  try {
    const content = fs.existsSync(bashrc) ? fs.readFileSync(bashrc, 'utf8') : '';
    if (!content.includes(umaskLine)) {
      fs.appendFileSync(bashrc, `\n# Added by appcircle script to ensure correct file permissions\n${umaskLine}\n`);
      console.log(`Note: Your system umask was 027 which causes permission issues. Added '${umaskLine}' to ${bashrc} for future sessions.`);
    }
  } catch {
    // non-fatal, just warn
    console.log(`Warning: System umask is 027. Consider adding '${umaskLine}' to your ~/.bashrc to avoid permission issues.`);
  }
}

// ─── State Variables ─────────────────────────────────────────────────────────
let updateSecretFlag = false;
let installPackageFlag = false;
let initializeProjectFlag = false;
let upFlag = false;
let downFlag = false;
let exportFlag = false;
let checkFlag = false;
let resetFlag = false;
let upgradeFlag = false;
let loadFlag = false;
let downloadFlag = false;
let minioMigrateFlag = false;
let versionCommandFlag = false;
let dmzFlag = false;
let useOauthTokenFlag = false;
const configDirectory = './config';
const variableDirectory = './variables';
const postVariableFileName = 'post-variable.yaml';
let postVariableTemplatePath = '';
const secretFileName = 'generated-secret.yaml';
const defaultFileName = 'default.yaml';
let defaultFilePath = '';
let secretFilePath = '';
let secretTemplatePath = '';
const globalFileName = 'global.yaml';
let globalFilePath = '';
const systemVariableFileName = 'system-variable.yaml';
let systemVariablePath = '';
let exportGlobalFilePath = '';
let projectDirectory = './projects';
let projectFilePath = '';
let projectName = '';
const exampleDirectory = `${variableDirectory}/example`;
const exampleGlobalFilePath = `${exampleDirectory}/global.yaml`;
const templateUsersecretFilePath = `${variableDirectory}/user-secret.yaml`;
const promtailJournaldConfigFilePath = `${process.cwd()}/deps/promtail-journald-config.yaml`;
const promtailBinaryPath = `${process.cwd()}/deps/bin/promtail`;
const toolboxImagePath = './deps/toolbox.tar.gz';
const vaultInitIndicatorName = '.vault-initialized';
const codepushDatabaseCreatedIndicatorName = '.codepush-database-created';
const logServiceName = 'appcircle-logging.service';
const userSystemdServicePath = `${os.homedir()}/.config/systemd/user`;
const rootSystemdServicePath = '/etc/systemd/system';
const rootLogServiceFullPath = `${rootSystemdServicePath}/${logServiceName}`;
const userLogServiceFullPath = `${userSystemdServicePath}/${logServiceName}`;
const userSecretFileName = 'user-secret';
const version = '3.29.8';
let versionFlag = false;
let containerTag = `v${version}`;
let dockerCredFile = 'cred.json';
let packageManager = '';
let container = '';
let options = '';
let functionResult = null; // 0=success 1=fail 2=need-sudo
const offlineImagesDir = './container-images';
const offlineImagesPath = `${offlineImagesDir}/appcircle-server-services-${version}-offline.zip`;

let exportPath = '';
let dmzExportPath = '';
let userSecretFilePath = '';
let vaultInitIndicatorPath = '';
let codepushDatabaseCreatedIndicatorPath = '';

// Minio migrate params
let clientVersion = '';
let sourceType = '';
let sourceVersion = '';
let targetType = '';
let targetVersion = '';

// Update PATH
process.env.PATH = `/usr/local/bin:${process.env.PATH}`;
process.env.PATH = `${process.cwd()}/deps/bin:${process.env.PATH}`;

// ─── Utility Helpers ─────────────────────────────────────────────────────────

function exec(cmd, opts) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function execInherit(cmd) {
  execSync(cmd, { encoding: 'utf8', stdio: 'inherit' });
}

function execSilent(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return '';
  }
}

function fileExists(p) {
  return fs.existsSync(p);
}

function readFileTrim(p) {
  return fs.readFileSync(p, 'utf8').trim();
}

function yq(expression, filePath) {
  return exec(`yq '${expression}' "${filePath}"`);
}

function yqInPlace(expression, filePath) {
  execInherit(`yq -i '${expression}' "${filePath}"`);
}

function jqExpr(expression, filePath) {
  return exec(`jq -r '${expression}' "${filePath}"`);
}

function askQuestion(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ─── Print Helpers ───────────────────────────────────────────────────────────

function printPackageInstalled(msg) {
  console.log(`\x1b[92m✔  ${msg}\x1b[0m`);
}

function printPackageRequired(msg) {
  console.log(`\x1b[91m✖  ${msg}\x1b[0m`);
}

function printWarning(msg) {
  process.stdout.write('\x1b[93mWARNING: \x1b[0m');
  console.log(msg);
}

function printError(msg, detail) {
  console.log(`\x1b[91m✖  ${msg}\x1b[0m`);
  if (detail) console.log(`   ${detail}`);
}

// ─── Core Functions ──────────────────────────────────────────────────────────

function setArgument(args) {
  let i = 0;
  while (i < args.length) {
    const param = args[i];
    switch (param) {
      case '-u':
      case '--us':
      case '--update-secret':
        updateSecretFlag = true;
        break;
      case 'init':
        initializeProjectFlag = true;
        break;
      case 'up':
        upFlag = true;
        break;
      case 'down':
        downFlag = true;
        break;
      case 'export':
        exportFlag = true;
        if (args[i + 1] === '--dmz') {
          dmzFlag = true;
          i++;
        }
        break;
      case 'check':
        checkFlag = true;
        break;
      case 'reset':
        resetFlag = true;
        break;
      case 'version':
        versionCommandFlag = true;
        break;
      case 'upgrade':
        upgradeFlag = true;
        break;
      case 'load':
        loadFlag = true;
        break;
      case 'download':
        downloadFlag = true;
        break;
      case 'minio-migrate':
        minioMigrateFlag = true;
        clientVersion = 'RELEASE.2022-10-29T10-09-23Z';
        sourceVersion = 'RELEASE.2020-06-14T18-32-17Z';
        targetVersion = 'RELEASE.2024-03-15T01-07-19Z';
        i++;
        sourceType = args[i];
        i++;
        targetType = args[i];
        break;
      case '-i':
      case '--ip':
      case '--install-package':
        installPackageFlag = true;
        break;
      case '--options':
        i++;
        options = args[i];
        break;
      case '-p':
      case '--pd':
      case '--project-directory':
        projectDirectory = args[i];
        break;
      case '-v':
      case '--version':
        versionFlag = true;
        break;
      case '-c':
      case '--cred':
        dockerCredFile = args[i];
        break;
      case '-t':
      case '--token':
        useOauthTokenFlag = true;
        break;
      case '-d':
      case '--debug':
        // In Node.js we don't have set -x; debug mode could enable verbose logging
        break;
      case '-n':
        i++;
        projectName = args[i];
        break;
      default:
        console.log(`Argument or command not found ${param}`);
        process.exit(1);
    }
    i++;
  }
}

function createVariable() {
  projectFilePath = `${projectDirectory}/${projectName}`;
  exportPath = `${projectFilePath}/export`;
  dmzExportPath = `${exportPath}/dmz`;
  globalFilePath = `${projectFilePath}/${globalFileName}`;
  secretFilePath = `${projectFilePath}/${secretFileName}`;
  exportGlobalFilePath = `${exportPath}/.${globalFileName}`;
  secretTemplatePath = `${variableDirectory}/${secretFileName}`;
  postVariableTemplatePath = `${variableDirectory}/${postVariableFileName}`;
  defaultFilePath = `${variableDirectory}/${defaultFileName}`;
  userSecretFilePath = `${projectFilePath}/${userSecretFileName}`;
  systemVariablePath = `${projectDirectory}/${systemVariableFileName}`;
  vaultInitIndicatorPath = `${projectFilePath}/${vaultInitIndicatorName}`;
  codepushDatabaseCreatedIndicatorPath = `${projectFilePath}/${codepushDatabaseCreatedIndicatorName}`;
  process.env.exportPath = exportPath;
  process.env.projectName = projectName;
}

function checkValidationToRunScript() {
  if (downloadFlag) {
    console.log('');
  } else if (!installPackageFlag && !projectName) {
    console.log('Project name not specified');
    process.exit(1);
  }
}

function checkSudoPermission() {
  if (process.getuid && process.getuid() !== 0) {
    functionResult = 1;
  } else {
    functionResult = 0;
  }
}

function getSystemdUserFlag() {
  if (process.getuid && process.getuid() === 0) {
    return '';
  }
  return '--user';
}

function printSudoWarning() {
  console.log('This script must be run as root');
}

function isDockerDaemonJsonUpToDate(storage, ver) {
  if (!fileExists(storage)) return false;
  const content = parseInt(readFileTrim(storage), 10);
  if (content < ver) return false;
  return true;
}

function configurePodmanLogs() {
  checkSudoPermission();
  console.log('Configuring Podman logs.');
  const logDriver = 'journald';
  const originConfigFile = '/usr/share/containers/containers.conf';
  const configFile = '/etc/containers/containers.conf';
  if (!fileExists(configFile)) {
    execInherit(`cp "${originConfigFile}" "${configFile}"`);
  }
  const content = readFileTrim(configFile);
  if (content.includes(`log_driver = "${logDriver}"`)) {
    console.log(`Log driver is already set to ${logDriver}.`);
  } else {
    execInherit(`cp "${configFile}" "${configFile}.bak"`);
    execInherit(`sed -i "s/^log_driver = .*/log_driver = \\"${logDriver}\\"/" "${configFile}"`);
    console.log(`Log driver has been set to ${logDriver}.`);
  }
}

function configureDockerLogs() {
  checkSudoPermission();

  if (functionResult !== 0) {
    functionResult = 2;
    return;
  }

  functionResult = 0;

  const ver = 2;
  const storage = '.daemon-json.ver';
  if (isDockerDaemonJsonUpToDate(storage, ver)) {
    console.log('Docker daemon json is up-to-date.');
    return;
  }

  const runningContainers = parseInt(exec('docker ps -q -f status=running | wc -l'), 10);
  if (runningContainers > 0) {
    console.log('We need to configure docker daemon.json but docker has running containers.');
    console.log('When you confirmed, script restarts docker engine to apply changes now.');
    const answer = spawnSync('bash', ['-c', 'read -p "Are you sure? (Y/n)" -n 1 -r; echo; echo $REPLY'], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
    const reply = (answer.stdout || '').trim();
    if (/^[Yy]$/.test(reply)) {
      execInherit('systemctl stop docker');
    } else {
      console.log("OK, When you're ready to stop containers or you already stopped for some reason, you can rerun the script to apply docker daemon.json updates.");
      return;
    }
  } else {
    execInherit('systemctl stop docker');
  }

  if (fileExists('/etc/docker/daemon.json')) {
    console.log('daemon.json is already exists');
    execInherit("cat /etc/docker/daemon.json | jq 'del(.[\"log-opts\"])' > ./.daemon.json.tmp && sudo mv .daemon.json.tmp /etc/docker/daemon.json");
    execInherit("cat /etc/docker/daemon.json | jq '.[\"log-driver\"] |= \"journald\"' > ./.daemon.json.tmp && mv ./.daemon.json.tmp /etc/docker/daemon.json");
    console.log('daemon.json was updated');
  } else {
    execInherit('mkdir -p /etc/docker');
    execInherit("echo '{\"log-driver\":\"journald\"}' | sudo tee /etc/docker/daemon.json > /dev/null");
    console.log('daemon.json was created');
  }
  fs.writeFileSync(storage, String(ver));

  execInherit('systemctl start docker');
}

function detectPackageManager() {
  if (packageManager) return;

  if (fileExists('/etc/redhat-release')) packageManager = 'dnf';
  else if (fileExists('/etc/arch-release')) packageManager = 'pacman';
  else if (fileExists('/etc/gentoo-release')) packageManager = 'emerge';
  else if (fileExists('/etc/SuSE-release')) packageManager = 'zypp';
  else if (fileExists('/etc/debian_version')) packageManager = 'apt-get';
  else if (fileExists('/etc/alpine-release')) packageManager = 'apk';
}

function updatePackageWithApt() {
  checkSudoPermission();
  if (functionResult !== 0) {
    printSudoWarning();
    functionResult = 1;
    return;
  }
  execSilent('sudo apt-get update');
  functionResult = 0;
}

function updatePackageWithDnf() {
  checkSudoPermission();
  if (functionResult !== 0) {
    printWarning('dnf check-update need root permission');
    functionResult = 1;
    return;
  }
  execSilent('sudo dnf check-update');
  execSilent('sudo dnf install epel-release -y');
  functionResult = 0;
}

function installDockerManuallyApt() {
  console.log('---------docker installing---------');
  execInherit('apt-get install ca-certificates gnupg lsb-release -y');
  execInherit('mkdir -p /etc/apt/keyrings');
  const dist = exec("lsb_release -is | tr '[:upper:]' '[:lower:]'");
  execInherit(`curl -fsSL "https://download.docker.com/linux/${dist}/gpg" | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg`);
  const arch = exec('dpkg --print-architecture');
  const codename = exec('lsb_release -cs');
  execInherit(`echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${dist} ${codename} stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null`);
  execSilent('apt-get update');
  execInherit('apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y');
  execSilent('groupadd docker');
  const logname = exec('logname');
  execInherit(`usermod -aG docker "${logname}"`);
  execInherit('systemctl enable docker.service');
  execInherit('systemctl enable containerd.service');
  execInherit(`chown "${logname}" /var/run/docker.sock`);
  console.log('---------docker installed----------');
}

function setSystem() {
  let SELinux = 'false';

  // Try running getenforce directly instead of checking with 'command -v' (which is a bash built-in and may not work in all shells)
  // Use full path as /usr/sbin may not be in PATH when running under sudo
  const getenforceCmd = execSilent('which getenforce || echo /usr/sbin/getenforce') || '/usr/sbin/getenforce';
  const SELinuxStatus = execSilent(getenforceCmd);
  if (SELinuxStatus) {
    if (SELinuxStatus === 'Enforcing') {
      console.log('SELinux is enabled.');
      SELinux = 'true';
    } else if (SELinuxStatus === 'Permissive' || SELinuxStatus === 'Disabled') {
      console.log('SELinux is disabled.');
    } else {
      console.error('Unknown SELinux mode!');
      process.exit(1);
    }
  } else {
    console.log("'getenforce' command not found, assuming SELinux is not installed or disabled.");
  }

  setSystemVariable('.SELinux', SELinux);
}

function setSystemVariable(key, value) {
  console.log(`Key=${key} Value=${value} ${systemVariablePath}`);
  process.env.systemVariableKey = key;
  process.env.systemVariableValue = value;
  execInherit(`yq -i 'eval(strenv(systemVariableKey)) = strenv(systemVariableValue)' "${systemVariablePath}"`);
  delete process.env.systemVariableKey;
  delete process.env.systemVariableValue;
}

async function askWhichContainerInstall() {
  if (!options) {
    console.log('Which container engine would you like to use? (1-2)');
    console.log('1) docker');
    console.log('2) podman');
    const answer = await askQuestion('Select: ');
    const engines = ['docker', 'podman'];
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < engines.length) {
      container = engines[idx];
    } else {
      console.log('Please select one of the options using its item number.');
      return askWhichContainerInstall();
    }
    options = `container=${container}`;
  }
}

function setInstallOptions() {
  if (options) {
    const optionArray = options.split(',');
    for (const option of optionArray) {
      const [key, value] = option.split('=');

      if (!fileExists(systemVariablePath)) {
        execInherit(`mkdir -p -m 777 "${projectDirectory}"`);
        fs.writeFileSync(systemVariablePath, '');
        fs.chmodSync(systemVariablePath, 0o744);
        // If running under sudo, restore ownership to the real user
        const sudoUser = process.env.SUDO_USER;
        if (sudoUser) {
          execInherit(`chown -R "${sudoUser}":"${sudoUser}" "${projectDirectory}"`);
        }
      }

      if (key === 'container') {
        setSystemVariable('.container.cli', value);
        console.log(`run=${value}`);

        if (value === 'docker') {
          setSystemVariable('.container.composeCli', 'docker compose');
        } else if (value === 'podman') {
          setSystemVariable('.container.composeCli', 'podman-compose');
        }
      }
    }
  }
}

function installContainer() {
  if (container === 'podman') {
    const podmanOk = execSilent('podman --version') && execSilent('podman-compose --version');
    if (podmanOk) {
      printPackageInstalled('podman');
      configurePodmanLogs();
    } else {
      if (packageManager === 'apt-get') {
        process.stdout.write('Installing Podman...');
        execInherit(`curl -L https://download.opensuse.org/repositories/devel:/kubic:/libcontainers:/stable/xUbuntu_$(lsb_release -rs)/Release.key | sudo apt-key add -`);
        execInherit(`echo "deb https://download.opensuse.org/repositories/devel:/kubic:/libcontainers:/stable/xUbuntu_$(lsb_release -rs)/ /" | sudo tee /etc/apt/sources.list.d/devel:kubic:libcontainers:stable.list`);
        execInherit('sudo apt-get update -y');
        execInherit('sudo apt-get install podman python3-pip -y');
        execInherit('pip3 install podman-compose');
        configurePodmanLogs();
      } else if (packageManager === 'dnf') {
        process.stdout.write('Installing Podman...');
        execInherit('sudo dnf install -y podman');
        execInherit('sudo dnf install -y python3 python3-pip');
        execInherit('pip3 install podman-compose');
        configurePodmanLogs();
      } else {
        printPackageRequired('podman');
      }
    }
  } else if (container === 'docker') {
    const dockerOk = execSilent('docker --version');
    if (dockerOk) {
      printPackageInstalled('docker');
      configureDockerLogs();
    } else {
      if (packageManager === 'apt-get') {
        installDockerManuallyApt();
        configureDockerLogs();
      } else if (packageManager === 'dnf') {
        printWarning('Todo:Install docker with dnf');
      } else {
        printPackageRequired('docker');
      }
    }
  }
}

async function installRequiredPackage() {
  detectPackageManager();

  if (packageManager === 'apt-get') {
    updatePackageWithApt();
    updatePackageWithDnf();
  }

  await askWhichContainerInstall();

  setInstallOptions();

  checkSudoPermission();

  if (functionResult === 0) {
    installContainer();
  } else {
    printPackageRequired(container);
  }

  setSystem();
}

function givePermissionAllScript() {
  try {
    const files = exec(`find "${exportPath}" -type f -name '*.sh' 2>/dev/null`);
    if (files) {
      for (const file of files.split('\n')) {
        if (file.trim()) execSync(`chmod uog+x "${file.trim()}"`);
      }
    }
  } catch {
    // no .sh files found
  }
}

function getContainerCli() {
  return yq('.container.cli', exportGlobalFilePath);
}

function getContainerComposeCli() {
  return yq('.container.composeCli', exportGlobalFilePath);
}

function credjsonNotFoundError() {
  printWarning('Missing cred JSON key file. In order to pull docker images for services, you need artifact registry credentials. Please follow self-hosted appcircle installation docs to get a valid credentials JSON file, which enables you to login our artifact registry.');
}

function containerLogin() {
  const defaultRegistry = yq('.image.registry.url', exportGlobalFilePath);
  const registryDomain = defaultRegistry.split('/')[0];

  const cli = getContainerCli();
  console.log(`cli=${cli}`);

  let configPath;
  if (cli === 'docker') {
    configPath = yq('.container.dockerConfigPath', exportGlobalFilePath);
    configPath = configPath.replace(/^'|'$/g, '');
  } else {
    configPath = yq('.container.podmanConfigPath', exportGlobalFilePath);
    configPath = configPath.replace(/^'|'$/g, '');
  }
  // Expand ~ and env vars
  if (configPath.startsWith('~')) {
    configPath = configPath.replace('~', os.homedir());
  }

  let auth = null;
  if (fileExists(configPath)) {
    try {
      auth = exec(`jq --arg registryDomain "${registryDomain}" '.auths[$registryDomain].auth' < "${configPath}"`);
    } catch {
      auth = null;
    }
  }

  if (auth === 'null' || !fileExists(configPath) || !auth) {
    if (defaultRegistry === 'europe-west1-docker.pkg.dev/appcircle/docker-registry') {
      console.log('Container login cred not found. Trying to login now');
      if (fileExists(dockerCredFile)) {
        if (useOauthTokenFlag) {
          // -t / --token: oauth2accesstoken yöntemi
          const accessToken = execFileSync('node', ['./gcloudAccessToken.js', dockerCredFile, 'https://www.googleapis.com/auth/devstorage.read_only'], { encoding: 'utf8' }).trim();
          execInherit(`echo "${accessToken}" | ${cli} login -u oauth2accesstoken --password-stdin "${registryDomain}"`);
        } else {
          // default: _json_key yöntemi
          execInherit(`cat "${dockerCredFile}" | ${cli} login -u _json_key --password-stdin "${registryDomain}"`);
        }
        return;
      } else {
        credjsonNotFoundError();
      }
    }

    const registryUsername = yq('.image.registry.username', exportGlobalFilePath);
    const registryPassword = yq('.image.registry.password', exportGlobalFilePath);

    if (registryPassword) {
      execInherit(`echo "${registryPassword}" | ${cli} login -u ${registryUsername} --password-stdin "${registryDomain}"`);
    } else {
      execInherit(`${cli} login -u ${registryUsername} "${defaultRegistry}"`);
    }
  }
}

function replacaSecretJson(templatePath, outputPath, sourceVariableFiles) {
  if (!fileExists(outputPath) || readFileTrim(outputPath) === '') {
    fs.writeFileSync(outputPath, '{}');
  }

  const lines = exec(`jq -r '[leaf_paths as $path | {"key": $path | join("|"), "value": getpath($path)}] | .[] | (.key +" "+ (.value|@base64))' "${templatePath}"`);
  if (!lines) return;

  for (const line of lines.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split(' ');
    const key = parts[0];
    const pattern = Buffer.from(parts[1], 'base64').toString('utf8');

    const existsTargetValue = execFileSync('jq', [
      '--arg', 'key', key,
      'if getpath($key|split("|")|map(tonumber? // .)) != null then true else false end',
      outputPath
    ], { encoding: 'utf8' }).trim();

    if (existsTargetValue !== 'true') {
      const value = execFileSync('gomplate', [
        '-i', pattern,
        '-c', `.=${sourceVariableFiles}`
      ], { encoding: 'utf8' }).trim();

      const result = execFileSync('jq', [
        '--arg', 'key', key,
        '--arg', 'value', value,
        'setpath($key|split("|")|map(tonumber? // .);$value)',
        outputPath
      ], { encoding: 'utf8' }).trim();
      fs.writeFileSync(outputPath, result);
    }
  }
}

function replacaSecretYaml(templatePath, outputPath, sourceVariableFiles) {
  const tempFileForTemplate = path.join(os.tmpdir(), `template-${Date.now()}.json`);
  const tempFileForOutput = path.join(os.tmpdir(), `output-${Date.now()}.json`);

  if (fileExists(outputPath) && readFileTrim(outputPath) !== '') {
    const content = exec(`yq -o=j --prettyPrint "${outputPath}"`);
    fs.writeFileSync(tempFileForOutput, content);
  } else {
    fs.writeFileSync(outputPath, '');
  }

  const tplContent = exec(`yq -o=j --prettyPrint "${templatePath}"`);
  fs.writeFileSync(tempFileForTemplate, tplContent);

  replacaSecretJson(tempFileForTemplate, tempFileForOutput, sourceVariableFiles);

  const yamlContent = exec(`yq -o=y --prettyPrint "${tempFileForOutput}"`);
  fs.writeFileSync(outputPath, yamlContent);

  fs.unlinkSync(tempFileForTemplate);
  fs.unlinkSync(tempFileForOutput);
}

function checkInitialUserName(filePath) {
  const initialUserName = yq('.keycloak.initialUsername', filePath);
  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (!regex.test(initialUserName)) {
    printWarning(`Initial username is not email format. keycloak.initialUsername value is .${initialUserName}.`);
    console.log('Operation terminated and exiting');
    process.exit(1);
  }
}

function initialVault() {
  const cli = yq('.container.cli', exportGlobalFilePath);
  const defaultRegistry = yq('.image.registry.url', exportGlobalFilePath);
  const SELinux = yq('.SELinux', exportGlobalFilePath);

  let vaultDataTargetPath = '/vault/data';
  if (SELinux === 'true') {
    vaultDataTargetPath += ':z';
  }

  execInherit(`${cli} volume create "${projectName}_vault_data" --label "com.docker.compose.project=${projectName}" --label "com.docker.compose.volume=vault_data" --label "io.podman.compose.project=${projectName}"`);
  runToolbox(`-v ${projectName}_vault_data:${vaultDataTargetPath}`);
  const containerName = 'toolbox';

  let volumeResult;
  try {
    execSync(`${cli} exec ${containerName} sh -c 'stat /vault/data/core'`, { stdio: 'pipe' });
    volumeResult = 0;
  } catch {
    volumeResult = 1;
  }

  setContainerTag();

  if (volumeResult !== 0) {
    console.log('vault initial');
    const content = exec(`yq eval 'del(.vault)' "${secretFilePath}"`);
    fs.writeFileSync(secretFilePath, content);

    const sealKeyPath = `${exportPath}/vault/seal.key`;
    if (!fileExists(sealKeyPath)) {
      fs.mkdirSync(path.dirname(sealKeyPath), { recursive: true });
      fs.writeFileSync(sealKeyPath, '');
    }

    const vaultConfigPath = fs.realpathSync(`${exportPath}/vault/config.hcl`);
    const vaultEntryPointPath = fs.realpathSync(`${exportPath}/vault/entrypoint.sh`);
    const vaultSealKeyPath = fs.realpathSync(`${exportPath}/vault/seal.key`);
    const vaultCommandPath = fs.realpathSync(`${exportPath}/vault/vault-init.sh`);

    let entrypointTargerPath = '/entrypoint.sh';
    let vaultInitTargetPath = '/vault-init.sh';
    let sealTargetPath = '/seal.key';
    let vaultConfigTargetPath = '/vault/config.hcl';

    if (SELinux === 'true') {
      entrypointTargerPath += ':z';
      vaultInitTargetPath += ':z';
      sealTargetPath += ':z';
      vaultConfigTargetPath += ':z';
    }

    execInherit(`${cli} run --rm -v "${projectName}_vault_data:${vaultDataTargetPath}" -v "${vaultConfigPath}:${vaultConfigTargetPath}" -v "${vaultEntryPointPath}:${entrypointTargerPath}" -v "${vaultCommandPath}:${vaultInitTargetPath}" -v "${vaultSealKeyPath}:${sealTargetPath}" --entrypoint "/entrypoint.sh" ${defaultRegistry}/appcircle-vault:${containerTag} "vault-init.sh"`);
  }

  removeToolbox(cli, 'toolbox');
}

function replaceTmplFile(templatePath, outputPath, sourceVariableFiles) {
  const content = execFileSync('gomplate', [
    '-c', `.=${sourceVariableFiles}`,
    '-f', templatePath
  ], { encoding: 'utf8' }).trim();
  fs.writeFileSync(outputPath, content);
}

function replaceExportDirectory(dir, sourceVariableFiles) {
  let files;
  try {
    files = exec(`find "${dir}" -type f -name '*.tmpl' 2>/dev/null`);
  } catch {
    return;
  }
  if (!files) return;

  for (const file of files.split('\n')) {
    if (!file.trim()) continue;
    const outFile = file.replace(/\.tmpl$/, '');
    replaceTmplFile(file, outFile, sourceVariableFiles);
    fs.unlinkSync(file);

    const ext = path.extname(outFile).slice(1);
    if (ext === 'yaml') {
      const existing = fs.readFileSync(outFile, 'utf8');
      fs.writeFileSync(outFile, `#ac-self-hosted.sh version ${version}\n${existing}`);
    }

    const content = readFileTrim(outFile).replace(/\s/g, '');
    if (!content) {
      fs.unlinkSync(outFile);
    } else {
      console.log(`${file} -> ${outFile}`);
    }
  }
}

function importToolbox() {
  const cli = yq('.container.cli', exportGlobalFilePath);
  execSync(`${cli} load -i ${toolboxImagePath}`, { stdio: 'pipe' });
}

function runToolbox(argument) {
  argument = argument || '';
  const cli = yq('.container.cli', exportGlobalFilePath);
  const containerNameLocal = 'toolbox';
  const containerImageUrl = 'europe-west1-docker.pkg.dev/appcircle/docker-registry';
  const containerImageName = 'toolbox';
  const containerImageVersion = '1.4.1';
  const containerImage = `${containerImageUrl}/${containerImageName}:${containerImageVersion}`;

  // check if image loaded
  try {
    execSync(`${cli} image inspect ${containerImage}`, { stdio: 'pipe' });
  } catch {
    importToolbox();
  }

  // check if container is already running
  try {
    execSync(`${cli} inspect -f '{{.State.Running}}' ${containerNameLocal}`, { stdio: 'pipe' });
  } catch {
    execSync(`${cli} run -d --name ${containerNameLocal} ${argument} ${containerImage} tail -f /dev/null`, { stdio: 'pipe' });
  }
}

function removeToolbox(cli, containerName) {
  cli = cli || getContainerCli();
  containerName = containerName || 'toolbox';
  try {
    execSync(`${cli} rm -f ${containerName}`, { stdio: 'pipe' });
  } catch {
    // ignore
  }
}

function generateKeys() {
  const cli = yq('.container.cli', exportGlobalFilePath);
  const containerName = 'toolbox';
  const containerPath = `/appcircle-server/${exportPath.slice(2)}`;
  const storeRSAPrivate = yq('.storeApi.jwtRsaPrivateKey // ""', secretFilePath);
  const storeRSAPublic = yq('.storeApi.jwtRsaPublicKey // ""', secretFilePath);

  if (!storeRSAPrivate || !storeRSAPublic) {
    console.log('Store initial');
    runToolbox();
    execInherit(`${cli} exec -e containerPath="${containerPath}" ${containerName} sh -c 'mkdir -p "\${containerPath}/store/" && openssl genrsa -traditional -out "\${containerPath}/store/rsa.private" 2048'`);
    execInherit(`${cli} exec -e containerPath="${containerPath}" ${containerName} sh -c 'openssl rsa -traditional -in "\${containerPath}/store/rsa.private" -out "\${containerPath}/store/rsa.public" -pubout -outform PEM'`);
    execInherit(`${cli} cp ${containerName}:"${containerPath}/store/rsa.private" "${exportPath}/store/rsa.private"`);
    execInherit(`${cli} cp ${containerName}:"${containerPath}/store/rsa.public" "${exportPath}/store/rsa.public"`);
  }

  const testerRSAPrivate = yq('.testerApi.jwtRsaPrivateKey // ""', secretFilePath);
  const testerRSAPublic = yq('.testerApi.jwtRsaPublicKey // ""', secretFilePath);

  if (!testerRSAPrivate || !testerRSAPublic) {
    console.log('Tester initial');
    runToolbox();
    execInherit(`${cli} exec -e containerPath="${containerPath}" ${containerName} sh -c 'mkdir -p "\${containerPath}/tester" && openssl genrsa -traditional -out "\${containerPath}/tester/rsa.private" 2048'`);
    execInherit(`${cli} exec -e containerPath="${containerPath}" ${containerName} sh -c 'openssl rsa -traditional -in "\${containerPath}/tester/rsa.private" -out "\${containerPath}/tester/rsa.public" -pubout -outform PEM'`);
    execInherit(`${cli} cp ${containerName}:"${containerPath}/tester/rsa.private" "${exportPath}/tester/rsa.private"`);
    execInherit(`${cli} cp ${containerName}:"${containerPath}/tester/rsa.public" "${exportPath}/tester/rsa.public"`);
  }

  const rijndaelKey = yq('.rijndael.key // ""', secretFilePath);
  const rijndaelIv = yq('.rijndael.iv // ""', secretFilePath);

  if (!rijndaelKey || !rijndaelIv) {
    console.log('Rijndael initial');
    runToolbox();
    execInherit(`${cli} exec -e containerPath="${containerPath}" ${containerName} sh -c 'openssl rand -out "\${containerPath}/rijndael_key" -base64 32'`);
    execInherit(`${cli} exec -e containerPath="${containerPath}" ${containerName} sh -c 'openssl rand -out "\${containerPath}/rijndael_iv" -base64 16'`);
    execInherit(`${cli} cp ${containerName}:"${containerPath}/rijndael_key" "${exportPath}/rijndael_key"`);
    execInherit(`${cli} cp ${containerName}:"${containerPath}/rijndael_iv" "${exportPath}/rijndael_iv"`);

    process.env.RijndaelKey = readFileTrim(`${exportPath}/rijndael_key`);
    process.env.RijndaelIv = readFileTrim(`${exportPath}/rijndael_iv`);
  }

  const dhparam = yq('.nginx.dhparam // ""', secretFilePath);

  if (!dhparam) {
    console.log('Dhparam initial');
    runToolbox();
    execInherit(`${cli} exec -e containerPath="${containerPath}" ${containerName} sh -c 'mkdir -p "\${containerPath}/nginx" && openssl dhparam -out "\${containerPath}/nginx/dhparam.pem" 1024'`);
    execInherit(`${cli} cp ${containerName}:"${containerPath}/nginx/dhparam.pem" "${exportPath}/nginx/dhparam.pem"`);
  }

  removeToolbox(cli, containerName);
}

function createSslCert() {
  const sslCert = yq('.nginx.sslCertificate', exportGlobalFilePath);
  if (sslCert && sslCert !== 'null' && sslCert !== '') {
    fs.writeFileSync(`${exportPath}/nginx/user-ssl.key`, yq('.nginx.sslCertificateKey', exportGlobalFilePath));
    fs.writeFileSync(`${exportPath}/nginx/user-ssl.crt`, sslCert);
  }

  const storeScheme = yq('.storeWeb.external.scheme', exportGlobalFilePath);
  const customStorePort = yq('.storeWeb.customDomain.port', exportGlobalFilePath);
  const distScheme = yq('.testerWeb.external.scheme', exportGlobalFilePath);
  const externalScheme = yq('.apiGateway.external.scheme', exportGlobalFilePath);

  if (externalScheme === 'https' || storeScheme === 'https' || distScheme === 'https' || customStorePort === '443') {
    fs.writeFileSync(`${exportPath}/nginx/dhparam.pem`, yq('.nginx.dhparam', exportGlobalFilePath));
  }

  if (yq('.storeWeb.customDomain.enabled', exportGlobalFilePath) === 'true' && yq('.storeWeb.customDomain.enabledTls', exportGlobalFilePath) === 'true') {
    fs.writeFileSync(`${exportPath}/nginx/custom-store-ssl.crt`, yq('.storeWeb.customDomain.publicKey', exportGlobalFilePath));
    fs.writeFileSync(`${exportPath}/nginx/custom-store-ssl.key`, yq('.storeWeb.customDomain.privateKey', exportGlobalFilePath));
  }

  if (yq('.testerWeb.customDomain.enabled', exportGlobalFilePath) === 'true' && yq('.testerWeb.customDomain.enabledTls', exportGlobalFilePath) === 'true') {
    fs.writeFileSync(`${exportPath}/nginx/custom-dist-ssl.crt`, yq('.testerWeb.customDomain.publicKey', exportGlobalFilePath));
    fs.writeFileSync(`${exportPath}/nginx/custom-dist-ssl.key`, yq('.testerWeb.customDomain.privateKey', exportGlobalFilePath));
  }

  if (yq('.keycloak.dmzCustomDomain.enabled', exportGlobalFilePath) === 'true' && yq('.keycloak.dmzCustomDomain.enabledTls', exportGlobalFilePath) === 'true') {
    const customCertificate = yq('.keycloak.dmzCustomDomain.publicKey', exportGlobalFilePath);
    if (!customCertificate || customCertificate === 'null') {
      fs.writeFileSync(`${exportPath}/nginx/custom-dmz-auth-ssl.crt`, yq('.nginx.sslCertificate', exportGlobalFilePath));
      fs.writeFileSync(`${exportPath}/nginx/custom-dmz-auth-ssl.key`, yq('.nginx.sslCertificateKey', exportGlobalFilePath));
    } else {
      fs.writeFileSync(`${exportPath}/nginx/custom-dmz-auth-ssl.crt`, yq('.keycloak.dmzCustomDomain.publicKey', exportGlobalFilePath));
      fs.writeFileSync(`${exportPath}/nginx/custom-dmz-auth-ssl.key`, yq('.keycloak.dmzCustomDomain.privateKey', exportGlobalFilePath));
    }
  }

  if (yq('.codepushProxy.enabled', exportGlobalFilePath) === 'true' && yq('.codepushProxy.external.scheme', exportGlobalFilePath) === 'https') {
    fs.writeFileSync(`${exportPath}/nginx/custom-codepushproxy-ssl.crt`, yq('.codepushProxy.external.publicKey', exportGlobalFilePath));
    fs.writeFileSync(`${exportPath}/nginx/custom-codepushproxy-ssl.key`, yq('.codepushProxy.external.privateKey', exportGlobalFilePath));
  }

  const ca = yq('.external.ca', exportGlobalFilePath);
  if (ca && ca !== 'null' && ca !== '') {
    let n = 1;

    try { execSync(`rm -rf "${exportPath}/ca"`, { stdio: 'pipe' }); } catch { /* ignore */ }
    fs.mkdirSync(`${exportPath}/ca`, { recursive: true });

    try { execSync(`rm -rf "${dmzExportPath}/ca"`, { stdio: 'pipe' }); } catch { /* ignore */ }
    fs.mkdirSync(`${dmzExportPath}/ca`, { recursive: true });

    for (const line of ca.split('\n')) {
      fs.appendFileSync(`${exportPath}/ca/ca${n}.crt`, line + '\n');
      fs.appendFileSync(`${dmzExportPath}/ca/ca${n}.crt`, line + '\n');
      if (line.includes('END CERTIFICATE')) {
        n++;
      }
    }
  }

  const externalScheme2 = yq('.apiGateway.external.scheme', exportGlobalFilePath);
  if (externalScheme2 === 'https') {
    let n = 1;

    try { execSync(`rm -rf "${exportPath}/tester/ca"`, { stdio: 'pipe' }); } catch { /* ignore */ }
    fs.mkdirSync(`${exportPath}/tester/ca`, { recursive: true });
    const sslCertificate = yq('.nginx.sslCertificate', exportGlobalFilePath);

    for (const line of sslCertificate.split('\n')) {
      fs.appendFileSync(`${exportPath}/tester/ca/ca${n}.crt`, line + '\n');
      if (line.includes('END CERTIFICATE')) {
        n++;
      }
    }
  }
}

function setContainerTag() {
  const environment = yq('.environment', exportGlobalFilePath);
  if (environment === 'Development') {
    containerTag = 'alpha-latest';
  } else if (environment === 'Preproduction') {
    containerTag = 'beta-latest';
  }
}

function trustSslCertificates() {
  const cli = getContainerCli();
  const volumeName = `${projectName}_ssl_certs`;
  const containerName = 'toolbox';

  let volumeSuffix = '';
  const selinux = yq('.SELinux', exportGlobalFilePath);
  if (selinux === 'true') {
    volumeSuffix = ':Z';
  }

  try {
    execSync(`${cli} volume inspect "${volumeName}"`, { stdio: 'pipe' });
    console.log('SSL certs volume found.');
  } catch {
    console.log('SSL certs volume being created.');
    execInherit(`${cli} volume create "${volumeName}"`);
  }

  try {
    removeToolbox(cli, containerName);
  } catch {
    // ignore
  }

  const cwd = process.cwd();
  runToolbox(`-v ${cwd}${exportPath.slice(1)}/ca:/usr/local/share/ca-certificates${volumeSuffix} -v ${volumeName}:/etc/ssl/containerCerts${volumeSuffix}`);
  execInherit(`${cli} exec "${containerName}" sh -c 'sh -c "update-ca-certificates && cp -r /etc/ssl/certs/* /etc/ssl/containerCerts"'`);
  removeToolbox(cli, containerName);
}

function runInitServices() {
  const externalCa = yq('.external.ca', exportGlobalFilePath);
  if (externalCa && externalCa !== 'null' && externalCa !== '') {
    trustSslCertificates();
  }
}

function minioMigrate(cv, st, sv, tt, tv) {
  console.log(`Start minio operation for ${projectName}`);
  console.log(`param1=${cv} param2=${st} param3=${sv} param4=${tt} param5=${tv}`);

  const containerCli = getContainerCli();
  const composeCli = getContainerComposeCli();

  console.log('Checking MinIO volumes...');
  const volumeList = exec(`${containerCli} volume ls`);
  if (!volumeList.toLowerCase().includes(`${projectName}_minio_data1`)) {
    console.log('MNSD MinIO volumes do not exist. There is no need to migrate.');
    process.exit(1);
  }

  const minioType = yq('.minio.type', exportGlobalFilePath);
  const volumeName = `minio_${minioType}_data`;

  if (!volumeList.includes(`${projectName}_${volumeName}`)) {
    console.log('Volume not found. Creating volume...');

    if (containerCli === 'podman') {
      console.log('podman CLI');
      const composeVersion = exec(`${composeCli} version --short`).split(' ').pop();
      execInherit(`${containerCli} volume create "${projectName}_${volumeName}" --label="io.podman.compose.project=${projectName}" --label="io.podman.compose.version=${composeVersion}" --label="io.podman.compose.volume=${volumeName}"`);
    } else if (containerCli === 'docker') {
      console.log('docker CLI');
      const composeVersion = exec(`${composeCli} version --short`).split(' ').pop();
      execInherit(`${containerCli} volume create --name "${projectName}_${volumeName}" --label="com.docker.compose.project=${projectName}" --label="com.docker.compose.version=${composeVersion}" --label="com.docker.compose.volume=${volumeName}"`);
    }
  } else {
    console.log('Volume found.');
  }

  const bucketList = yq('.minio.bucketList', exportGlobalFilePath);
  const bucketPrefix = yq('.minio.bucketPrefix', exportGlobalFilePath);
  const sourcePort = 9732;
  const sourceServerDataDir = '/source/data';
  const sourceAccessKey = yq('.minio.accessKey', exportGlobalFilePath);
  const sourceSecretKey = yq('.minio.secretKey', exportGlobalFilePath);

  const targetPort = 9733;
  const targetAccessKey = yq('.minio.accessKey', exportGlobalFilePath);
  const targetSecretKey = yq('.minio.secretKey', exportGlobalFilePath);
  const targetServerDataDir = '/target/data';

  let volumeParameter = '';
  if (st === 'mnsd') {
    for (let count = 1; count <= 4; count++) {
      volumeParameter += ` -v ${projectName}_minio_data${count}:${sourceServerDataDir}${count}`;
    }
  }

  if (tt === 'snsd') {
    volumeParameter += ` -v ${projectName}_minio_snsd_data:${targetServerDataDir}`;
  }

  const registryName = yq('.image.registry.url', exportGlobalFilePath);
  const imageName = 'minio-migration';
  const imageTag = yq('.image.tag', exportGlobalFilePath);
  const migrationImageName = `${registryName}/${imageName}:${imageTag}`;

  const migrationCommand = `${containerCli} run -it --rm ` +
    `-e "MINIO_BUCKET_LIST=${bucketList}" ` +
    `-e "BUCKET_PREFIX=${bucketPrefix}" ` +
    `-e "CLIENT_VERSION=${cv}" ` +
    `-e "SOURCE_PORT=${sourcePort}" ` +
    `-e "SOURCE_TYPE=${st}" ` +
    `-e "SOURCE_SERVER_VERSION=${sv}" ` +
    `-e "SOURCE_SERVER_DATA_DIR=${sourceServerDataDir}" ` +
    `-e "SOURCE_ACCESS_KEY=${sourceAccessKey}" ` +
    `-e "SOURCE_SECRET_KEY=${sourceSecretKey}" ` +
    `-e "TARGET_PORT=${targetPort}" ` +
    `-e "TARGET_ACCESS_KEY=${targetAccessKey}" ` +
    `-e "TARGET_SECRET_KEY=${targetSecretKey}" ` +
    `-e "TARGET_TYPE=${tt}" ` +
    `-e "TARGET_SERVER_VERSION=${tv}" ` +
    `-e "TARGET_SERVER_DATA_DIR=${targetServerDataDir}" ` +
    `${volumeParameter} ` +
    `${migrationImageName}`;

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+/, '');
  const minioMigrationLogFileName = `minio-migration-${timestamp}.log`;
  console.log(`Migration logs are being saved into the ${minioMigrationLogFileName} file.`);

  try {
    const output = execSync(`bash -c '${migrationCommand}'`, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
    fs.writeFileSync(minioMigrationLogFileName, output);
    console.log(output);
  } catch (e) {
    const output = (e.stdout || '') + (e.stderr || '');
    fs.writeFileSync(minioMigrationLogFileName, output);
    console.log(output);
  }

  // Sanitize credentials from log
  const minioUsername = yq('.minio.accessKey', exportGlobalFilePath);
  const minioPassword = yq('.minio.secretKey', exportGlobalFilePath);
  let logContent = fs.readFileSync(minioMigrationLogFileName, 'utf8');
  logContent = logContent.split(minioUsername).join('****');
  logContent = logContent.split(minioPassword).join('****');
  fs.writeFileSync(minioMigrationLogFileName, logContent);

  if (/error/i.test(logContent)) {
    console.log('The migration command failed.');
    console.log(`Please check the ${minioMigrationLogFileName} file for more detailed logs.`);
    process.exit(1);
  } else {
    console.log('The migration command was completed successfully.');
  }
}

async function checkMinioMigration() {
  const containerCli = getContainerCli();
  const volumeName = 'minio_snsd_data';
  const minioType = yq('.minio.type', exportGlobalFilePath);

  if (minioType === 'snsd') {
    const volumeList = exec(`${containerCli} volume ls`);
    if (!volumeList.includes(`${projectName}_${volumeName}`)) {
      console.log("SNSD MinIO volume doesn't exist.");
      if (volumeList.includes(`${projectName}_minio_data`)) {
        console.log('MNSD MinIO volumes exist.');
        console.log("It looks like you haven't migrated from MNSD MinIO to SNSD MinIO and are trying to start the Appcircle server with the Minio SNSD configuration.");
        console.log("If you proceed, you can't access some data like build logs, built applications, app icons, etc.");
        console.log('Please check our MinIO migration document for migrating from MNSD MinIO to SNSD MinIO.');
        console.log('https://docs.appcircle.io/self-hosted-appcircle/configure-server/minio-migration');
        const response = await askQuestion('Do you want to proceed? (y/N): ');
        if (/^(yes|y)$/i.test(response)) {
          return;
        } else {
          process.exit(1);
        }
      }
    }
  }
}

async function warnAboutJournaldRequirement(loggingDriver) {
  if (loggingDriver !== 'journald') {
    const containerCli = getContainerCli();
    console.log(`${containerCli} logging driver is not 'journald'.`);
    console.log(`Current logging driver is: ${loggingDriver}`);
    console.log("It looks like you haven't run './ac-self-hosted.sh -i' command while updating the Appcircle server.");
    console.log("If you proceed, you can't see Appcircle server logs from the monitoring UI.");
    const response = await askQuestion('Do you want to proceed? (y/N): ');
    if (/^(yes|y)$/i.test(response)) {
      return;
    } else {
      process.exit(1);
    }
  }
}

async function checkDockerLoggingDriver() {
  let loggingDriver = exec('jq \'.[\"log-driver\"]\' /etc/docker/daemon.json');
  // Remove surrounding quotes
  loggingDriver = loggingDriver.replace(/^"|"$/g, '');
  await warnAboutJournaldRequirement(loggingDriver);
}

async function checkPodmanLoggingDriver() {
  const loggingDriver = exec("grep -i -E '^log_driver' /etc/containers/containers.conf | cut -d '\"' -f2");
  await warnAboutJournaldRequirement(loggingDriver);
}

async function checkLoggingDriver() {
  const containerCli = getContainerCli();
  if (containerCli === 'docker') {
    await checkDockerLoggingDriver();
  } else {
    await checkPodmanLoggingDriver();
  }
}

function initializeProject() {
  const requiredRegistryLogin = yq('.image.registry.requiredLogin', exportGlobalFilePath);

  if (requiredRegistryLogin === 'true') {
    containerLogin();
  }

  if (fileExists(vaultInitIndicatorPath)) {
    console.log(`The project ${projectName} is already initialized.`);
    process.exit(1);
  }

  console.log(`Initializing the project ${projectName}.`);

  const init = yq('.vault.token', secretFilePath);
  if (!init || init === 'null') {
    initialVault();
    createExport();
  }

  fs.appendFileSync(vaultInitIndicatorPath, `${new Date().toString()} Initializing the vault.\n`);
  console.log('Vault initialized successfully.');
}

function checkVaultInitializedIndicator() {
  if (!fileExists(vaultInitIndicatorPath)) {
    console.log(`The project ${projectName} is not initialized.`);
    console.log(`Please run './ac-self-hosted.sh -n "${projectName}" init' to initialize the project.`);
    process.exit(1);
  }
}

function checkCodepushPostgresqlDatabaseExists() {
  const containerCli = getContainerCli();
  let postgresqlContainerName;
  if (containerCli === 'podman') {
    postgresqlContainerName = `${projectName}_postgres_1`;
  } else {
    postgresqlContainerName = `${projectName}-postgres-1`;
  }
  const postgresqlUsername = yq('.postgres.user', exportGlobalFilePath);
  const codePushDatabaseName = yq('.postgres.codepush.database', exportGlobalFilePath);

  if (fileExists(codepushDatabaseCreatedIndicatorPath)) {
    console.log('CodePush PostgreSQL database and user already created.');
    return;
  }

  const composeFilePath = `${exportPath}/compose.yaml`;
  const composeCli = getContainerComposeCli();
  execInherit(`${composeCli} -f "${composeFilePath}" up postgres -d`);

  // Wait until the postgres container is healthy
  const maxRetries = 30;
  let retries = 0;
  while (true) {
    let healthStatus;
    try {
      healthStatus = exec(`${containerCli} inspect --format '{{.State.Health.Status}}' "${postgresqlContainerName}"`);
    } catch {
      healthStatus = '';
    }
    if (healthStatus === 'healthy') break;
    if (healthStatus === 'unhealthy') {
      console.log('PostgreSQL container is unhealthy.');
      process.exit(1);
    }
    if (retries >= maxRetries) {
      console.log('Timed out waiting for PostgreSQL container to become healthy.');
      process.exit(1);
    }
    console.log(`Waiting for PostgreSQL container to become healthy... (status: ${healthStatus})`);
    spawnSync('sleep', ['2']);
    retries++;
  }

  const dbCheck = execSilent(`${containerCli} exec "${postgresqlContainerName}" psql -U "${postgresqlUsername}" -tc "SELECT 1 FROM pg_database WHERE datname = '${codePushDatabaseName}';"`);
  if (!dbCheck.trim()) {
    console.log("CodePush PostgreSQL database doesn't exist.");
    createCodepushPostgresqlDatabaseAndUser();
  }
}

function createCodepushPostgresqlDatabaseAndUser() {
  const containerCli = getContainerCli();
  let postgresqlContainerName;
  if (containerCli === 'podman') {
    postgresqlContainerName = `${projectName}_postgres_1`;
  } else {
    postgresqlContainerName = `${projectName}-postgres-1`;
  }
  const postgresqlUsername = yq('.postgres.user', exportGlobalFilePath);
  const codePushDatabaseName = yq('.postgres.codepush.database', exportGlobalFilePath);
  const codePushUsername = yq('.postgres.codepush.username', exportGlobalFilePath);
  const codePushPassword = yq('.postgres.codepush.password', exportGlobalFilePath);

  console.log('Creating CodePush PostgreSQL database and user.');
  execSync(`${containerCli} exec "${postgresqlContainerName}" psql -U "${postgresqlUsername}" -c "CREATE DATABASE ${codePushDatabaseName};"`, { stdio: 'pipe' });
  execSync(`${containerCli} exec "${postgresqlContainerName}" psql -U "${postgresqlUsername}" -c "CREATE USER ${codePushUsername} WITH PASSWORD '${codePushPassword}';"`, { stdio: 'pipe' });
  execSync(`${containerCli} exec "${postgresqlContainerName}" psql -U "${postgresqlUsername}" -c "GRANT ALL PRIVILEGES ON DATABASE ${codePushDatabaseName} TO ${codePushUsername};"`, { stdio: 'pipe' });
  fs.appendFileSync(codepushDatabaseCreatedIndicatorPath, `${new Date().toString()} CodePush PostgreSQL database and user created.\n`);
}

async function up() {
  // Check if the indicator file doesn't exist but container volume exists.
  const vaultDataVolumeName = `${projectName}_vault_data`;
  const containerCli = getContainerCli();

  let vaultVolumeExists = false;
  try {
    execSync(`${containerCli} volume inspect "${vaultDataVolumeName}"`, { stdio: 'pipe' });
    vaultVolumeExists = true;
  } catch {
    vaultVolumeExists = false;
  }

  if (vaultVolumeExists && !fileExists(vaultInitIndicatorPath)) {
    console.log('Vault volume exists but there is no indicator. Creating the indicator file.');
    fs.appendFileSync(vaultInitIndicatorPath, `${new Date().toString()} The vault volume already exists. Creating the indicator file.\n`);
  }

  checkVaultInitializedIndicator();
  await checkMinioMigration();
  await checkLoggingDriver();
  checkCodepushPostgresqlDatabaseExists();

  if (!fs.existsSync(exportPath)) {
    createCleanExport();
  }

  runInitServices();

  const requiredRegistryLogin = yq('.image.registry.requiredLogin', exportGlobalFilePath);
  if (requiredRegistryLogin === 'true') {
    containerLogin();
  }

  const composeCli = getContainerComposeCli();
  if (composeCli === 'podman-compose') {
    execInherit(`${exportPath}/podman-up.sh "${projectName}" "${exportPath}/compose.yaml" "${exportPath}/podman-variable.sh"`);
  } else {
    execInherit(`${composeCli} -f ${exportPath}/compose.yaml up -d`);
  }

  runPostUpJobs();
}

function runPostUpJobs() {
  const containerCli = getContainerCli();
  if (containerCli === 'docker') {
    const kafkaContainerName = `${projectName}-kafka-1`;
    const kafkaNumPartition = yq('.kafka.numPartitions', exportGlobalFilePath);
    alterAllKafkaTopics(kafkaContainerName, kafkaNumPartition);
  }

  const isMonitoringEnabled = yq('.monitoring.enabled', exportGlobalFilePath);
  if (isMonitoringEnabled === 'true') {
    startPromtailService();
  }
}

function startPromtailService() {
  console.log('Starting the Appcircle logging service.');
  if (process.getuid && process.getuid() === 0) {
    setupPromtailService(rootSystemdServicePath, rootLogServiceFullPath);
    const isSelinuxEnabled = yq('.SELinux', systemVariablePath);
    if (isSelinuxEnabled === 'true') {
      setSelinuxPolicies();
    }
  } else {
    setupPromtailService(userSystemdServicePath, userLogServiceFullPath);
    const currentUser = process.env.USER || process.env.LOGNAME || require('os').userInfo().username;
    const lingerFile = `/var/lib/systemd/linger/${currentUser}`;
    if (!fs.existsSync(lingerFile)) {
      // Try without sudo first, fall back to sudo if access denied (e.g. RedHat 9.7)
      try {
        execInherit('loginctl enable-linger');
      } catch {
        execInherit(`sudo loginctl enable-linger "${currentUser}"`);
      }
    }
  }
  execInherit(`systemctl ${getSystemdUserFlag()} enable --now "${logServiceName}"`);
  console.log('Appcircle logging service started succesfully.');
}

function setupPromtailService(servicePath, serviceFullPath) {
  console.log('Setting up the Appcircle log service.');
  fs.mkdirSync(servicePath, { recursive: true });

  const serviceContent = `[Unit]
Description=Promtail service
After=network.target

[Service]
Type=simple
ExecStart=${promtailBinaryPath} -config.file ${promtailJournaldConfigFilePath}
TimeoutStopSec=30

[Install]
WantedBy=default.target
`;
  fs.writeFileSync(serviceFullPath, serviceContent);
  execInherit(`systemctl ${getSystemdUserFlag()} daemon-reload`);
}

function setSelinuxPolicies() {
  console.log('Setting up policies for SELinux...');
  const cwd = process.cwd();
  execSilent(`semanage fcontext -a -t bin_t "${cwd}/deps/bin.*"`);
  execSilent(`chcon -Rv -u system_u -t bin_t "${cwd}/deps/bin"`);
  execSilent(`restorecon -R -v "${cwd}/deps/bin"`);
}

function upgrade() {
  if (!fs.existsSync(exportPath)) {
    createCleanExport();
  }

  const requiredRegistryLogin = yq('.image.registry.requiredLogin', exportGlobalFilePath);
  console.log(`requiredRegistryLogin=${requiredRegistryLogin}`);
  if (requiredRegistryLogin === 'true') {
    containerLogin();
  }

  const composeCli = getContainerComposeCli();
  execInherit(`${composeCli} -f ${exportPath}/compose.yaml pull`);
}

function downloadOfflineCustomServices() {
  const gcloudAccessToken = exec(`node "${__dirname}/gcloudAccessToken.js" "${dockerCredFile}" "https://www.googleapis.com/auth/devstorage.read_only"`);
  const bucket = 'appcircle-self-hosted';
  const objectDir = `server-images%2Fv${version}%2F`;

  let imageClass = '';
  const imagesContent = fs.readFileSync('docker-images.txt', 'utf8');
  for (const image of imagesContent.split('\n')) {
    if (!image.trim()) continue;

    if (image === '# Common Images') {
      imageClass = 'common';
      continue;
    } else if (image === '# Custom Images') {
      imageClass = 'custom';
      continue;
    }
    if (imageClass === 'common') continue;

    console.log(`Downloading custom image tar ball: ${image}`);
    const imageName = path.basename(image);
    const customImageFilePath = `${offlineImagesDir}/${imageName}.tar.gz`;

    execInherit(`curl -X GET -C - -H "Authorization: Bearer ${gcloudAccessToken}" -o "${customImageFilePath}" "https://storage.googleapis.com/storage/v1/b/${bucket}/o/${objectDir}${imageName}.tar.gz?alt=media"`);
  }
}

function downloadOfflineServicesPackage() {
  console.log('\nDownloading images zip file...\n');
  const gcloudKeyFile = dockerCredFile;

  if (!fileExists(gcloudKeyFile)) {
    credjsonNotFoundError();
    process.exit(1);
  }

  const gcloudAccessToken = exec(`node "${__dirname}/gcloudAccessToken.js" "${dockerCredFile}" "https://www.googleapis.com/auth/devstorage.read_only"`);
  const bucket = 'appcircle-self-hosted';
  const object = `server-images%2Fv${version}%2Fappcircle-server-services-v${version}-offline.zip`;

  fs.mkdirSync(offlineImagesDir, { recursive: true });
  if (!fileExists(offlineImagesPath)) {
    execInherit(`curl -X GET -C - -H "Authorization: Bearer ${gcloudAccessToken}" -o "${offlineImagesPath}" "https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?alt=media"`);
  }
}

function unzipOfflineImages() {
  console.log('\nExtracting container images\n');
  execInherit(`unzip -n "${offlineImagesPath}" -d "${offlineImagesDir}"`);
}

function loadOfflineImages() {
  console.log('\nLoading all images to container engine\n');
  const cli = getContainerCli();
  const files = fs.readdirSync(offlineImagesDir).filter(f => f.endsWith('.tar.gz'));
  for (const imageFile of files) {
    execInherit(`${cli} load < "${offlineImagesDir}/${imageFile}"`);
  }

  const targetRegistry = yq('.image.registry.url', `${projectFilePath}/global.yaml`);
  if (targetRegistry && targetRegistry !== 'null') {
    console.log(`Target is not null registry: ${targetRegistry}`);
    retagOfflineImages(targetRegistry);
  }
}

function retagOfflineImages(targetRegistry) {
  console.log('\nRetagging images as your custom registry\n');
  const cli = getContainerCli();

  console.log(`Target registry: ${targetRegistry}`);

  const imagesContent = fs.readFileSync('docker-images.txt', 'utf8');
  for (const IMAGE of imagesContent.split('\n')) {
    if (!IMAGE.trim() || IMAGE.startsWith('#')) continue;
    console.log(`Retagging image: ${IMAGE}`);
    const NEW_IMAGE_NAME = IMAGE.replace(/europe-west1-docker\.pkg\.dev\/appcircle\/docker-registry/g, targetRegistry);
    console.log(`New image name: ${NEW_IMAGE_NAME}`);
    execInherit(`${cli} tag "${IMAGE}" "${NEW_IMAGE_NAME}"`);
    execInherit(`${cli} image rm "${IMAGE}"`);
  }
}

function cleanupOfflineImages() {
  console.log('\nCleaning offline images\n');
  execInherit(`rm -rf ${offlineImagesDir}`);
}

function downloadOfflineImages() {
  if (fileExists(offlineImagesPath)) {
    console.log('Offline container images zip file already exists.');
    console.log('Skipping downloading the offline container images zip file...');
    return;
  }
  downloadOfflineServicesPackage();
  downloadOfflineCustomServices();
}

function load() {
  downloadOfflineImages();
  unzipOfflineImages();
  console.log('');
  console.log('Loading images automatically...');
  loadOfflineImages();
  cleanupOfflineImages();

  printPackageInstalled('Container Images Loaded Successfully!');
}

function download() {
  console.log('Downloading Appcircle server offline images');
  downloadOfflineImages();

  console.log("\nYou can find the downloaded Appcircle server services zip file in the ./container-images directory.");
  console.log("You should copy the './container-images' directory to the 'appcircle-server' directory on the actual Appcircle server.");
}

function down() {
  if (!fs.existsSync(exportPath)) {
    createCleanExport();
  }

  runPreDownJobs();
  const composeCli = getContainerComposeCli();
  execInherit(`${composeCli} -f ${exportPath}/compose.yaml down`);
}

function runPreDownJobs() {
  stopPromtailService();
}

function stopPromtailService() {
  let logServiceStatus = '';
  try {
    logServiceStatus = exec(`systemctl ${getSystemdUserFlag()} is-active ${logServiceName}`);
  } catch {
    logServiceStatus = '';
  }
  if (logServiceStatus === 'active') {
    console.log('Appcircle logging service is running. Stopping now...');
    execInherit(`systemctl ${getSystemdUserFlag()} disable --now "${logServiceName}"`);
    console.log('Appcircle logging service stopped successfully.');
  } else {
    console.log('Appcircle logging service is not running.');
  }
}

function checkAppcircleLoggingService() {
  try {
    execSync(`systemctl ${getSystemdUserFlag()} is-active "${logServiceName}"`, { stdio: 'pipe' });
    process.stdout.write('\x1b[32m Appcircle logging service is running.\n\x1b[0m');
  } catch {
    process.stdout.write('\x1b[93m Appcircle logging service is not running. \n \x1b[0m');
  }
}

function check() {
  checkAppcircleLoggingService();

  const cli = getContainerCli();
  const composeCli = getContainerComposeCli();

  let hasError, runningNginxService, runningAnyService;

  if (cli === 'podman') {
    hasError = execSilent(`${cli} ps -a --format json | jq --arg projectName ${projectName} '.[] | select( .Labels["io.podman.compose.project"] == $projectName and ( ( .Status | test("unhealthy")) or (.State=="exited" and .ExitCode != 0))) | .Names[0] + " "+ .Status + (if .State == "exited" then "exited "+(.ExitCode|tostring) else " "+.State end)'`);
    runningNginxService = execSilent(`${cli} ps --format json | jq --arg projectName ${projectName} '.[] | select( .Labels["io.podman.compose.project"] == $projectName and ( .Status | test("(healthy)")) and (.Names[0] | test("nginx")) ) | .Names[0]'`);
    runningAnyService = execSilent(`${cli} ps --format json | jq --arg projectName ${projectName} '.[] | select( .Labels["io.podman.compose.project"] == $projectName and .State=="running") | .Names[0]'`);
  } else if (cli === 'docker') {
    let ifComposeOutputArray = '';
    try {
      execSync(`${composeCli} -f "${exportPath}/compose.yaml" ps -a --format json | jq -e 'type == "array"'`, { stdio: 'pipe' });
      ifComposeOutputArray = '.[] |';
    } catch {
      ifComposeOutputArray = '';
    }
    hasError = execSilent(`${composeCli} -f "${exportPath}/compose.yaml" ps -a --format json | jq -r '${ifComposeOutputArray} select( .Health == "unhealthy" or .Health == "starting" or (.State=="exited" and .ExitCode != 0)) | .Name + " "+ .Health+ (if .State == "exited" then "exited "+(.ExitCode|tostring) else " "+.State end)'`);
    runningNginxService = execSilent(`${composeCli} -f "${exportPath}/compose.yaml" ps --format json | jq '${ifComposeOutputArray} select( .Health=="healthy" and (.Name | test("nginx")) ) | .Name'`);
    runningAnyService = execSilent(`${composeCli} -f "${exportPath}/compose.yaml" ps --format json | jq '${ifComposeOutputArray} select( .State=="running") | .Name'`);
  }

  if (hasError) {
    console.log(hasError);
    process.stdout.write(`\x1b[93m WARNING: The above services are in error state. Project name is ${projectName} \n \x1b[0m`);
    process.exit(1);
  } else if (!runningAnyService) {
    process.stdout.write(`\x1b[93m WARNING:Services are not started. Project name is ${projectName} \n \x1b[0m`);
    process.exit(1);
  } else if (!runningNginxService) {
    process.stdout.write(`\x1b[93m WARNING:Some services are not running. Wait until the status of the services are finalized. Project name is ${projectName} \n \x1b[0m`);
    process.exit(1);
  } else {
    process.stdout.write(`\x1b[32m All services are running successfully. Project name is ${projectName} \n \x1b[0m`);
    process.exit(0);
  }
}

function alterAllKafkaTopics(kafkaContainerName, numPartitions) {
  console.log(`Fetching topic list from container '${kafkaContainerName}'...`);

  let topics;
  try {
    topics = exec(`docker exec "${kafkaContainerName}" kafka-topics --bootstrap-server localhost:9092 --list | grep -v '^_' | grep -v '^DeepCheck'`);
  } catch {
    topics = '';
  }

  if (!topics) {
    console.log('No topics found to alter.');
    return;
  }

  console.log(`Altering topics to have ${numPartitions} partitions...`);

  for (const topicName of topics.split('\n')) {
    if (!topicName.trim()) continue;

    let currentPartitions;
    try {
      currentPartitions = exec(`docker exec "${kafkaContainerName}" kafka-topics --bootstrap-server localhost:9092 --describe --topic "${topicName}" | grep -oP 'PartitionCount:\\s*\\K\\d+'`);
    } catch {
      console.log(`Could not retrieve partition count for topic '${topicName}'`);
      continue;
    }

    if (!currentPartitions) {
      console.log(`Could not retrieve partition count for topic '${topicName}'`);
      continue;
    }

    if (parseInt(currentPartitions, 10) >= parseInt(numPartitions, 10)) {
      console.log(`Skipping '${topicName}' since it already has ${currentPartitions} partitions`);
    } else {
      console.log(`Altering '${topicName}' from ${currentPartitions} to ${numPartitions} partitions...`);
      execInherit(`docker exec "${kafkaContainerName}" kafka-topics --bootstrap-server localhost:9092 --alter --topic "${topicName}" --partitions "${numPartitions}"`);
    }
  }
}

async function reset() {
  printWarning("The entire data will delete irreversibly. Please enter '[Yy]es' or '[Nn]o'");

  while (true) {
    const answer = await askQuestion('');
    if (/^[Yy]/i.test(answer)) break;
    if (/^[Nn]/i.test(answer)) process.exit(0);
  }

  down();

  execInherit(`yq eval -i 'del(.vault.token)' "${secretFilePath}"`);

  const composeCli = getContainerComposeCli();
  execInherit(`${composeCli} -f "${exportPath}/compose.yaml" down -v`);

  fs.unlinkSync(vaultInitIndicatorPath);
  fs.unlinkSync(codepushDatabaseCreatedIndicatorPath);
}

function versionCommand() {
  const cli = getContainerCli();
  const composeCli = getContainerComposeCli();
  const composeFile = `${exportPath}/compose.yaml`;

  const header = 'CONTAINER'.padEnd(40) + 'IMAGE_ID'.padEnd(20) + 'IMAGE_DIGEST'.padEnd(20);
  console.log(header);

  if (cli === 'docker') {
    const services = exec(`${composeCli} -f ${composeFile} ps -qa`);
    if (services) {
      for (const service of services.split('\n')) {
        if (!service.trim()) continue;
        const containerName = exec(`${cli} inspect --format '{{.Name}}' ${service}`).replace(/^\//, '');
        let imageId = exec(`${cli} inspect --format='{{.Image}}' ${containerName}`).split(':').pop();
        imageId = imageId.substring(0, 10);
        let imageDigest = '';
        try {
          const repoDigests = exec(`${cli} inspect --format='{{.RepoDigests}}' ${imageId}`);
          const match = repoDigests.match(/@sha256:([a-f0-9]+)/);
          if (match) imageDigest = match[1].substring(0, 10);
        } catch {
          imageDigest = '';
        }
        console.log(containerName.padEnd(40) + imageId.padEnd(20) + imageDigest.padEnd(20));
      }
    }
  } else if (cli === 'podman') {
    const services = exec(`podman ps -a --format {{.ID}} --filter label=io.podman.compose.project=${projectName}`);
    if (services) {
      for (const service of services.split('\n')) {
        if (!service.trim()) continue;
        const containerName = exec(`${cli} inspect --format='{{.Name}}' ${service}`);
        const imageId = exec(`${cli} inspect --format='{{.Image}}' ${containerName}`).substring(0, 12);
        let imageDigest = '';
        try {
          const digest = exec(`${cli} inspect --format='{{index .RepoDigests 0}}' ${imageId}`);
          const parts = digest.split('@');
          if (parts[1]) imageDigest = parts[1].split(':').pop().substring(0, 12);
        } catch {
          imageDigest = '';
        }
        console.log(containerName.padEnd(40) + imageId.padEnd(20) + imageDigest.padEnd(20));
      }
    }
  } else {
    console.log('Unsupported container cli');
    process.exit(1);
  }
  console.log(`\nScript version ${version}`);
}

function copyDmzConfigurationFiles() {
  // Nginx Configuration Files
  const copyIfExists = (src, dest) => {
    if (fileExists(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  };

  fs.mkdirSync(`${dmzExportPath}/nginx`, { recursive: true });
  fs.copyFileSync(`${exportPath}/nginx/ssl.conf`, `${dmzExportPath}/nginx/ssl.conf`);
  fs.copyFileSync(`${exportPath}/nginx/ssl-params.conf`, `${dmzExportPath}/nginx/ssl-params.conf`);
  fs.copyFileSync(`${exportPath}/nginx/ssl-http-only-params.conf`, `${dmzExportPath}/nginx/ssl-http-only-params.conf`);
  fs.copyFileSync(`${exportPath}/nginx/nginx-proxy.conf`, `${dmzExportPath}/nginx/nginx-proxy.conf`);

  const keycloakDmzCustomDomainEnabled = yq('.keycloak.dmzCustomDomain.enabled', exportGlobalFilePath);
  if (keycloakDmzCustomDomainEnabled === 'true') {
    const keycloakExternalURL = yq('.keycloak.external.url', exportGlobalFilePath);
    const keycloakDmzCustomDomain = yq('.keycloak.dmzCustomDomain.domain', exportGlobalFilePath);

    // Remove proxy_redirect off; line
    let proxyConf = fs.readFileSync(`${dmzExportPath}/nginx/nginx-proxy.conf`, 'utf8');
    proxyConf = proxyConf.replace(/proxy_redirect\s+off;\n?/g, '');
    proxyConf += `
# Handle redirects in response headers
proxy_redirect ${keycloakExternalURL}/ https://${keycloakDmzCustomDomain}/;

# Enable sub_filter for response body
sub_filter '${keycloakExternalURL}/' 'https://${keycloakDmzCustomDomain}/';
sub_filter_once off;
sub_filter_types text/html text/css application/javascript;
`;
    fs.writeFileSync(`${dmzExportPath}/nginx/nginx-proxy.conf`, proxyConf);
  }

  copyIfExists(`${exportPath}/nginx/custom-store-ssl.conf`, `${dmzExportPath}/nginx/custom-store-ssl.conf`);
  copyIfExists(`${exportPath}/nginx/custom-store-ssl.crt`, `${dmzExportPath}/nginx/custom-store-ssl.crt`);
  copyIfExists(`${exportPath}/nginx/custom-store-ssl.key`, `${dmzExportPath}/nginx/custom-store-ssl.key`);
  copyIfExists(`${exportPath}/nginx/custom-codepushproxy-ssl.conf`, `${dmzExportPath}/nginx/custom-codepushproxy-ssl.conf`);
  copyIfExists(`${exportPath}/nginx/custom-codepushproxy-ssl.crt`, `${dmzExportPath}/nginx/custom-codepushproxy-ssl.crt`);
  copyIfExists(`${exportPath}/nginx/custom-codepushproxy-ssl.key`, `${dmzExportPath}/nginx/custom-codepushproxy-ssl.key`);
  copyIfExists(`${exportPath}/nginx/custom-dist-ssl.conf`, `${dmzExportPath}/nginx/custom-dist-ssl.conf`);
  copyIfExists(`${exportPath}/nginx/custom-dist-ssl.crt`, `${dmzExportPath}/nginx/custom-dist-ssl.crt`);
  copyIfExists(`${exportPath}/nginx/custom-dist-ssl.key`, `${dmzExportPath}/nginx/custom-dist-ssl.key`);
  copyIfExists(`${exportPath}/nginx/custom-dmz-auth-ssl.conf`, `${dmzExportPath}/nginx/custom-dmz-auth-ssl.conf`);
  copyIfExists(`${exportPath}/nginx/custom-dmz-auth-ssl.crt`, `${dmzExportPath}/nginx/custom-dmz-auth-ssl.crt`);
  copyIfExists(`${exportPath}/nginx/custom-dmz-auth-ssl.key`, `${dmzExportPath}/nginx/custom-dmz-auth-ssl.key`);
  copyIfExists(`${exportPath}/nginx/user-ssl.crt`, `${dmzExportPath}/nginx/user-ssl.crt`);
  copyIfExists(`${exportPath}/nginx/user-ssl.key`, `${dmzExportPath}/nginx/user-ssl.key`);
  copyIfExists(`${exportPath}/nginx/dhparam.pem`, `${dmzExportPath}/nginx/dhparam.pem`);

  // Common env
  fs.copyFileSync(`${exportPath}/common.env`, `${dmzExportPath}/common.env`);

  // Podman scripts
  fs.copyFileSync(`${exportPath}/podman-up.sh`, `${dmzExportPath}/podman-up.sh`);

  // Copy tester logo dependencies
  const logoPngPath = yq('.testerWeb.logoPng', exportGlobalFilePath);
  const logoSvgPath = yq('.testerWeb.logoSvg', exportGlobalFilePath);

  console.log(`logoPngPath: .${logoPngPath}.`);
  console.log(`logoSvgPath: .${logoSvgPath}.`);

  fs.mkdirSync(`${dmzExportPath}/deps`, { recursive: true });

  if (logoPngPath && logoPngPath !== 'null' && logoPngPath !== '') {
    console.log('Copying logo png...');
    fs.copyFileSync(logoPngPath, `${dmzExportPath}/deps/testerweb-logo.png`);
  } else if (logoSvgPath && logoSvgPath !== 'null' && logoSvgPath !== '') {
    console.log('Copying logo svg...');
    fs.copyFileSync(logoSvgPath, `${dmzExportPath}/deps/testerweb-logo.svg`);
  }

  // Dependencies
  fs.mkdirSync(`${dmzExportPath}/deps/bin`, { recursive: true });
  execInherit(`cp -r ./deps/bin/* "${dmzExportPath}/deps/bin/"`);
  fs.copyFileSync(toolboxImagePath, `${dmzExportPath}/deps/toolbox.tar.gz`);
  console.log('DMZ configuration files have been copied successfully.');
}

function checkScheme() {
  console.log('Checking the schemes.');
  const externalScheme = yq('.apiGateway.external.scheme', exportGlobalFilePath);

  const isStoreCustomDomainEnabled = yq('.storeWeb.customDomain.enabled', exportGlobalFilePath);
  let storeTlsEnabled;
  if (isStoreCustomDomainEnabled === 'true') {
    storeTlsEnabled = yq('.storeWeb.customDomain.enabledTls', exportGlobalFilePath);
  } else {
    storeTlsEnabled = yq('.apiGateway.external.scheme', exportGlobalFilePath);
  }
  const storeScheme = storeTlsEnabled === 'true' ? 'https' : 'http';

  const isDistCustomDomainEnabled = yq('.testerWeb.customDomain.enabled', exportGlobalFilePath);
  let distTlsEnabled;
  if (isDistCustomDomainEnabled === 'true') {
    distTlsEnabled = yq('.testerWeb.customDomain.enabledTls', exportGlobalFilePath);
  } else {
    distTlsEnabled = yq('.apiGateway.external.scheme', exportGlobalFilePath);
  }
  const distScheme = distTlsEnabled === 'true' ? 'https' : 'http';

  if (externalScheme !== storeScheme || externalScheme !== distScheme) {
    console.log('Enterprise App Store and Testing Distribution scheme (HTTP/HTTPS) must be same with the scheme of the Appcircle server.');
    process.exit(1);
  }
}

function dmzConfigurationValidation() {
  checkScheme();
}

function exportRequiredImages() {
  console.log('Extracting required container images.');
  const containerCli = getContainerCli();
  const cTag = yq('.image.tag', exportGlobalFilePath);
  const registryUrl = yq('.image.registry.url', exportGlobalFilePath);
  const dmzContainerImagePath = `${dmzExportPath}/deps`;

  const images = [
    `${registryUrl}/disttesterweb:${cTag}`,
    `${registryUrl}/storeweb:${cTag}`,
    `${registryUrl}/redis:${cTag}`,
    `${registryUrl}/nginx-unprivileged:${cTag}`,
    `${registryUrl}/codepushproxyservice:${cTag}`,
  ];

  for (const image of images) {
    console.log(`Image: ${image}`);
    const imageName = image.split('/').pop();

    try {
      execSync(`${containerCli} image inspect "${image}"`, { stdio: 'pipe' });
    } catch {
      console.log(`Required container image couldn't be found: ${image}`);
      console.log('Pulling the image...');
      execInherit(`${containerCli} pull "${image}"`);
    }
    execInherit(`${containerCli} save "${image}" > "${dmzContainerImagePath}/${imageName}.tar"`);
    console.log(`Exported ${image} to ${dmzContainerImagePath}/${imageName}.tar`);
  }
}

function checkVersionCompatibilityToGoOnExport() {
  let existingVersion = yq('.version', exportGlobalFilePath);
  existingVersion = existingVersion.replace(/-.*$/, ''); // trim suffix

  const packageVersion = version.replace(/-.*$/, ''); // trim suffix

  console.log(`Checking version compatibility... (${existingVersion} -> ${packageVersion})`);

  let comparison = compareVersions(existingVersion, packageVersion);

  if (comparison === 0) {
    console.log("Same version. It's OK to go on with export.");
  } else if (comparison === 1) {
    console.log("DOWNGRADE: Since some of the Appcircle server upgrades have data migration along with the application upgrade, it's not officially supported or might not be eligible in some cases.");
    console.log("It's better to restore a snapshot backup for downgrades, which keeps compatible application and data.");
    printWarning("Are you sure to go on export? Please enter '[Yy]es' or '[Nn]o'");

    // Synchronous prompt via bash
    while (true) {
      const result = spawnSync('bash', ['-c', 'read -r userReply; echo "$userReply"'], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
      const userReply = (result.stdout || '').trim();
      if (/^[Yy]/.test(userReply)) break;
      if (/^[Nn]/.test(userReply)) process.exit(0);
    }
  } else {
    comparison = compareVersions(packageVersion, '3.29.1');
    if (comparison === 1 || comparison === 0) {
      // package version is 3.29.1 or later
      comparison = compareVersions(existingVersion, '3.29.0');
      if (comparison === 1 || comparison === 0) {
        // existing version is 3.29.0 or later
        console.log('UPGRADE: OK');
      } else {
        console.log('UPGRADE: Needs an intermediate step!');
        printWarning('Please first upgrade to 3.29.0 successfully, then go on with later versions.');
        console.log('See here for details:');
        console.log('https://docs.appcircle.io/self-hosted-appcircle/install-server/linux-package/update#upgrade-path-for-3293-or-later');
        process.exit(1);
      }
    }
  }
}

function createCleanExport() {
  if (fileExists(exportGlobalFilePath)) {
    checkVersionCompatibilityToGoOnExport();
  }
  execInherit(`rm -rf ${exportPath}`);
  createExport();
}

function calculatePercentage(totalValue, percentage, int) {
  int = int !== undefined ? int : true;
  const cli = getContainerCli();
  if (int) {
    return exec(`${cli} exec -e totalValue="${totalValue}" -e percentage="${percentage}" toolbox sh -c 'awk "BEGIN {print int(\\$totalValue * \\$percentage / 100)}"'`);
  } else {
    return exec(`${cli} exec -e totalValue="${totalValue}" -e percentage="${percentage}" toolbox sh -c 'awk "BEGIN {print \\$totalValue * \\$percentage / 100}"'`);
  }
}

function setResourceLimits() {
  console.log('=== Setting resource limits for the services...');
  const servicesCpuLimitPercentage = yq('.resources.limits.cpu', exportGlobalFilePath);
  const servicesMemoryLimitPercentage = yq('.resources.limits.memory', exportGlobalFilePath);
  const primaryMongoCpuLimitPercentage = yq('.resources.mongo.primary.limits.cpu', exportGlobalFilePath);
  const secondaryMongoCpuLimitPercentage = yq('.resources.mongo.secondary.limits.cpu', exportGlobalFilePath);
  const primaryMongoMemoryLimitPercentage = yq('.resources.mongo.primary.limits.memory', exportGlobalFilePath);
  const secondaryMongoMemoryLimitPercentage = yq('.resources.mongo.secondary.limits.memory', exportGlobalFilePath);

  console.log('  - Percentage Utilization of the Host Server Resources:');
  console.log(`    - Services CPU Limit Percentage ${servicesCpuLimitPercentage}%`);
  console.log(`    - Services Memory Limit Percentage ${servicesMemoryLimitPercentage}%`);
  console.log(`    - Primary Mongo CPU Limit Percentage: ${primaryMongoCpuLimitPercentage}%`);
  console.log(`    - Secondary Mongo CPU Limit Percentage: ${secondaryMongoCpuLimitPercentage}%`);
  console.log(`    - Primary Mongo Memory Limit Percentage: ${primaryMongoMemoryLimitPercentage}%`);
  console.log(`    - Secondary Mongo Memory Limit Percentage: ${secondaryMongoMemoryLimitPercentage}%`);
  console.log();

  const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
  const memTotalMatch = memInfo.match(/MemTotal:\s+(\d+)/);
  const hostTotalMemoryKib = parseInt(memTotalMatch[1], 10);
  const hostTotalMemoryMib = Math.floor(hostTotalMemoryKib / 1024);

  runToolbox();
  // MiB calculations
  const primaryMongoMemoryLimitMib = calculatePercentage(hostTotalMemoryMib, primaryMongoMemoryLimitPercentage);
  const secondaryMongoMemoryLimitMib = calculatePercentage(hostTotalMemoryMib, secondaryMongoMemoryLimitPercentage);
  const servicesMemoryLimitMib = calculatePercentage(hostTotalMemoryMib, servicesMemoryLimitPercentage);

  // CPU count calculations
  const hostTotalCpuCount = parseInt(exec('nproc'), 10);
  const primaryMongoCpuLimit = calculatePercentage(hostTotalCpuCount, primaryMongoCpuLimitPercentage, false);
  const secondaryMongoCpuLimit = calculatePercentage(hostTotalCpuCount, secondaryMongoCpuLimitPercentage, false);
  const servicesCpuLimit = calculatePercentage(hostTotalCpuCount, servicesCpuLimitPercentage, false);

  removeToolbox();

  console.log(`  - Total CPU Count: ${hostTotalCpuCount}`);
  console.log(`    - Primary Mongo CPU Limit: ${primaryMongoCpuLimit}`);
  console.log(`    - Secondary Mongo CPU Limit: ${secondaryMongoCpuLimit}`);
  console.log(`    - Services CPU Limit: ${servicesCpuLimit}`);
  console.log();
  console.log(`  - Total Memory: ${hostTotalMemoryMib} MiB`);
  console.log(`    - Primary Mongo Memory Limit: ${primaryMongoMemoryLimitMib} MiB`);
  console.log(`    - Secondary Mongo Memory Limit: ${secondaryMongoMemoryLimitMib} MiB`);
  console.log(`    - Services Memory Limit: ${servicesMemoryLimitMib} MiB`);
  console.log();

  process.env.PRIMARY_MONGO_CPU_LIMIT = primaryMongoCpuLimit;
  process.env.SECONDARY_MONGO_CPU_LIMIT = secondaryMongoCpuLimit;
  process.env.SERVICES_CPU_LIMIT = servicesCpuLimit;
  yqInPlace('.resources.mongo.primary.limits.cpuCount = strenv(PRIMARY_MONGO_CPU_LIMIT)', exportGlobalFilePath);
  yqInPlace('.resources.mongo.secondary.limits.cpuCount = strenv(SECONDARY_MONGO_CPU_LIMIT)', exportGlobalFilePath);
  yqInPlace('.resources.limits.cpuCount = strenv(SERVICES_CPU_LIMIT)', exportGlobalFilePath);

  process.env.PRIMARY_MONGO_MEMORY_LIMIT_MIB = `${primaryMongoMemoryLimitMib}m`;
  process.env.SECONDARY_MONGO_MEMORY_LIMIT_MIB = `${secondaryMongoMemoryLimitMib}m`;
  process.env.SERVICES_MEMORY_LIMIT_MIB = `${servicesMemoryLimitMib}m`;
  yqInPlace('.resources.mongo.primary.limits.memoryMib = strenv(PRIMARY_MONGO_MEMORY_LIMIT_MIB)', exportGlobalFilePath);
  yqInPlace('.resources.mongo.secondary.limits.memoryMib = strenv(SECONDARY_MONGO_MEMORY_LIMIT_MIB)', exportGlobalFilePath);
  yqInPlace('.resources.limits.memoryMib = strenv(SERVICES_MEMORY_LIMIT_MIB)', exportGlobalFilePath);
}

function createExport() {
  // Check if the global yaml is valid.
  try {
    execSync(`yq "${globalFilePath}"`, { stdio: 'pipe' });
  } catch {
    console.log('Global yaml is not valid. Please fix the errors to continue.');
    process.exit(1);
  }

  // Copy all config files to export directory
  execSync(`mkdir -p "${exportPath}"`, { stdio: 'inherit' });
  execInherit(`cp -r ${configDirectory}/* ${exportPath}/`);

  givePermissionAllScript();

  if (!fileExists(globalFilePath) || readFileTrim(globalFilePath) === '') {
    fs.copyFileSync(exampleGlobalFilePath, globalFilePath);
  }

  if (fileExists(systemVariablePath)) {
    const result = exec(`yq eval-all -P '. as $item ireduce ({}; . *+ $item)' "${defaultFilePath}" "${systemVariablePath}" "${globalFilePath}"`);
    fs.writeFileSync(exportGlobalFilePath, result);
  } else {
    const result = exec(`yq eval-all -P '. as $item ireduce ({}; . *+ $item)' "${defaultFilePath}" "${globalFilePath}"`);
    fs.writeFileSync(exportGlobalFilePath, result);
  }

  // Import version to the datasource
  process.env.AC_SCRIPT_VERSION = `v${version}`;
  yqInPlace('.version = strenv(AC_SCRIPT_VERSION)', exportGlobalFilePath);

  // Create post variable file
  replaceTmplFile(postVariableTemplatePath, `./${exportPath}/.${postVariableFileName}`, exportGlobalFilePath);
  if (!fileExists(secretFilePath)) {
    fs.writeFileSync(secretFilePath, '');
  }

  generateKeys();

  // replace_secret_file
  replacaSecretYaml(secretTemplatePath, secretFilePath, exportGlobalFilePath);

  fs.copyFileSync(secretFilePath, `${exportPath}/.${secretFileName}`);

  // decode user secret template and move temp file
  const tempFileForUserSecret = path.join(os.tmpdir(), `usersecret-${Date.now()}.yaml`);
  if (fileExists(userSecretFilePath)) {
    const decoded = Buffer.from(fs.readFileSync(userSecretFilePath, 'utf8'), 'base64').toString('utf8');
    fs.writeFileSync(tempFileForUserSecret, decoded);
  } else {
    fs.writeFileSync(tempFileForUserSecret, '');
  }

  // latest merge
  const merged = exec(`yq eval-all -P '. as $item ireduce ({}; . *+ $item)' "${defaultFilePath}" "${systemVariablePath}" "./${exportPath}/.${postVariableFileName}" "${exportPath}/.${secretFileName}" "${globalFilePath}" "${tempFileForUserSecret}"`);
  fs.writeFileSync(exportGlobalFilePath, merged);

  // Import dmzFlag to the datasource
  process.env.DMZ_FLAG = String(dmzFlag);
  yqInPlace('.dmzFlag = strenv(DMZ_FLAG)', exportGlobalFilePath);

  // Import resources limits to the datasource
  setResourceLimits();

  // Import script version to the datasource
  process.env.APP_VERSION = version;
  yqInPlace('.version = strenv(APP_VERSION)', exportGlobalFilePath);

  checkInitialUserName(exportGlobalFilePath);

  createSslCert();

  // Remove user secret decoded file
  try { fs.unlinkSync(tempFileForUserSecret); } catch { /* ignore */ }

  try { fs.unlinkSync(`${exportPath}/.${secretFileName}`); } catch { /* ignore */ }
  try { fs.unlinkSync(`./${exportPath}/.${postVariableFileName}`); } catch { /* ignore */ }

  // Validate the global yaml according to the schema
  runToolbox();
  const containerEngine = getContainerCli();
  // Bash version
  execInherit(`bash ./helper-tools/validate-global-yaml.sh "${projectName}" "${containerEngine}"`);
  // Node.js version
  /*
  try {
    execFileSync('node', ['./helper-tools/validate-global-yaml.js', projectName, containerEngine], { stdio: 'inherit' });
  } catch {
    process.exit(1);
  }
  */
  // Node.js version ends
  removeToolbox();

  // Replace all templates inside export
  replaceExportDirectory(exportPath, `${exportPath}/.${globalFileName}`);

  givePermissionAllScript();

  const cli = getContainerCli();

  if (dmzFlag === true || dmzFlag === 'true') {
    console.log('Creating DMZ architecture export artifacts...');
    copyDmzConfigurationFiles();
    exportRequiredImages();
  }

  if (cli === 'docker' && !fileExists('/etc/docker/daemon.json')) {
    printWarning('The log settings for the docker engine may not be fully configured. For a standard installation, the value {"log-driver":"journald"} can be entered in the /etc/docker/daemon.json file');
  }

  // Ensure all exported files are readable by container users (e.g. uid 10001).
  // fs.copyFile preserves source permissions, so files from a umask 027 unzip
  // could end up as 640 regardless of our process.umask() setting above.
  // a+rX: add read for all, execute only where already set (directories).
  execSync(`chmod -R a+rX "${exportPath}"`, { stdio: 'inherit' });

  console.log('Finish export operations');
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  setArgument(args);

  if (versionFlag) {
    console.log(version);
    process.exit(0);
  }

  checkValidationToRunScript();

  createVariable();

  if (installPackageFlag) {
    await installRequiredPackage();
  } else if (upFlag) {
    await up();
  } else if (initializeProjectFlag) {
    initializeProject();
  } else if (downFlag) {
    down();
  } else if (checkFlag) {
    check();
  } else if (resetFlag) {
    await reset();
  } else if (versionCommandFlag) {
    versionCommand();
  } else if (upgradeFlag) {
    upgrade();
  } else if (loadFlag) {
    load();
  } else if (downloadFlag) {
    download();
  } else if (minioMigrateFlag) {
    minioMigrate(clientVersion, sourceType, sourceVersion, targetType, targetVersion);
  } else {
    // exportFlag == true (default)
    createCleanExport();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
