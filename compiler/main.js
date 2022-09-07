/*
 * Copyright (c) 2020 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const path = require('path');
const md5 = require('md5');

const { readFile } = require('./lib/utils');
const { WORKERS_DIR } = require('./lib/pre_define');

const {
  configure,
  getLogger
} = require('log4js');

configure({
  appenders: { 'ETS': {type: 'stderr', layout: {type: 'messagePassThrough'}}},
  categories: {'default': {appenders: ['ETS'], level: 'info'}}
});
const logger = getLogger('ETS');

const staticPreviewPage = process.env.aceStaticPreview;
const aceCompileMode = process.env.aceCompileMode || 'page';
const abilityConfig = {
  abilityType: process.env.abilityType || 'page',
  abilityEntryFile: null,
  projectAbilityPath: [],
  testRunnerFile: []
};
const projectConfig = {};
const resources = {
  app: {},
  sys: {}
};
const systemModules = [];
const abilityPagesFullPath = [];

function initProjectConfig(projectConfig) {
  projectConfig.entryObj = {};
  projectConfig.projectPath = projectConfig.projectPath || process.env.aceModuleRoot ||
    path.join(process.cwd(), 'sample');
  projectConfig.buildPath = projectConfig.buildPath || process.env.aceModuleBuild ||
    path.resolve(projectConfig.projectPath, 'build');
  projectConfig.manifestFilePath = projectConfig.manifestFilePath || process.env.aceManifestPath ||
    path.join(projectConfig.projectPath, 'manifest.json');
  projectConfig.aceProfilePath = projectConfig.aceProfilePath || process.env.aceProfilePath;
  projectConfig.aceModuleJsonPath = projectConfig.aceModuleJsonPath || process.env.aceModuleJsonPath;
  projectConfig.aceSuperVisualPath = projectConfig.aceSuperVisualPath ||
    process.env.aceSuperVisualPath;
  projectConfig.hashProjectPath = projectConfig.hashProjectPath ||
    hashProjectPath(projectConfig.projectPath);
  projectConfig.aceBuildJson = projectConfig.aceBuildJson || process.env.aceBuildJson;
  projectConfig.cachePath = projectConfig.cachePath || process.env.cachePath ||
    path.resolve(__dirname, 'node_modules/.cache');
  projectConfig.aceSoPath = projectConfig.aceSoPath || process.env.aceSoPath;
  projectConfig.outChangedFileList = getChangedFileList(projectConfig);
  projectConfig.xtsMode = /ets_loader_ark$/.test(__dirname);
  projectConfig.localPropertiesPath = projectConfig.localPropertiesPath || process.env.localPropertiesPath
  projectConfig.projectProfilePath = projectConfig.projectProfilePath || process.env.projectProfilePath
}

function getChangedFileList(projectConfig) {
  return (projectConfig.hotReloadWatch && projectConfig.hotReloadWatch.outChangedFileList) ?
    projectConfig.hotReloadWatch.outChangedFileList : path.join(projectConfig.cachePath, 'changedFileList.json');
}

function loadEntryObj(projectConfig) {
  let manifest = {};
  initProjectConfig(projectConfig);
  if (process.env.aceManifestPath && aceCompileMode === 'page') {
    setEntryFile(projectConfig);
    setFaTestRunnerFile(projectConfig);
  }
  if (process.env.aceModuleJsonPath) {
    setAbilityPages(projectConfig);
    setStageTestRunnerFile(projectConfig);
  }

  if(staticPreviewPage) {
    projectConfig.entryObj['./' + staticPreviewPage] = projectConfig.projectPath + path.sep +
      staticPreviewPage + '.ets?entry';
  } else if (abilityConfig.abilityType === 'page') {
    if (fs.existsSync(projectConfig.manifestFilePath)) {
      const jsonString = fs.readFileSync(projectConfig.manifestFilePath).toString();
      manifest = JSON.parse(jsonString);
      projectConfig.pagesJsonFileName = 'config.json';
    } else if (projectConfig.aceModuleJsonPath && fs.existsSync(projectConfig.aceModuleJsonPath)) {
      process.env.compileMode = 'moduleJson';
      buildManifest(manifest, projectConfig.aceModuleJsonPath);
    } else {
      throw Error('\u001b[31m ERROR: the manifest file ' + projectConfig.manifestFilePath.replace(/\\/g, '/') +
        ' or module.json is lost or format is invalid. \u001b[39m').message;
    }
    if (manifest.pages) {
      const pages = manifest.pages;
      pages.forEach((element) => {
        const sourcePath = element.replace(/^\.\/ets\//, '');
        const fileName = path.resolve(projectConfig.projectPath, sourcePath + '.ets');
        if (fs.existsSync(fileName)) {
          projectConfig.entryObj['./' + sourcePath] = fileName + '?entry';
        } else {
          throw Error(`\u001b[31m ERROR: page '${fileName.replace(/\\/g, '/')}' does not exist. \u001b[39m`)
            .message;
        }
      });
    } else {
      throw Error('\u001b[31m ERROR: missing pages attribute in ' +
        projectConfig.manifestFilePath.replace(/\\/g, '/') +
        '. \u001b[39m').message;
    }
  }
}

function buildManifest(manifest, aceConfigPath) {
  try {
    const moduleConfigJson = JSON.parse(fs.readFileSync(aceConfigPath).toString());
    manifest.type = process.env.abilityType;
    if (moduleConfigJson.module) {
      manifest.pages = getPages(moduleConfigJson);
    } else {
      throw Error('\u001b[31m'+
        'ERROR: the config.json file miss key word module || module[abilities].' +
        '\u001b[39m').message;
    }
  } catch (e) {
    throw Error("\x1B[31m" + 'ERROR: the module.json file is lost or format is invalid.' +
      "\x1B[39m").message;
  }
}

function getPages(configJson) {
  const pages = []
  const pagesJsonFileName = `${configJson.module.pages.replace(/\$profile\:/, '')}.json`;
  const modulePagePath = path.resolve(projectConfig.aceProfilePath, pagesJsonFileName);
  if (fs.existsSync(modulePagePath)) {
    const pagesConfig = JSON.parse(fs.readFileSync(modulePagePath, 'utf-8'));
    if (pagesConfig && pagesConfig.src) {
      projectConfig.pagesJsonFileName = pagesJsonFileName;
      return pagesConfig.src;
    }
  }
  return pages;
}

function setEntryFile(projectConfig) {
  const entryFileName = abilityConfig.abilityType === 'page' ? 'app' : abilityConfig.abilityType;
  const extendFile = entryFileName === 'app' ? '.ets' : '.ts';
  const entryFileRealPath = entryFileName + extendFile;
  const entryFilePath = path.resolve(projectConfig.projectPath, entryFileRealPath);
  abilityConfig.abilityEntryFile = entryFilePath;
  if (!fs.existsSync(entryFilePath) && aceCompileMode === 'page') {
    throw Error(`\u001b[31m ERROR: missing ${entryFilePath.replace(/\\/g, '/')}. \u001b[39m`).message;
  }
  projectConfig.entryObj[`./${entryFileName}`] = entryFilePath + '?entry';
}

function setAbilityPages(projectConfig) {
  let abilityPages = [];
  if (projectConfig.aceModuleJsonPath && fs.existsSync(projectConfig.aceModuleJsonPath)) {
    const moduleJson = JSON.parse(fs.readFileSync(projectConfig.aceModuleJsonPath).toString());
    abilityPages = readAbilityEntrance(moduleJson);
    setAbilityFile(projectConfig, abilityPages);
    setBundleModuleInfo(projectConfig, moduleJson);
  }
}

function setFaTestRunnerFile(projectConfig) {
  const index =projectConfig.projectPath.split(path.sep).join('/').lastIndexOf('\/');
  const testRunnerPath = path.resolve(projectConfig.projectPath.substring(0,index + 1), "TestRunner");
  if (fs.existsSync(testRunnerPath)) {
    const testRunnerFiles = [];
    readFile(testRunnerPath, testRunnerFiles);
    testRunnerFiles.forEach((item) => {
      if (/\.(ts|js|ets)$/.test(item)) {
        const relativePath = path.relative(testRunnerPath, item).replace(/\.(ts|js|ets)$/, '');
		projectConfig.entryObj["../TestRunner/" + relativePath] = item;
        abilityConfig.testRunnerFile.push(item);
      }
    })
  }
}

function setStageTestRunnerFile(projectConfig) {
  const index =projectConfig.projectPath.split(path.sep).join('/').lastIndexOf('\/');
  const testRunnerPath = path.resolve(projectConfig.projectPath, "TestRunner");
  if (fs.existsSync(testRunnerPath)) {
    const testRunnerFiles = [];
    readFile(testRunnerPath, testRunnerFiles);
    testRunnerFiles.forEach((item) => {
      if (/\.(ts|js|ets)$/.test(item)) {
        const relativePath = path.relative(testRunnerPath, item).replace(/\.(ts|js|ets)$/, '');
		projectConfig.entryObj["./TestRunner/" + relativePath] = item;
        abilityConfig.testRunnerFile.push(item);
      }
    })
  }
}

function setBundleModuleInfo(projectConfig, moduleJson) {
  if (moduleJson.module) {
    projectConfig.moduleName = moduleJson.module.name;
  }
  if (moduleJson.app) {
    projectConfig.bundleName = moduleJson.app.bundleName;
  }
}

function setAbilityFile(projectConfig, abilityPages) {
  abilityPages.forEach(abilityPath => {
    const projectAbilityPath = path.resolve(projectConfig.projectPath, '../', abilityPath);
    if (path.isAbsolute(abilityPath)) {
      abilityPath = '.' + abilityPath.slice(projectConfig.projectPath.length);
    }
    const entryPageKey = abilityPath.replace(/^\.\/ets\//, './').replace(/\.ts$/, '').replace(/\.ets$/, '');
    if (fs.existsSync(projectAbilityPath)) {
      abilityConfig.projectAbilityPath.push(projectAbilityPath);
      projectConfig.entryObj[entryPageKey] = projectAbilityPath + '?entry';
    } else {
      throw Error(
        `\u001b[31m ERROR: srcEntrance file '${projectAbilityPath.replace(/\\/g, '/')}' does not exist. \u001b[39m`
      ).message;
    }
  });
}

function readAbilityEntrance(moduleJson) {
  let abilityPages = [];
  if (moduleJson.module) {
    const moduleSrcEntrance = moduleJson.module.srcEntrance;
    if (moduleSrcEntrance) {
      abilityPages.push(moduleSrcEntrance);
      abilityPagesFullPath.push(getAbilityFullPath(projectConfig.projectPath, moduleSrcEntrance));
    }
    if (moduleJson.module.abilities && moduleJson.module.abilities.length > 0) {
      setEntrance(moduleJson.module.abilities, abilityPages);
    }
    if (moduleJson.module.extensionAbilities && moduleJson.module.extensionAbilities.length > 0) {
      setEntrance(moduleJson.module.extensionAbilities, abilityPages);
    }
  }
  return abilityPages;
}

function setEntrance(abilityConfig, abilityPages) {
  if (abilityConfig && abilityConfig.length > 0) {
    abilityConfig.forEach(ability => {
      if (ability.srcEntrance) {
        abilityPages.push(ability.srcEntrance);
        abilityPagesFullPath.push(getAbilityFullPath(projectConfig.projectPath, ability.srcEntrance));
      }
    });
  }
}

function getAbilityFullPath(projectPath, abilityPath) {
  let finalPath = path.resolve(path.resolve(projectPath, '../'), abilityPath);
  finalPath = finalPath.replace(/\\/g, '/');
  if (fs.existsSync(finalPath)) {
    return finalPath;
  } else {
    return abilityPath;
  }
}

function loadWorker(projectConfig, workerFileEntry) {
  if (workerFileEntry) {
    projectConfig.entryObj = Object.assign(projectConfig.entryObj, workerFileEntry);
  } else {
    const workerPath = path.resolve(projectConfig.projectPath, WORKERS_DIR);
    if (fs.existsSync(workerPath)) {
      const workerFiles = [];
      readFile(workerPath, workerFiles);
      workerFiles.forEach((item) => {
        if (/\.(ts|js)$/.test(item)) {
          const relativePath = path.relative(workerPath, item)
            .replace(/\.(ts|js)$/, '').replace(/\\/g, '/');
          projectConfig.entryObj[`./${WORKERS_DIR}/` + relativePath] = item;
        }
      })
    }
  }
}

function readWorkerFile() {
  const workerFileEntry = {};
  if (projectConfig.aceBuildJson && fs.existsSync(projectConfig.aceBuildJson)) {
    const workerConfig = JSON.parse(fs.readFileSync(projectConfig.aceBuildJson).toString());
    if (workerConfig.workers) {
      workerConfig.workers.forEach(worker => {
        if (!/\.(ts|js)$/.test(worker)) {
          worker += '.ts';
        }
        const relativePath = path.relative(projectConfig.projectPath, worker);
        if (filterWorker(relativePath)) {
          workerFileEntry[relativePath.replace(/\.(ts|js)$/, '').replace(/\\/g, '/')] = worker;
        }
      });
      return workerFileEntry;
    }
  }
  return null;
}

function filterWorker(workerPath) {
  return /\.(ts|js)$/.test(workerPath);
}

;(function initSystemResource() {
  const sysResourcePath = path.resolve('./sysResource.js');
  if (fs.existsSync(sysResourcePath)) {
    resources.sys = require(sysResourcePath).sys;
  }
})();

;(function readSystemModules() {
  const systemModulesPath = path.resolve(__dirname,'../../api');
  if (fs.existsSync(systemModulesPath)) {
    systemModules.push(...fs.readdirSync(systemModulesPath));
  }
})()

function readAppResource(resources, filePath) {
  if (fs.existsSync(filePath)) {
    const appResource = fs.readFileSync(filePath, "utf-8");
    const resourceArr = appResource.split(/\n/);
    let resourceMap = new Map();
    processResourceArr(resourceArr, resourceMap, filePath);
    for (let [key, value] of resourceMap) {
      resources.app[key] = value;
    }
  }
}

function processResourceArr(resourceArr, resourceMap, filePath) {
  for (let i = 0; i < resourceArr.length; i++) {
    if (!resourceArr[i].length) {
      continue;
    }
    const resourceData = resourceArr[i].split(/\s/);
    if (resourceData.length === 3 && !isNaN(Number(resourceData[2])) ) {
      if (resourceMap.get(resourceData[0])) {
        const resourceKeys = resourceMap.get(resourceData[0]);
        if (!resourceKeys[resourceData[1]] || resourceKeys[resourceData[1]] !== Number(resourceData[2])) {
          resourceKeys[resourceData[1]] = Number(resourceData[2]);
        }
      } else {
        let obj = {};
        obj[resourceData[1]] = Number(resourceData[2]);
        resourceMap.set(resourceData[0], obj);
      }
    } else {
      logger.warn(`\u001b[31m ETS:WARN The format of file '${filePath}' is incorrect. \u001b[39m`);
      break;
    }
  }
}

function hashProjectPath(projectPath) {
  process.env.hashProjectPath = "_" + md5(projectPath);
  return process.env.hashProjectPath;
}

function loadModuleInfo(projectConfig, envArgs) {
  if (projectConfig.aceBuildJson && fs.existsSync(projectConfig.aceBuildJson)) {
    const buildJsonInfo = JSON.parse(fs.readFileSync(projectConfig.aceBuildJson).toString());
    projectConfig.compileMode = buildJsonInfo.compileMode;
    projectConfig.projectRootPath = buildJsonInfo.projectRootPath;
    projectConfig.modulePathMap = buildJsonInfo.modulePathMap;
    projectConfig.isOhosTest = buildJsonInfo.isOhosTest;
    projectConfig.processTs = false;
    projectConfig.buildArkMode = envArgs.buildMode;
    if (buildJsonInfo.compileMode === 'esmodule') {
      projectConfig.nodeModulesPath = buildJsonInfo.nodeModulesPath;
    }
    projectConfig.pandaMode = buildJsonInfo.pandaMode;
    if (buildJsonInfo.compatibleSdkVersion >= 9) {
      partialUpdateConfig.partialUpdateMode = true;
    }
  }
}

function checkAppResourcePath(appResourcePath, config) {
  if (appResourcePath) {
    readAppResource(resources, appResourcePath);
    if (fs.existsSync(appResourcePath) && config.cache) {
      config.cache.buildDependencies.config.push(appResourcePath);
    }
    if (!projectConfig.xtsMode) {
      const appResourcePathSavePath = path.resolve(projectConfig.cachePath, 'resource_path.txt');
      saveAppResourcePath(appResourcePath, appResourcePathSavePath);
      if (fs.existsSync(appResourcePathSavePath) && config.cache) {
        config.cache.buildDependencies.config.push(appResourcePathSavePath);
      }
    }
  }
}

function saveAppResourcePath(appResourcePath, appResourcePathSavePath) {
  let isSave = false;
  if (fs.existsSync(appResourcePathSavePath)) {
    const saveContent = fs.readFileSync(appResourcePathSavePath);
    if (appResourcePath !== saveContent) {
      isSave = true;
    }
  } else {
    isSave = true;
  }
  if (isSave) {
    fs.writeFileSync(appResourcePathSavePath, appResourcePath);
  }
}

function addSDKBuildDependencies(config) {
  if (projectConfig.localPropertiesPath &&
    fs.existsSync(projectConfig.localPropertiesPath) && config.cache) {
    config.cache.buildDependencies.config.push(projectConfig.localPropertiesPath)
  }
  if (projectConfig.projectProfilePath &&
    fs.existsSync(projectConfig.projectProfilePath) && config.cache) {
    config.cache.buildDependencies.config.push(projectConfig.projectProfilePath)
  }
}

const globalProgram = {
  program: null,
  watchProgram: null
};

const partialUpdateConfig = {
  partialUpdateMode: false
};

exports.globalProgram = globalProgram;
exports.projectConfig = projectConfig;
exports.loadEntryObj = loadEntryObj;
exports.readAppResource = readAppResource;
exports.resources = resources;
exports.loadWorker = loadWorker;
exports.abilityConfig = abilityConfig;
exports.readWorkerFile = readWorkerFile;
exports.abilityPagesFullPath = abilityPagesFullPath;
exports.loadModuleInfo = loadModuleInfo;
exports.systemModules = systemModules;
exports.checkAppResourcePath = checkAppResourcePath;
exports.addSDKBuildDependencies = addSDKBuildDependencies;
exports.partialUpdateConfig = partialUpdateConfig;